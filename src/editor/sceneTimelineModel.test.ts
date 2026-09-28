import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { addScenarioAct, addScenarioScene, deleteScenarioAct, duplicateScenarioScene, ensureScenarioSceneActs, getScenarioActCount, getScenarioActDescriptions, getScenarioSceneAtPosition, getScenarioScenePreviewBlocks, getScenarioScenes, removeScenarioScene, reorderScenarioSceneGroup, reorderScenarioScenes, updateScenarioActDescription, updateScenarioScene } from './sceneTimelineModel';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      attrs: {
        scenarioType: { default: 'ACTION' },
        ending: { default: false },
        blockId: { default: null },
        whiteboardAct: { default: null },
        whiteboardActCount: { default: null },
        whiteboardActDescriptions: { default: '' },
        whiteboardSummary: { default: '' },
        whiteboardTag: { default: '' },
        whiteboardColor: { default: '' },
        breakdownData: { default: '' },
      },
    },
    text: { group: 'inline' },
  },
});
const paragraph = (type: string, id: string, text = '') => schema.node('paragraph', {
  scenarioType: type,
  ending: false,
  blockId: id,
}, text ? [schema.text(text)] : []);
const fixture = () => schema.node('doc', null, [
  paragraph('ACTION', 'preamble', 'Note avant le scénario'),
  paragraph('SCENE_HEADING', 'scene-a', 'INT. ATELIER - JOUR'),
  paragraph('ACTION', 'a-action', 'Action A'),
  paragraph('DIALOGUE', 'a-dialogue', 'Dialogue A'),
  paragraph('SCENE_HEADING', 'scene-b', 'EXT. RUE - NUIT'),
  paragraph('ACTION', 'b-action', 'Action B'),
  paragraph('SCENE_HEADING', 'scene-c'),
  paragraph('TRANSITION', 'c-transition', 'COUPE À :'),
]);

function editableDocument(document = fixture()) {
  let state = EditorState.create({ schema, doc: document });
  const editor = {
    isEditable: true,
    get state() { return state; },
    view: { dispatch(transaction: Parameters<typeof state.apply>[0]) { state = state.apply(transaction); } },
  } as unknown as Editor;
  return { editor, read: () => state.doc };
}

describe('projection structurelle de la timeline des scènes', () => {
  it('dérive les titres, positions et blocs directement du document', () => {
    const document = fixture();
    const scenes = getScenarioScenes(document);
    expect(scenes.map(scene => [scene.id, scene.title])).toEqual([
      ['scene-a', 'INT. ATELIER - JOUR'],
      ['scene-b', 'EXT. RUE - NUIT'],
      ['scene-c', 'Scène sans titre'],
    ]);
    expect(scenes[0].blockIds).toEqual(['scene-a', 'a-action', 'a-dialogue']);
    expect(getScenarioSceneAtPosition(document, scenes[1].from + 2)?.id).toBe('scene-b');
    expect(getScenarioSceneAtPosition(document, 1)).toBeNull();
  });

  it('déplace le bloc complet sans modifier le document source', () => {
    const original = fixture();
    const moved = reorderScenarioScenes(original, 'scene-a', 3);
    expect(getScenarioScenes(moved).map(scene => scene.id)).toEqual(['scene-b', 'scene-c', 'scene-a']);
    expect(moved.child(0).textContent).toBe('Note avant le scénario');
    expect(moved.content.content.map(node => node.attrs.blockId)).toEqual([
      'preamble', 'scene-b', 'b-action', 'scene-c', 'c-transition', 'scene-a', 'a-action', 'a-dialogue',
    ]);
    expect(getScenarioScenes(original).map(scene => scene.id)).toEqual(['scene-a', 'scene-b', 'scene-c']);
  });

  it('ignore les dépôts sans effet et borne les emplacements', () => {
    const original = fixture();
    expect(reorderScenarioScenes(original, 'scene-b', 1)).toBe(original);
    expect(reorderScenarioScenes(original, 'scene-b', 2)).toBe(original);
    expect(getScenarioScenes(reorderScenarioScenes(original, 'scene-c', -20)).map(scene => scene.id))
      .toEqual(['scene-c', 'scene-a', 'scene-b']);
  });

  it('déplace atomiquement une sélection dans un acte en gardant les blocs groupés', () => {
    const original = fixture();
    const moved = reorderScenarioSceneGroup(original, ['scene-a', 'scene-c'], 2, 1);
    const scenes = getScenarioScenes(moved);
    expect(scenes.map(scene => scene.id)).toEqual(['scene-b', 'scene-a', 'scene-c']);
    expect(scenes.map(scene => scene.act)).toEqual([2, 2, 2]);
    expect(moved.content.content.map(node => node.attrs.blockId)).toEqual([
      'preamble', 'scene-b', 'b-action', 'scene-a', 'a-action', 'a-dialogue', 'scene-c', 'c-transition',
    ]);
  });

  it('ajoute une scène vierge à la fin de l’acte demandé', () => {
    const { editor, read } = editableDocument();
    ensureScenarioSceneActs(editor);
    const createdId = addScenarioScene(editor, 2);
    expect(createdId).toBeTruthy();
    const scenes = getScenarioScenes(read());
    expect(scenes.map(scene => scene.id)).toEqual(['scene-a', 'scene-b', createdId, 'scene-c']);
    expect(scenes.find(scene => scene.id === createdId)?.act).toBe(2);
    expect(scenes.find(scene => scene.id === createdId)?.title).toBe('Scène sans titre');
  });

  it('projette les métadonnées du Whiteboard depuis le titre de scène', () => {
    const document = fixture();
    const heading = document.child(1);
    const decorated = document.copy(document.content.replaceChild(1, heading.type.create({
      ...heading.attrs,
      whiteboardAct: 3,
      whiteboardSummary: 'Le secret est révélé.',
      whiteboardTag: 'Intrigue B',
      whiteboardColor: 'turquoise',
    }, heading.content)));
    expect(getScenarioScenes(decorated)[0]).toMatchObject({
      id: 'scene-a',
      act: 3,
      summary: 'Le secret est révélé.',
      tag: 'Intrigue B',
      color: 'turquoise',
    });
  });

  it('initialise les actes une seule fois puis conserve les métadonnées éditées', () => {
    const subject = editableDocument();
    expect(ensureScenarioSceneActs(subject.editor)).toBe(true);
    expect(ensureScenarioSceneActs(subject.editor)).toBe(false);
    expect(getScenarioScenes(subject.read()).map(scene => scene.act)).toEqual([1, 2, 3]);
    expect(updateScenarioScene(subject.editor, 'scene-b', {
      title: 'INT. CUISINE - SOIR',
      summary: 'Une révélation change la direction du récit.',
      tag: 'Intrigue principale',
      color: 'blue',
    })).toBe(true);
    expect(getScenarioScenes(subject.read())[1]).toMatchObject({
      title: 'INT. CUISINE - SOIR',
      summary: 'Une révélation change la direction du récit.',
      tag: 'Intrigue principale',
      color: 'blue',
    });
  });

  it('ajoute un acte vide sans déplacer ni dupliquer les scènes', () => {
    const subject = editableDocument();
    ensureScenarioSceneActs(subject.editor);
    expect(addScenarioAct(subject.editor)).toBe(true);
    expect(getScenarioActCount(subject.read())).toBe(4);
    expect(getScenarioScenes(subject.read()).map(scene => [scene.id, scene.act])).toEqual([
      ['scene-a', 1], ['scene-b', 2], ['scene-c', 3],
    ]);
    expect(getScenarioScenes(subject.read()).flatMap(scene => scene.blockIds)).toHaveLength(7);
  });

  it('supprime un acte en conservant ses scènes et renumérote les actes suivants', () => {
    const subject = editableDocument();
    ensureScenarioSceneActs(subject.editor);
    addScenarioAct(subject.editor);
    expect(updateScenarioScene(subject.editor, 'scene-c', { act: 4 })).toBe(true);
    expect(getScenarioScenes(subject.read()).map(scene => [scene.id, scene.act])).toEqual([
      ['scene-a', 1], ['scene-b', 2], ['scene-c', 4],
    ]);
    const contentBefore = subject.read().textContent;
    expect(deleteScenarioAct(subject.editor, 2)).toBe(true);
    expect(getScenarioActCount(subject.read())).toBe(3);
    expect(getScenarioScenes(subject.read()).map(scene => [scene.id, scene.act])).toEqual([
      ['scene-a', 1], ['scene-b', 1], ['scene-c', 3],
    ]);
    expect(subject.read().textContent).toBe(contentBefore);
  });

  it('conserve les descriptions éditées lorsque la structure des actes change', () => {
    const subject = editableDocument();
    ensureScenarioSceneActs(subject.editor);
    expect(getScenarioActDescriptions(subject.read())).toEqual([
      'Mise en place', 'Confrontation', 'Résolution',
    ]);
    expect(updateScenarioActDescription(subject.editor, 2, 'Pivot central')).toBe(true);
    expect(addScenarioAct(subject.editor)).toBe(true);
    expect(getScenarioActDescriptions(subject.read())).toEqual([
      'Mise en place', 'Pivot central', 'Résolution', 'Section narrative',
    ]);
    expect(deleteScenarioAct(subject.editor, 1)).toBe(true);
    expect(getScenarioActDescriptions(subject.read())).toEqual([
      'Pivot central', 'Résolution', 'Section narrative',
    ]);
  });

  it('duplique le bloc complet avec de nouveaux identifiants sans toucher à la source', () => {
    const subject = editableDocument();
    const original = getScenarioScenes(subject.read())[0];
    const duplicateId = duplicateScenarioScene(subject.editor, original.id);
    const scenes = getScenarioScenes(subject.read());
    expect(duplicateId).toBeTruthy();
    expect(scenes.map(scene => scene.title)).toEqual([
      'INT. ATELIER - JOUR',
      'INT. ATELIER - JOUR',
      'EXT. RUE - NUIT',
      'Scène sans titre',
    ]);
    expect(scenes[1].blockIds).toHaveLength(original.blockIds.length);
    expect(scenes[1].blockIds.some(id => original.blockIds.includes(id))).toBe(false);
    expect(new Set(scenes.flatMap(scene => scene.blockIds)).size)
      .toBe(scenes.flatMap(scene => scene.blockIds).length);
  });

  it('supprime une scène entière et conserve les autres intactes', () => {
    const removed = removeScenarioScene(fixture(), 'scene-b');
    expect(getScenarioScenes(removed).map(scene => scene.id)).toEqual(['scene-a', 'scene-c']);
    expect(removed.content.content.map(node => node.attrs.blockId)).not.toContain('b-action');
    expect(removed.textContent).not.toContain('Action B');
    expect(removed.textContent).toContain('Dialogue A');
  });

  it('projette uniquement les blocs réels de la scène dans l’aperçu en lecture seule', () => {
    expect(getScenarioScenePreviewBlocks(fixture(), 'scene-a')).toEqual([
      { id: 'scene-a', type: 'SCENE_HEADING', text: 'INT. ATELIER - JOUR', ending: false },
      { id: 'a-action', type: 'ACTION', text: 'Action A', ending: false },
      { id: 'a-dialogue', type: 'DIALOGUE', text: 'Dialogue A', ending: false },
    ]);
    expect(getScenarioScenePreviewBlocks(fixture(), 'missing')).toEqual([]);
  });

  it('la suppression de la dernière scène laisse un document éditable sans scène artificielle', () => {
    const only = schema.node('doc', null, [
      paragraph('SCENE_HEADING', 'only', 'INT. PIÈCE - JOUR'),
      paragraph('ACTION', 'inside', 'Tout le contenu'),
    ]);
    const empty = removeScenarioScene(only, 'only');
    expect(empty.childCount).toBe(1);
    expect(empty.child(0).attrs.scenarioType).toBe('ACTION');
    expect(empty.textContent).toBe('');
    expect(getScenarioScenes(empty)).toEqual([]);
  });
});
