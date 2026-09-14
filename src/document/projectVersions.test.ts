import { describe, expect, it } from 'vitest';
import { parseScenarioFile } from './scenarioFile';
import { addProjectVersion, captureVersion, deleteProjectVersion, ensureVersionedProject, nextVersionName,
  renameProjectVersion, restoreProjectVersion, selectProjectVersion } from './projectVersions';

const fixture = () => parseScenarioFile(JSON.stringify({
  formatVersion: 1, title: 'Mon film', savedAt: '2026-09-14T10:00:00.000Z',
  content: { type: 'doc', content: [{ type: 'paragraph', attrs: { scenarioType: 'ACTION', blockId: 'block_1' }, content: [{ type: 'text', text: 'Scène originale' }] }] },
  coverPage: { projectName: 'Mon film', screenwriter: 'Alice' },
  comments: [{ id: 'thread_1', status: 'open', createdAt: '2026-09-14T10:00:00.000Z', resolvedAt: null,
    anchor: { sceneId: 'scene_1', blockId: 'block_1', startOffset: 0, endOffset: 5, originalText: 'Scène', lost: false },
    messages: [{ id: 'message_1', text: 'À revoir', createdAt: '2026-09-14T10:00:00.000Z', editedAt: null }] }],
}));

describe('Versions nommées du même projet', () => {
  it('migre le fichier historique sans perdre de contenu, commentaires ou page de garde', () => {
    const original = fixture(), project = ensureVersionedProject(original);
    expect(project.formatVersion).toBe(2);
    expect(project.versions[0].document).toEqual(original);
    expect(parseScenarioFile(JSON.stringify(project))).toEqual(project);
  });
  it('duplique une version sans référence mutable partagée', () => {
    const original = ensureVersionedProject(fixture()), copy = addProjectVersion(original, 'Variante', original.activeVersionId);
    expect(copy.projectId).toBe(original.projectId);
    expect(copy.activeVersionId).not.toBe(original.activeVersionId);
    expect(copy.versions[1].basedOnVersionId).toBe(original.activeVersionId);
    copy.content.content![0].content![0].text = 'Autre texte';
    copy.coverPage.screenwriter = 'Bob'; copy.comments[0].messages[0].text = 'Autre avis';
    const captured = captureVersion(copy, copy), restored = selectProjectVersion(captured, original.activeVersionId);
    expect(restored.content).toEqual(original.content);
    expect(restored.coverPage).toEqual(original.coverPage);
    expect(restored.comments).toEqual(original.comments);
    expect(captured.versions[1].document.comments[0].messages[0].text).toBe('Autre avis');
    expect(original.versions).toHaveLength(1);
  });
  it('crée une version vierge sans reprendre texte, métadonnées, commentaires et couverture', () => {
    const original = ensureVersionedProject(fixture()), blank = addProjectVersion(original, 'Essai vide', null);
    expect(blank.content.content![0].content).toBeUndefined();
    expect(blank.comments).toEqual([]);
    expect(Object.values(blank.coverPage).every(v => v === '')).toBe(true);
    expect(blank.characters).toEqual([]);
    expect(blank.versions[0].document).toEqual(original.versions[0].document);
  });
  it('duplique la source choisie même quand une autre version est active', () => {
    const original = ensureVersionedProject(fixture()), blank = addProjectVersion(original, 'Vide', null);
    const copied = addProjectVersion(blank, 'Copie originale', original.activeVersionId);
    expect(copied.content).toEqual(original.content);
    expect(copied.versions[1].document.content).toEqual(blank.content);
  });
  it('capture les dernières modifications et conserve les dates en l’absence de changement', () => {
    const project = ensureVersionedProject(fixture()), live = fixture(); live.savedAt = '2026-09-14T11:00:00.000Z';
    const same = captureVersion(project, live);
    expect(same.savedAt).toBe(live.savedAt);
    expect(same.versions[0].document.savedAt).toBe(project.versions[0].document.savedAt);
    live.content.content![0].content![0].text = 'Nouvelle fin';
    const updated = captureVersion(same, live), next = addProjectVersion(updated, 'Version 2', null);
    expect(selectProjectVersion(next, project.activeVersionId).content).toEqual(live.content);
    expect(updated.versions[0].document.savedAt).toBe(live.savedAt);
  });
  it('refuse de supprimer la dernière version', () => {
    const project = ensureVersionedProject(fixture());
    expect(() => deleteProjectVersion(project, project.activeVersionId)).toThrow('dernière version');
  });
  it('supprime de façon récupérable, change de sélection puis restaure sans perte', () => {
    const original = ensureVersionedProject(fixture()), next = addProjectVersion(original, 'Version 2', null);
    const deleted = deleteProjectVersion(next, original.activeVersionId);
    expect(deleted.activeVersionId).toBe(next.activeVersionId);
    expect(() => selectProjectVersion(deleted, original.activeVersionId)).toThrow();
    const restored = restoreProjectVersion(parseScenarioFile(JSON.stringify(deleted)) as typeof deleted, original.activeVersionId);
    expect(restored.content).toEqual(original.content);
    expect(restored.comments).toEqual(original.comments);
    expect(restored.versions[1].document).toEqual(next.versions[1].document);
    expect(deleteProjectVersion(next, next.activeVersionId).activeVersionId).toBe(original.activeVersionId);
  });
  it('évite les noms ambigus et ne remplace jamais une version lors du renommage', () => {
    const original = ensureVersionedProject(fixture()), next = addProjectVersion(original, 'Version 2', null);
    expect(() => renameProjectVersion(next, next.activeVersionId, ' VERSION 1 ')).toThrow('déjà');
    expect(() => addProjectVersion(next, ' ', null)).toThrow();
    expect(nextVersionName(next)).toBe('Version 3');
    const renamed = renameProjectVersion(next, next.activeVersionId, 'Fin alternative');
    expect(renamed.versions[0]).toEqual(original.versions[0]);
    expect(renamed.versions[1].document).toEqual(next.versions[1].document);
  });
  it('restaure sous un autre nom si le nom a été réutilisé', () => {
    const original = ensureVersionedProject(fixture()), next = addProjectVersion(original, 'Version 2', null);
    const deleted = deleteProjectVersion(next, original.activeVersionId);
    const reused = renameProjectVersion(deleted, next.activeVersionId, 'Version 1');
    const restored = restoreProjectVersion(reused, original.activeVersionId);
    expect(restored.versions[0].name).not.toBe(restored.versions[1].name);
    expect(restored.content).toEqual(original.content);
  });
  it.each(['duplicate-id', 'missing-active', 'deleted-active', 'content-mismatch', 'cover-mismatch', 'comments-mismatch', 'corrupt-comments', 'invalid-date', 'v1-envelope'])('refuse un fichier incohérent : %s', damage => {
    const project = ensureVersionedProject(fixture());
    const value: any = structuredClone(project);
    if (damage === 'duplicate-id') value.versions.push(structuredClone(value.versions[0]));
    if (damage === 'missing-active') value.activeVersionId = 'missing';
    if (damage === 'deleted-active') value.versions[0].deletedAt = value.savedAt;
    if (damage === 'content-mismatch') value.content = { type: 'doc', content: [] };
    if (damage === 'cover-mismatch') value.coverPage.screenwriter = 'Mismatch';
    if (damage === 'comments-mismatch') value.comments = [];
    if (damage === 'corrupt-comments') { value.versions[0].document.comments.push({ broken: true }); value.comments = value.versions[0].document.comments; }
    if (damage === 'invalid-date') value.savedAt = 'invalid';
    if (damage === 'v1-envelope') value.formatVersion = 1;
    expect(() => parseScenarioFile(JSON.stringify(value))).toThrow();
    expect(project.versions[0].document).toEqual(fixture());
  });
});
