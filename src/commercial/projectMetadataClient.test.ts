import { describe, expect, it, vi } from "vitest";
import {
  metadataFromRegisters,
  seedMetadata,
  validateMetadataWrite,
  parseMetadataResponse,
  type ProjectMetadata,
  type ProjectComment,
  type MetadataState,
  type MetadataResponse,
  type MetadataWrite,
} from "./contractsV10";
import {
  ProjectMetadataClient,
  resolveProjectCommentAnchors,
  metadataDiff,
} from "./projectMetadataClient";
import { diffScenarioBlocks } from "./collaborationClient";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import { createEmptyCoverPage } from "../document/scenarioFile";
const scenarioId = "80000000-0000-4000-8000-000000000001",
  baseVersionId = "80000000-0000-4000-8000-000000000002";
const thread = (): ProjectComment => ({
  id: "thread_one",
  status: "open",
  createdAt: "2026-09-12T00:00:00Z",
  resolvedAt: null,
  anchor: {
    sceneId: "scene_root",
    blockId: "block_one",
    startOffset: 0,
    endOffset: 5,
    originalText: "hello",
    lost: false,
  },
  messages: [
    { id: "msg_one", text: "Initial comment", createdAt: "2026-09-12T00:00:00Z", editedAt: null },
  ],
});
function fixture(readOnly = false) {
  let visible: ProjectMetadata = {
    title: "Test",
    coverPage: createEmptyCoverPage(),
    coverPageHidden: false,
    comments: [thread()],
  };
  let state: MetadataState = {
    scenarioId,
    baseVersionId,
    revision: 0,
    registers: seedMetadata({ formatVersion: 1, ...visible }),
  };
  const operations = new Map<string, MetadataResponse>();
  const response = (status: MetadataResponse["status"] = "current"): MetadataResponse =>
    structuredClone({
      contractVersion: "2026-09-v10",
      request_id: "test",
      state,
      status,
      conflictKeys: [],
      replayed: false,
    });
  const api = {
    getProjectMetadata: vi.fn(async () => response()),
    writeProjectMetadata: vi.fn(async (_id: string, write: MetadataWrite) => {
      if (operations.has(write.operationId)) return operations.get(write.operationId)!;
      if (write.changes.some((c) => (state.registers[c.key]?.revision ?? 0) !== c.expectedRevision))
        return response("conflict");
      state.revision++;
      for (const c of write.changes)
        state.registers[c.key] = { revision: state.revision, value: structuredClone(c.value) };
      const result = response("applied");
      operations.set(write.operationId, result);
      return result;
    }),
  } as unknown as AuthenticatedCommercialApi;
  const scope = new AbortController();
  const client = new ProjectMetadataClient(
    api,
    state,
    () => visible,
    (v) => {
      visible = v;
    },
    scope.signal,
    readOnly,
  );
  return {
    client,
    api,
    scope,
    get visible() {
      return visible;
    },
    get state() {
      return state;
    },
    edit: (fn: (v: ProjectMetadata) => void) => fn(visible),
    remote: (key: string, value: MetadataState["registers"][string]["value"]) => {
      state = structuredClone(state);
      state.revision++;
      state.registers[key] = { revision: state.revision, value };
    },
  };
}
describe("shared comments and front matter", () => {
  it("merges independent fields and different threads without touching text", async () => {
    const f = fixture();
    f.edit((v) => {
      v.coverPage.screenwriter = "Owner";
      v.comments[0].messages.push({ ...v.comments[0].messages[0], id: "msg_reply", text: "Reply" });
    });
    f.remote("cover.director", "Editor");
    f.remote("comment:thread_two", { ...thread(), id: "thread_two" });
    await f.client.sync();
    expect(f.visible.coverPage).toMatchObject({ screenwriter: "Owner", director: "Editor" });
    expect(f.visible.comments).toHaveLength(2);
    expect(f.visible.comments[0].messages).toHaveLength(2);
    expect(f.client.hasPending()).toBe(false);
  });
  it("retains local draft on conflicting edits of the same field/thread", async () => {
    const f = fixture();
    f.edit((v) => {
      v.comments[0].messages[0].text = "Local draft";
    });
    f.remote("comment:thread_one", {
      ...thread(),
      messages: [{ ...thread().messages[0], text: "Remote draft" }],
    });
    await expect(f.client.sync()).rejects.toMatchObject({ status: 409 });
    expect(f.visible.comments[0].messages[0].text).toBe("Local draft");
    expect(f.api.writeProjectMetadata).not.toHaveBeenCalled();
  });
  it("retries uncertain writes with identical operation and bytes, then sends newer edits", async () => {
    const f = fixture(),
      original = vi.mocked(f.api.writeProjectMetadata).getMockImplementation()!;
    vi.mocked(f.api.writeProjectMetadata).mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new TypeError("network");
    });
    f.edit((v) => {
      v.coverPage.projectName = "First";
    });
    await expect(f.client.sync()).rejects.toThrow("network");
    f.edit((v) => {
      v.coverPage.projectName = "Second";
    });
    await f.client.sync();
    const calls = vi.mocked(f.api.writeProjectMetadata).mock.calls;
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2][1].operationId).not.toBe(calls[0][1].operationId);
    expect(f.visible.coverPage.projectName).toBe("Second");
    expect(f.client.hasPending()).toBe(false);
  });
  it("keeps tombstones; a stale comment cannot resurrect after deletion", async () => {
    const f = fixture();
    f.edit((v) => {
      v.comments = [];
    });
    await f.client.sync();
    expect(f.state.registers["comment:thread_one"].value).toBeNull();
    expect(metadataFromRegisters(f.state.registers).comments).toEqual([]);
    const g = fixture();
    g.edit((v) => {
      v.comments[0].messages[0].text = "Offline edit";
    });
    g.remote("comment:thread_one", null);
    await expect(g.client.sync()).rejects.toMatchObject({ status: 409 });
    expect(g.visible.comments).toHaveLength(1);
  });
  it("readers receive changes but never write, including a corrupted local cache", async () => {
    const f = fixture(true);
    f.remote("cover.hidden", true);
    await f.client.sync();
    expect(f.visible.coverPageHidden).toBe(true);
    f.edit((v) => {
      v.coverPage.director = "Attempt";
    });
    await f.client.sync();
    expect(f.api.writeProjectMetadata).not.toHaveBeenCalled();
  });
  it("ignores a late response after logout/close", async () => {
    const f = fixture();
    let finish!: (value: MetadataResponse) => void;
    vi.mocked(f.api.getProjectMetadata).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const running = f.client.sync();
    f.scope.abort();
    f.client.stop();
    finish({
      contractVersion: "2026-09-v10",
      request_id: "t",
      status: "current",
      conflictKeys: [],
      replayed: false,
      state: {
        ...f.state,
        registers: { ...f.state.registers, title: { revision: 0, value: "Late" } },
      },
    });
    await running;
    expect(f.visible.title).toBe("Test");
  });
  it("rejects wrong scope, oversized/malformed data and forged authorization fields", () => {
    const body = {
      operationId: crypto.randomUUID(),
      changes: [{ key: "cover.projectName", expectedRevision: 0, value: "Good" }],
    };
    expect(validateMetadataWrite(body)).toEqual(body);
    for (const invalid of [
      { ...body, actorId: "owner" },
      { ...body, changes: [{ ...body.changes[0], value: "x".repeat(4097) }] },
      { ...body, changes: [...body.changes, ...body.changes] },
      { ...body, changes: [{ ...body.changes[0], key: "__proto__" }] },
    ])
      expect(() => validateMetadataWrite(invalid)).toThrow();
    const malformed = thread();
    (malformed.anchor as unknown as Record<string, unknown>).blockId = 123;
    expect(() =>
      validateMetadataWrite({
        ...body,
        changes: [{ key: "comment:thread_one", expectedRevision: 0, value: malformed }],
      }),
    ).toThrow();
    expect(() => parseMetadataResponse({ state: {}, contractVersion: "2026-09-v10" })).toThrow();
  });
  it("derives moved/lost anchors; automatic offsets do not produce comment writes", () => {
    const f = fixture(),
      doc = (text: string) => ({
        type: "doc",
        content: [
          { type: "paragraph", attrs: { blockId: "block_one" }, content: [{ type: "text", text }] },
        ],
      });
    const moved = resolveProjectCommentAnchors([thread()], doc("Prefix hello"));
    expect(moved[0].anchor).toMatchObject({ startOffset: 7, endOffset: 12, lost: false });
    expect(metadataDiff(f.state.registers, { ...f.visible, comments: moved })).toEqual([]);
    expect(resolveProjectCommentAnchors([thread()], doc("Deleted"))[0].anchor.lost).toBe(true);
    expect(resolveProjectCommentAnchors([thread()], doc("Prefix hello hello"))[0].anchor.lost).toBe(
      true,
    );
    expect(
      resolveProjectCommentAnchors(
        [{ ...thread(), anchor: { ...thread().anchor, lost: true } }],
        doc("hello"),
      )[0].anchor.lost,
    ).toBe(false);
  });
  it("annotation marks never emit v8 text writes; formatting edits still do", () => {
    const before = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_one" },
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    };
    const after = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "block_one" },
          content: [
            {
              type: "text",
              text: "hello",
              marks: [{ type: "commentAnchor", attrs: { threadId: "one" } }],
            },
            { type: "text", text: " world" },
          ],
        },
      ],
    };
    expect(diffScenarioBlocks(before, after)).toEqual([]);
    after.content[0].content[0].marks = [{ type: "bold", attrs: { threadId: "one" } }];
    expect(diffScenarioBlocks(before, after)).toHaveLength(1);
  });
});
