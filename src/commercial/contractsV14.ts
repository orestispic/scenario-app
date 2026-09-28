import { parseCloudProjects, type CloudProject } from './contractsV9';
export interface CloudProjectVersion {
  id: string; projectId: string; name: string; revision: number; createdAt: string;
  deletedAt: string | null; sourceVersionId: string | null; project: CloudProject;
}
export interface VersionCommand {
  action: 'duplicate' | 'blank' | 'rename' | 'delete' | 'restore'; operationId: string;
  name?: string; sourceVersionId?: string; versionId?: string; expectedRevision?: number;
}
export function parseProjectVersions(value: unknown, projectId: string): CloudProjectVersion[] {
  const data = value as { contractVersion?: string; request_id?: string; versions?: CloudProjectVersion[] };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const fail = (): never => { throw new Error('Liste des versions du projet invalide.'); };
  if (!data || data.contractVersion !== '2026-09-v14' || !Array.isArray(data.versions) || !data.versions.length || data.versions.length > 1000) return fail();
  const ids = new Set<string>(), names = new Set<string>();
  for (const v of data.versions) {
    if (!v || !uuid.test(v.id) || ids.has(v.id) || v.projectId !== projectId || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80 || !Number.isSafeInteger(v.revision) || v.revision < 1 || !Number.isFinite(Date.parse(v.createdAt)) || (v.deletedAt !== null && !Number.isFinite(Date.parse(v.deletedAt))) || (v.sourceVersionId !== null && !uuid.test(v.sourceVersionId))) return fail();
    ids.add(v.id);
    if (!v.deletedAt) { const name = v.name.trim().toLowerCase(); if (names.has(name)) return fail(); names.add(name); }
  }
  if (!names.size) return fail();
  parseCloudProjects({ contractVersion: '2026-09-v9', request_id: data.request_id, projects: data.versions.map(v => v.project), receivedInvitations: [] });
  return data.versions;
}
