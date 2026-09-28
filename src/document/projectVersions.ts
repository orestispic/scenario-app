import { createEmptyCoverPage, parseScenarioFile, type ScenarioFile } from './scenarioFile';
import { collectTechnicalImageAssetIds, normalizeTechnicalImageAssets } from '../editor/technicalImageAssets';

export type VersionDocument = Omit<ScenarioFile, 'projectId' | 'activeVersionId' | 'versions' | 'technicalImageAssets'>;
export interface ProjectVersion {
  id: string;
  name: string;
  createdAt: string;
  basedOnVersionId: string | null;
  deletedAt: string | null;
  document: VersionDocument;
}
export interface VersionedProject extends ScenarioFile {
  formatVersion: 2;
  projectId: string;
  activeVersionId: string;
  versions: ProjectVersion[];
}
const fail = (): never => { throw new Error('Versions du projet invalides. Aucun contenu n’a été remplacé.'); };
const idValid = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const dateValid = (date: unknown): date is string => typeof date === 'string' && Number.isFinite(Date.parse(date));
const clone = <T,>(value: T): T => structuredClone(value);
function documentOf(file: ScenarioFile): VersionDocument {
  const {
    projectId: _project,
    activeVersionId: _active,
    versions: _versions,
    technicalImageAssets: _technicalImageAssets,
    ...document
  } = clone(file);
  return { ...document, formatVersion: 1 };
}
function materialize(project: VersionedProject): VersionedProject {
  const active = project.versions.find(v => v.id === project.activeVersionId && !v.deletedAt);
  if (!active) return fail();
  const technicalImageAssets = normalizeTechnicalImageAssets(project.technicalImageAssets);
  return { ...clone(active.document), formatVersion: 2, title: project.title, savedAt: project.savedAt,
    ...(Object.keys(technicalImageAssets).length ? { technicalImageAssets: clone(technicalImageAssets) } : {}),
    projectId: project.projectId, activeVersionId: active.id, versions: clone(project.versions) };
}
export function ensureVersionedProject(file: ScenarioFile): VersionedProject {
  if (file.formatVersion === 2) return parseVersionedProject(file);
  const id = crypto.randomUUID();
  return materialize({ ...clone(file), formatVersion: 2, projectId: crypto.randomUUID(), activeVersionId: id,
    versions: [{ id, name: 'Version 1', createdAt: new Date().toISOString(), basedOnVersionId: null, deletedAt: null, document: documentOf(file) }] });
}
/** Strict read: never silently discard an unknown, duplicated or damaged version. */
export function parseVersionedProject(value: Partial<ScenarioFile>): VersionedProject {
  if (value.formatVersion !== 2 || !idValid(value.projectId) || !idValid(value.activeVersionId)
    || !Array.isArray(value.versions) || !value.versions.length || value.versions.length > 1000) return fail();
  const ids = new Set<string>(), names = new Set<string>();
  const technicalImageAssets = normalizeTechnicalImageAssets(value.technicalImageAssets);
  const versions = value.versions.map((v): ProjectVersion => {
    if (!v || !idValid(v.id) || ids.has(v.id) || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80
      || !dateValid(v.createdAt) || (v.deletedAt !== null && !dateValid(v.deletedAt))
      || (v.basedOnVersionId !== null && !idValid(v.basedOnVersionId))
      || !v.document || v.document.formatVersion !== 1) return fail();
    const key = v.name.trim().toLocaleLowerCase('fr-FR');
    if (!v.deletedAt && names.has(key)) return fail();
    if (!v.deletedAt) names.add(key);
    ids.add(v.id);
    const document = parseScenarioFile(JSON.stringify(v.document));
    if (!Array.isArray(document.content.content)
      || JSON.stringify(document.comments) !== JSON.stringify(v.document.comments)
      || JSON.stringify(document.coverPage) !== JSON.stringify(v.document.coverPage)) return fail();
    for (const [assetId, asset] of Object.entries(normalizeTechnicalImageAssets(document.technicalImageAssets))) {
      if (technicalImageAssets[assetId] && JSON.stringify(technicalImageAssets[assetId]) !== JSON.stringify(asset)) return fail();
      technicalImageAssets[assetId] = asset;
    }
    const { technicalImageAssets: _nestedAssets, ...versionDocument } = document;
    return { ...clone(v), document: versionDocument };
  });
  if (versions.some(v => v.basedOnVersionId && (!ids.has(v.basedOnVersionId) || v.basedOnVersionId === v.id))) return fail();
  const active = versions.find(v => v.id === value.activeVersionId && !v.deletedAt);
  if (!active || JSON.stringify(value.content) !== JSON.stringify(active.document.content)) return fail();
  for (const key of ['coverPage', 'coverPageHidden', 'comments', 'characters', 'locations', 'times'] as const)
    if (JSON.stringify(value[key]) !== JSON.stringify(active.document[key])) return fail();
  if (!dateValid(value.savedAt)) return fail();
  return materialize({ ...value, title: typeof value.title === 'string' ? value.title : 'Sans titre',
    ...(Object.keys(technicalImageAssets).length ? { technicalImageAssets } : {}),
    formatVersion: 2, projectId: value.projectId, activeVersionId: value.activeVersionId, versions } as VersionedProject);
}
/** Capture the outgoing version BEFORE any selection/action. No shared references. */
export function captureVersion(project: VersionedProject, live: ScenarioFile): VersionedProject {
  const document = documentOf(live);
  const active = project.versions.find(v => v.id === project.activeVersionId && !v.deletedAt);
  if (!active) return fail();
  const identity = (d: VersionDocument) => JSON.stringify({ ...d, savedAt: '' });
  const versions = project.versions.map(v => v.id === active.id
    ? { ...v, document: identity(v.document) === identity(document) ? v.document : document } : v);
  const availableAssets = { ...(project.technicalImageAssets ?? {}), ...(live.technicalImageAssets ?? {}) };
  const usedAssetIds = new Set(collectTechnicalImageAssetIds(versions.map(version => version.document.content)));
  const technicalImageAssets = Object.fromEntries(Object.entries(availableAssets)
    .filter(([assetId]) => usedAssetIds.has(assetId)));
  return materialize({ ...project, title: live.title, savedAt: live.savedAt,
    technicalImageAssets,
    versions });
}
export function selectProjectVersion(project: VersionedProject, id: string): VersionedProject {
  return materialize({ ...project, activeVersionId: id });
}
export function nextVersionName(project: VersionedProject): string {
  let n = 1;
  while (project.versions.some(v => v.name.toLocaleLowerCase('fr-FR') === `version ${n}`)) n++;
  return `Version ${n}`;
}
function checkedName(project: VersionedProject, name: string, exceptId?: string): string {
  name = name.trim();
  if (!name || name.length > 80) throw new Error('Choisissez un nom de 1 à 80 caractères.');
  if (project.versions.some(v => !v.deletedAt && v.id !== exceptId && v.name.toLocaleLowerCase('fr-FR') === name.toLocaleLowerCase('fr-FR')))
    throw new Error('Une version porte déjà ce nom.');
  return name;
}
export function addProjectVersion(project: VersionedProject, name: string, sourceId: string | null): VersionedProject {
  if (project.versions.length >= 1000) throw new Error('Ce projet contient déjà 1 000 versions.');
  const source = sourceId ? project.versions.find(v => v.id === sourceId && !v.deletedAt) : null;
  if (sourceId && !source) return fail();
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const document: VersionDocument = source ? clone(source.document) : {
    formatVersion: 1, title: project.title, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { scenarioType: 'SCENE_HEADING' } }] },
    characters: [], locations: [], times: [], coverPage: createEmptyCoverPage(), coverPageHidden: false, comments: [], savedAt: now,
  };
  return materialize({ ...project, activeVersionId: id, versions: [...project.versions,
    { id, name: checkedName(project, name), createdAt: now, basedOnVersionId: sourceId, deletedAt: null, document }] });
}
export function renameProjectVersion(project: VersionedProject, id: string, name: string): VersionedProject {
  if (!project.versions.some(v => v.id === id && !v.deletedAt)) return fail();
  const checked = checkedName(project, name, id);
  return materialize({ ...project, versions: project.versions.map(v => v.id === id ? { ...v, name: checked } : v) });
}
/** Permanently removes exactly one version. Descendants keep their independent
 * documents and are reattached to the removed version's parent for a valid graph. */
export function deleteProjectVersion(project: VersionedProject, id: string): VersionedProject {
  const survivors = project.versions.filter(v => v.id !== id && !v.deletedAt);
  if (!survivors.length) throw new Error('La dernière version du projet ne peut pas être supprimée.');
  const removed = project.versions.find(v => v.id === id && !v.deletedAt);
  if (!removed) return fail();
  return materialize({ ...project, activeVersionId: project.activeVersionId === id ? survivors[0].id : project.activeVersionId,
    versions: project.versions.filter(v => v.id !== id).map(v => v.basedOnVersionId === id
      ? { ...v, basedOnVersionId: removed.basedOnVersionId } : v) });
}
export function restoreProjectVersion(project: VersionedProject, id: string): VersionedProject {
  const version = project.versions.find(v => v.id === id && v.deletedAt);
  if (!version) return fail();
  const name = project.versions.some(v => !v.deletedAt && v.name.toLocaleLowerCase('fr-FR') === version.name.toLocaleLowerCase('fr-FR'))
    ? nextVersionName(project) : version.name;
  return materialize({ ...project, activeVersionId: id, versions: project.versions.map(v => v.id === id ? { ...v, name, deletedAt: null } : v) });
}
