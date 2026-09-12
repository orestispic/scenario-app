import type { JSONContent } from "@tiptap/core";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import {
  metadataRegisters,
  metadataFromRegisters,
  validateMetadataWrite,
  type MetadataState,
  type MetadataWrite,
  type MetadataChange,
  type ProjectMetadata,
  type ProjectComment,
} from "./contractsV10";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/** Annotation marks are a projection, not v8 text edits. Preserve all formatting. */
export function stripProjectCommentMarks(document: JSONContent): JSONContent {
  const node = structuredClone(document);
  if (node.marks) {
    node.marks = node.marks.filter((m) => m.type !== "commentAnchor");
    if (!node.marks.length) delete node.marks;
  }
  if (node.content) {
    node.content = node.content
      .map(stripProjectCommentMarks)
      .reduce<JSONContent[]>((out, child) => {
        const previous = out[out.length - 1];
        if (
          previous?.type === "text" &&
          child.type === "text" &&
          same(previous.marks ?? [], child.marks ?? []) &&
          same(previous.attrs ?? {}, child.attrs ?? {})
        )
          previous.text = (previous.text ?? "") + (child.text ?? "");
        else out.push(child);
        return out;
      }, []);
  }
  return node;
}
function comment(value: unknown): value is ProjectComment {
  return Boolean(value && typeof value === "object" && "anchor" in value);
}
function localRegisters(metadata: ProjectMetadata, base: MetadataState["registers"]) {
  const values = structuredClone(metadataRegisters(metadata));
  // Anchor offsets/lost are derived from the text stream, not independent edits.
  // Persist the creation anchor; readers resolve it against their current text.
  for (const [k, v] of Object.entries(values)) {
    const previous = base[k]?.value;
    if (
      comment(v) &&
      comment(previous) &&
      v.anchor.blockId === previous.anchor.blockId &&
      v.anchor.originalText === previous.anchor.originalText
    )
      v.anchor = structuredClone(previous.anchor);
  }
  return values;
}
export function metadataDiff(
  base: MetadataState["registers"],
  metadata: ProjectMetadata,
): MetadataChange[] {
  const values = localRegisters(metadata, base);
  return [...new Set([...Object.keys(base), ...Object.keys(values)])].sort().flatMap((key) => {
    const value = values[key] ?? null;
    return same(base[key]?.value ?? null, value)
      ? []
      : [{ key, expectedRevision: base[key]?.revision ?? 0, value }];
  });
}
export function resolveProjectCommentAnchors(
  comments: ProjectComment[],
  document: JSONContent,
): ProjectComment[] {
  const blocks = new Map(
    (document.content ?? []).map((block) => [String(block.attrs?.blockId ?? ""), block]),
  );
  const text = (node: JSONContent): string => node.text ?? (node.content ?? []).map(text).join("");
  return comments.map((thread) => {
    const result = structuredClone(thread),
      block = blocks.get(thread.anchor.blockId);
    if (!block) {
      result.anchor.lost = true;
      return result;
    }
    const value = text(block),
      a = result.anchor;
    if (value.slice(a.startOffset, a.endOffset) === a.originalText) {
      a.lost = false;
      return result;
    }
    const start = value.indexOf(a.originalText);
    if (a.originalText && start >= 0 && value.indexOf(a.originalText, start + 1) === -1) {
      a.startOffset = start;
      a.endOffset = start + a.originalText.length;
      a.lost = false;
    } else a.lost = true; // Ambiguous/deleted text is explicit, never attached elsewhere.
    return result;
  });
}
export class ProjectMetadataClient {
  private state: MetadataState;
  private pending: MetadataWrite | null = null;
  private stopped = false;
  constructor(
    private api: AuthenticatedCommercialApi,
    state: MetadataState,
    private read: () => ProjectMetadata,
    private replace: (metadata: ProjectMetadata) => void,
    private signal: AbortSignal,
    private readOnly: boolean,
  ) {
    this.state = structuredClone(state);
  }
  confirmed(): ProjectMetadata {
    return metadataFromRegisters(this.state.registers);
  }
  hasPending(): boolean {
    return Boolean(this.pending) || metadataDiff(this.state.registers, this.read()).length > 0;
  }
  stop() {
    this.stopped = true;
    this.pending = null;
    this.state.registers = {};
  }
  private alive() {
    return !this.stopped && !this.signal.aborted;
  }
  private receive(state: MetadataState, acknowledged: MetadataChange[] = []) {
    if (!this.alive() || state.revision < this.state.revision) return;
    if (
      state.scenarioId !== this.state.scenarioId ||
      state.baseVersionId !== this.state.baseVersionId
    )
      throw Object.assign(new Error("Portée de commentaire invalide."), { status: 409 });
    const comparison = structuredClone(this.state.registers);
    for (const change of acknowledged)
      comparison[change.key] = {
        value: change.value,
        revision: comparison[change.key]?.revision ?? 0,
      };
    const dirty = metadataDiff(comparison, this.read());
    const sent = new Set(acknowledged.map((c) => c.key));
    if (
      dirty.some(
        (c) =>
          !sent.has(c.key) &&
          (state.registers[c.key]?.revision ?? 0) !==
            (this.state.registers[c.key]?.revision ?? 0) &&
          !same(state.registers[c.key]?.value ?? null, c.value),
      )
    )
      throw Object.assign(
        new Error(
          "Un même commentaire ou champ de première page a changé ailleurs. Votre copie est conservée.",
        ),
        { status: 409, code: "project_metadata_conflict" },
      );
    const visible = structuredClone(state.registers);
    for (const c of dirty)
      visible[c.key] = { value: c.value, revision: visible[c.key]?.revision ?? 0 };
    this.state = structuredClone(state);
    this.replace(metadataFromRegisters(visible));
  }
  async sync(): Promise<void> {
    if (!this.alive()) return;
    if (this.pending) {
      const pending = this.pending;
      const result = await this.api.writeProjectMetadata(
        this.state.scenarioId,
        pending,
        this.signal,
      );
      if (!this.alive()) return;
      if (result.status === "conflict")
        throw Object.assign(
          new Error(
            "Modification concurrente : conservez votre copie avant de choisir la version cloud.",
          ),
          { status: 409, code: "project_metadata_conflict" },
        );
      this.receive(result.state, pending.changes);
      this.pending = null;
    }
    const latest = await this.api.getProjectMetadata(this.state.scenarioId, this.signal);
    if (!this.alive()) return;
    this.receive(latest.state);
    if (this.readOnly) return;
    const changes = metadataDiff(this.state.registers, this.read()).slice(0, 32);
    if (!changes.length) return;
    this.pending = { operationId: crypto.randomUUID(), changes };
    try {
      validateMetadataWrite(this.pending);
    } catch {
      throw Object.assign(
        new Error(
          "Commentaires ou premières pages trop volumineux. Votre copie locale est conservée.",
        ),
        { status: 409, code: "project_metadata_invalid" },
      );
    }
    const result = await this.api.writeProjectMetadata(
      this.state.scenarioId,
      this.pending,
      this.signal,
    );
    if (!this.alive()) return;
    if (result.status === "conflict")
      throw Object.assign(
        new Error(
          "Un même commentaire ou champ a été modifié à plusieurs. Votre copie est conservée.",
        ),
        { status: 409, code: "project_metadata_conflict" },
      );
    this.receive(result.state, this.pending.changes);
    this.pending = null;
  }
}
