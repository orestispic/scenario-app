import type { JSONContent } from '@tiptap/core';
import type { CollaborativeMutation, CollaborativeOperationRecord } from './contractsV8';

export function blockId(block: JSONContent): string | null {
  const value = block.attrs?.blockId;
  return typeof value === 'string' && value ? value : null;
}

export function applyScenarioMutation(document: JSONContent, mutation: CollaborativeMutation): JSONContent {
  const result = structuredClone(document);
  result.content ??= [];
  applyToOwnedContent(result.content, mutation);
  return result;
}

/** Only called on an owned clone. Batch projection clones the base once, not
 * several times per operation (important for long screenplay documents).
 */
function applyToOwnedContent(content: JSONContent[], mutation: CollaborativeMutation): void {
  const current = content.findIndex((block) => blockId(block) === mutation.blockId);
  if (current >= 0) content.splice(current, 1);
  if (mutation.type === 'block.delete') return;
  const block = structuredClone(mutation.block) as JSONContent;
  // The envelope is the identity authority, including legacy fixture blocks.
  block.attrs = { ...block.attrs, blockId: mutation.blockId };
  const after = mutation.afterBlockId === null ? -1 : content.findIndex((item) => blockId(item) === mutation.afterBlockId);
  content.splice(after < 0 && mutation.afterBlockId !== null ? content.length : after + 1, 0, block);
}

function tuple(operation: CollaborativeOperationRecord): string {
  return `${String(operation.logicalClock).padStart(16, '0')}:${operation.actorId}:${operation.operationId}`;
}

/** Matches the v8 server's LWW registers, then its ordered snapshot projection.
 * Rebuild from a COMMON immutable base, never from an optimistic editor view.
 */
export class CollaborationDocument {
  private registers = new Map<string, CollaborativeOperationRecord>();
  constructor(private base: JSONContent) { this.base = structuredClone(base); }

  accept(operation: CollaborativeOperationRecord) {
    const previous = this.registers.get(operation.mutation.blockId);
    if (!previous && this.registers.size >= 4096) throw Object.assign(new Error('Document recovery required'), { code: 'local_backpressure', status: 413 });
    if (!previous || tuple(operation) > tuple(previous))
      this.registers.set(operation.mutation.blockId, structuredClone(operation));
  }

  read(): JSONContent {
    const document = structuredClone(this.base);
    document.content ??= [];
    for (const operation of [...this.registers.values()].sort((a, b) => tuple(a).localeCompare(tuple(b))))
      applyToOwnedContent(document.content, operation.mutation);
    return document;
  }

  clear() { this.base = { type: 'doc', content: [] }; this.registers.clear(); }
}
