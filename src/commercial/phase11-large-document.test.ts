import { expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import type { CollaborativeOperationRecord } from './contractsV8';
import { CollaborationDocument, applyScenarioMutation } from './collaborationDocument';

const block = (id: number): JSONContent => ({ type: 'paragraph', attrs: { blockId: `block-${id}`, scenarioType: 'ACTION' }, content: [{ type: 'text', text: `Synthetic paragraph ${id}. `.repeat(10) }] });
const record = (index: number): CollaborativeOperationRecord => ({
  studioId: 'studio', scenarioId: 'scenario', baseVersionId: 'immutable-root', operationId: `operation-${index}`,
  actorId: `actor-${index % 3}`, clientSequence: index + 1, logicalClock: index + 1,
  checksum: 'a'.repeat(64), request_id: 'synthetic-request', cursor: index + 1, receivedAt: '2026-09-12T00:00:00Z',
  mutation: index % 10 === 0 ? { type: 'block.delete', blockId: `block-${index}` } : {
    type: 'block.upsert', blockId: `block-${index}`, afterBlockId: index > 0 ? `block-${index - 1}` : null,
    block: { ...block(index), content: [{ type: 'text', text: `Updated synthetic paragraph ${index}` }] },
  },
});

it('5,000 paragraphs converge across three replicas with 1,000 operations, duplicate/reversed delivery', () => {
  const base: JSONContent = { type: 'doc', content: Array.from({ length: 5000 }, (_, i) => block(i)) };
  const original = JSON.stringify(base);
  const operations = Array.from({ length: 1000 }, (_, i) => record(i));
  const replicas = Array.from({ length: 3 }, () => new CollaborationDocument(base));
  operations.forEach((op) => replicas[0].accept(op));
  [...operations].reverse().concat(operations).forEach((op) => replicas[1].accept(op));
  [...operations.filter((_, i) => i % 2), ...operations.filter((_, i) => !(i % 2))].forEach((op) => replicas[2].accept(op));
  const started = performance.now();
  const results = replicas.map((replica) => replica.read());
  expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
  expect(results[0].content).toHaveLength(4900);
  expect(JSON.stringify(base)).toBe(original);
  // Conservative local regression guard, not a claim about hosted/UI latency.
  expect(performance.now() - started).toBeLessThan(5000);
  results[0].content!.splice(0, 10);
  expect(replicas[0].read().content).toHaveLength(4900);
}, 15_000);

it('batched projection equals the historical per-operation projection, including moves/tombstones', () => {
  const base: JSONContent = { type: 'doc', content: Array.from({ length: 50 }, (_, i) => block(i)) };
  const operations = Array.from({ length: 40 }, (_, i) => record(i));
  const replica = new CollaborationDocument(base);
  operations.forEach((op) => replica.accept(op));
  expect(replica.read()).toEqual(operations.reduce((doc, op) => applyScenarioMutation(doc, op.mutation), base));
});

it('backpressure rejects before mutating the accepted state', () => {
  const replica = new CollaborationDocument({ type: 'doc', content: [] });
  Array.from({ length: 4096 }, (_, i) => record(i)).forEach((op) => replica.accept(op));
  const before = replica.read();
  expect(() => replica.accept(record(4096))).toThrow('Document recovery required');
  expect(replica.read()).toEqual(before);
});
