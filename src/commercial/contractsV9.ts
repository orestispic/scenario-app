import type { CloudScenario } from './contractsV6';
import type { StudioInvitationView, StudioSpace } from './contractsV7';
import { parseCloudScenarioListResponse } from './contractsV6';
import { parseStudioListResponse } from './contractsV7';

export const COMMERCIAL_CONTRACT_VERSION_V9 = '2026-09-v9' as const;
export interface CloudProject extends CloudScenario {
  sharing: 'private' | 'shared';
  memberCount: number;
  realtimeStudioId: string | null;
  realtimeBaseVersionId: string | null;
  canShare: boolean;
}
export interface CloudProjectListResponse {
  contractVersion: typeof COMMERCIAL_CONTRACT_VERSION_V9;
  projects: CloudProject[];
  receivedInvitations: StudioInvitationView[];
  request_id: string;
}
export interface CloudProjectSharingResponse {
  contractVersion: typeof COMMERCIAL_CONTRACT_VERSION_V9;
  studio: StudioSpace;
  replayed: boolean;
  request_id: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function envelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse des projets invalide.');
  const data = value as Record<string, unknown>;
  if (data.contractVersion !== COMMERCIAL_CONTRACT_VERSION_V9 || typeof data.request_id !== 'string') throw new Error('Version des projets incompatible.');
  return data;
}
export function parseCloudProjects(value: unknown): CloudProjectListResponse {
  const data = envelope(value);
  parseCloudScenarioListResponse({ contractVersion: '2026-09-v6', scenarios: data.projects, request_id: data.request_id });
  parseStudioListResponse({ contractVersion: '2026-09-v7', studios: [], receivedInvitations: data.receivedInvitations, request_id: data.request_id });
  const projects = data.projects as CloudProject[];
  const ids = new Set<string>();
  for (const p of projects) {
    if (!uuid.test(p.id) || ids.has(p.id) || !Number.isSafeInteger(p.memberCount) || p.memberCount < 1 ||
        p.sharing !== (p.memberCount > 1 ? 'shared' : 'private') || typeof p.canShare !== 'boolean' ||
        (p.canShare && (p.role !== 'owner' || p.deletedAt !== null)) ||
        (p.realtimeStudioId !== null && !uuid.test(p.realtimeStudioId)) ||
        (p.realtimeBaseVersionId !== null && !uuid.test(p.realtimeBaseVersionId)) ||
        (p.realtimeStudioId === null && p.realtimeBaseVersionId !== null)) throw new Error('Projet cloud invalide.');
    ids.add(p.id);
  }
  return data as unknown as CloudProjectListResponse;
}
export function parseProjectSharing(value: unknown): CloudProjectSharingResponse {
  const data = envelope(value);
  parseStudioListResponse({ contractVersion: '2026-09-v7', studios: [data.studio], receivedInvitations: [], request_id: data.request_id });
  if (typeof data.replayed !== 'boolean') throw new Error('Partage invalide.');
  return data as unknown as CloudProjectSharingResponse;
}
export function parseProjectInvitationResponse(value: unknown): void {
  const data = envelope(value);
  if (data.responded !== true || typeof data.replayed !== 'boolean') throw new Error('Réponse à l’invitation invalide.');
}
