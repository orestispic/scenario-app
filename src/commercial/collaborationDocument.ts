import type { JSONContent } from '@tiptap/core';
import type { CollaborativeMutation, CollaborativeOperationRecord } from './contractsV8';

export function blockId(block: JSONContent): string | null {
  const value = block.attrs?.blockId;
  return typeof value === 'string' && value ? value : null;
}

export function applyScenarioMutation(document: JSONContent, mutation: CollaborativeMutation): JSONContent {
  const content = structuredClone(document.content ?? []);
  const current = content.findIndex((block) => blockId(block) === mutation.blockId);
  if (current >= 0) content.splice(current, 1);
  if (mutation.type === 'block.delete') return { ...structuredClone(document), content };
  const block = structuredClone(mutation.block) as JSONContent;
  // The envelope is the identity authority, including legacy fixture blocks.
  block.attrs = { ...block.attrs, blockId: mutation.blockId };
  const after = mutation.afterBlockId === null ? -1 : content.findIndex((item) => blockId(item) === mutation.afterBlockId);
  content.splice(after < 0 && mutation.afterBlockId !== null ? content.length : after + 1, 0, block);
  return { ...structuredClone(document), content };
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
    if (!previous || tuple(operation) > tuple(previous))
      this.registers.set(operation.mutation.blockId, structuredClone(operation));
    if (this.registers.size > 4096) throw Object.assign(new Error('Document recovery required'), { code: 'local_backpressure', status: 413 });
  }

  read(): JSONContent {
    return [...this.registers.values()].sort((a, b) => tuple(a).localeCompare(tuple(b)))
      .reduce((document, operation) => applyScenarioMutation(document, operation.mutation), structuredClone(this.base));
  }

  clear() { this.base = { type: 'doc', content: [] }; this.registers.clear(); }
}
