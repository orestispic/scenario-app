import { describe, expect, it } from 'vitest';
import {
  parseCollaborationConnectionResponse,
  parseCollaborationOperationResponse,
  parseCollaborationTicketResponse,
} from './contractsV8';
import {
  applyScenarioMutation,
  diffScenarioBlocks,
} from './collaborationClient';

describe('contrats collaboratifs v8', () => {
  it('valide les tickets à usage unique sans accepter un contrat antérieur', () => {
    expect(
      parseCollaborationTicketResponse({
        contractVersion: '2026-09-v8',
        ticket: 'opaque',
        expiresAt: '2026-09-17T00:00:00.000Z',
        maximumUses: 1,
        request_id: 'request',
      }).maximumUses,
    ).toBe(1);
    expect(() =>
      parseCollaborationTicketResponse({ contractVersion: '2026-09-v7' }),
    ).toThrow();
  });

  it('valide connexion et conflit explicite', () => {
    expect(
      parseCollaborationConnectionResponse({
        contractVersion: '2026-09-v8',
        connectionId: 'connection',
        studioId: 'studio',
        scenarioId: 'scenario',
        role: 'editor',
        cursor: 2,
        presence: [
          {
            profileId: 'profile',
            displayName: 'Auteur',
            role: 'editor',
            connectionCount: 1,
            lastHeartbeatAt: '2026-09-17T00:00:00.000Z',
          },
        ],
        limits: {},
        request_id: 'request',
      }).role,
    ).toBe('editor');
    expect(
      parseCollaborationOperationResponse({
        contractVersion: '2026-09-v8',
        status: 'conflict',
        nextCursor: 3,
        conflict: { recovery: ['keep_local', 'accept_remote', 'create_copy'] },
        request_id: 'request',
      }).status,
    ).toBe('conflict');
  });
});

describe('adaptateur borné de l’éditeur existant', () => {
  const first = {
    type: 'paragraph',
    attrs: { blockId: 'a' },
    content: [{ type: 'text', text: 'A' }],
  };
  const second = {
    type: 'paragraph',
    attrs: { blockId: 'b' },
    content: [{ type: 'text', text: 'B' }],
  };
  it('produit des upserts et tombstones stables au niveau bloc', () => {
    const before = { type: 'doc', content: [first, second] };
    const after = {
      type: 'doc',
      content: [{ ...first, content: [{ type: 'text', text: 'A2' }] }],
    };
    expect(diffScenarioBlocks(before, after)).toEqual([
      expect.objectContaining({ type: 'block.upsert', blockId: 'a' }),
      { type: 'block.delete', blockId: 'b' },
    ]);
  });
  it('applique une opération distante sans remplacer le reste du document', () => {
    const source = { type: 'doc', content: [first, second] };
    const next = applyScenarioMutation(source, {
      type: 'block.upsert',
      blockId: 'b',
      afterBlockId: 'a',
      block: { ...second, content: [{ type: 'text', text: 'B distant' }] },
    });
    expect(next.content?.[0]).toEqual(first);
    expect(next.content?.[1].content?.[0].text).toBe('B distant');
    expect(source.content[1].content[0].text).toBe('B');
  });
});
