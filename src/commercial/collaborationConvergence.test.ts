import { afterEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { JSONContent } from '@tiptap/core';
import { collaborationTransaction } from '../editor/collaborationTransaction';
import { CollaborationDocument, applyScenarioMutation } from './collaborationDocument';
import { StudioCollaborationClient, diffScenarioBlocks, type ScenarioEditorBridge } from './collaborationClient';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CollaborativeOperationRecord, CollaborativeOperationRequest } from './contractsV8';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', attrs: { blockId: { default: null }, scenarioType: { default: 'ACTION' }, ending: { default: false } } },
} });
const block = (id: string, text = id): JSONContent => ({ type: 'paragraph', attrs: { blockId: id }, content: text ? [{ type: 'text', text }] : [] });
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });
function operation(id: string, after: string | null, clock: number, actor = 'owner'): CollaborativeOperationRecord {
  return { studioId: 'studio', scenarioId: 'scenario', baseVersionId: 'root', operationId: `op-${id}-${clock}`, actorId: actor,
    logicalClock: clock, clientSequence: clock, checksum: 'a'.repeat(64), request_id: 'req', cursor: clock, receivedAt: '2026-09-12T00:00:00Z',
    mutation: { type: 'block.upsert', blockId: id, afterBlockId: after, block: block(id) },
  };
}
function bridge(initial: JSONContent) {
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(initial) });
  let listener: ((document: JSONContent) => void) | undefined;
  let readOnly = false;
  const result: ScenarioEditorBridge & { edit(document: JSONContent): void; locked(): boolean } = {
    read: () => state.doc.toJSON(),
    replaceDocument: (next) => { const tr = collaborationTransaction(state, next); if (tr) state = state.apply(tr); },
    subscribe: (next) => { listener = next; return () => { listener = undefined; }; },
    setReadOnly: (next) => { readOnly = next; }, locked: () => readOnly,
    edit: (next) => { if (readOnly) throw new Error('read only'); state = state.apply(state.tr.replaceWith(0, state.doc.content.size, schema.nodeFromJSON(next).content)); listener?.(state.doc.toJSON()); },
  };
  return result;
}

describe('document convergence and actual ProseMirror transactions', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('moves existing blocks, preserves empty paragraphs and does not add remote undo entries', () => {
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc(block('int'), block('empty', ''), block('ext'))) });
    const target = doc(block('ext'), block('int'), block('empty', ''));
    const tr = collaborationTransaction(state, target)!;
    expect(state.apply(tr).doc.toJSON()).toEqual(schema.nodeFromJSON(target).toJSON());
    expect(tr.getMeta('addToHistory')).toBe(false);
    expect(tr.getMeta('scenario-collaboration-remote')).toBe(true);
    expect(collaborationTransaction(state.apply(tr), target)).toBeNull();
  });
  it('emits moves even when the block text did not change', () => {
    const before = doc(block('a'), block('b'));
    const after = doc(block('b'), block('a'));
    expect(diffScenarioBlocks(before, after).reduce(applyScenarioMutation, before)).toEqual(after);
  });
  it('projects LWW winners identically across delivery order, duplicates and late inserts', () => {
    const records = [operation('a', null, 1), operation('b', 'a', 3, 'editor'), operation('c', 'a', 2), operation('a', null, 4)];
    const left = new CollaborationDocument(doc());
    const right = new CollaborationDocument(doc());
    records.forEach((entry) => left.accept(entry));
    [...records].reverse().concat(records).forEach((entry) => right.accept(entry));
    expect(left.read()).toEqual(right.read());
    expect(left.read().content).toHaveLength(3);
  });
  it('does not resurrect a tombstone with a stale write and assigns the envelope block ID', () => {
    const replica = new CollaborationDocument(doc());
    const older = operation('a', null, 1);
    replica.accept({ ...older, operationId: 'delete', logicalClock: 10, mutation: { type: 'block.delete', blockId: 'a' } });
    replica.accept(older);
    expect(replica.read().content).toEqual([]);
    expect(applyScenarioMutation(doc(), { type: 'block.upsert', blockId: 'canonical-id', afterBlockId: null, block: { type: 'paragraph' } }).content?.[0].attrs?.blockId).toBe('canonical-id');
  });

  it('converges three real editor states after concurrent typing, own echoes, retry and reconnect', async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
    const events: CollaborativeOperationRecord[] = [];
    const root = doc(block('shared'));
    const makeApi = (actor: string, viewer = false): AuthenticatedCommercialApi => ({
      issueCollaborationTicket: async () => ({ ticket: 'test' }),
      connectCollaboration: async () => ({ connectionId: actor, role: viewer ? 'viewer' : 'editor', limits: { heartbeatIntervalSeconds: 10 }, presence: [] }),
      heartbeatCollaboration: async () => ({ presence: [], cursor: events.length }),
      pollCollaboration: async (_studio: string, _connection: string, after: number) => ({
        events: events.filter((item) => item.cursor > after).reverse().flatMap((item) => [
          { type: 'operation.applied', cursor: item.cursor, operation: structuredClone(item) },
          { type: 'operation.applied', cursor: item.cursor, operation: structuredClone(item) },
        ]), nextCursor: events.length, syncLag: 0, hasMore: false,
      }),
      submitCollaborationOperation: async (_studio: string, _connection: string, input: CollaborativeOperationRequest) => {
        if (viewer) throw Object.assign(new Error(), { status: 403 });
        const previous = events.find((item) => item.operationId === input.operationId);
        if (previous) return { status: 'replayed', operation: previous, nextCursor: events.length };
        const record = { ...structuredClone(input), actorId: actor, cursor: events.length + 1, request_id: 'req', receivedAt: new Date().toISOString() };
        events.push(record);
        if (events.length === 1) throw Object.assign(new Error(), { status: 504, code: 'request_timeout' });
        return { status: 'applied', operation: record, nextCursor: events.length };
      },
      disconnectCollaboration: async () => {},
    } as unknown as AuthenticatedCommercialApi);
    const editors = [bridge(doc(block('LOCAL-A'))), bridge(doc(block('LOCAL-B'))), bridge(doc(block('LOCAL-C')))];
    const clients = editors.map((editor, i) => new StudioCollaborationClient(makeApi(`actor-${i}`, i === 2), 'studio', 'scenario', 'root', `actor-${i}`, editor, async () => root));
    await Promise.all(clients.map((client) => client.connect()));
    expect(editors[0].read()).toEqual(editors[1].read());
    expect(editors[2].locked()).toBe(true);
    editors[0].edit(doc(block('shared'), block('int', 'INT. VOITURE'), block('empty', '')));
    editors[1].edit(doc(block('shared'), block('ext', 'EXT. VOITURE - NUIT')));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(editors[0].read()).toEqual(editors[1].read());
    expect(editors[1].read()).toEqual(editors[2].read());
    expect(editors[0].read().content?.map((entry) => entry.attrs?.blockId).sort()).toEqual(['empty', 'ext', 'int', 'shared']);
    expect(new Set(events.map((entry) => entry.operationId)).size).toBe(events.length);
    await clients[2].disconnect();
    const rejoined = new StudioCollaborationClient(makeApi('new-viewer', true), 'studio', 'scenario', 'root', 'new-viewer', editors[2], async () => root);
    await rejoined.connect();
    expect(editors[2].read()).toEqual(editors[0].read());
    await Promise.all([...clients, rejoined].map((client) => client.disconnect()));
  });

  it('does not apply a late base download after logout', async () => {
    let release!: (document: JSONContent) => void;
    const editor = bridge(doc(block('keep-local')));
    const before = editor.read();
    const api = { disconnectCollaboration: async () => {} } as unknown as AuthenticatedCommercialApi;
    const client = new StudioCollaborationClient(api, 'studio', 'scenario', 'root', 'actor', editor, () => new Promise((resolve) => { release = resolve; }));
    const connecting = client.connect();
    await client.disconnect();
    release(doc(block('remote')));
    await connecting;
    expect(editor.read()).toEqual(before);
    expect(editor.locked()).toBe(false);
  });
});
