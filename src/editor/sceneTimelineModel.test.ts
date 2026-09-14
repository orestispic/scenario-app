import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { getScenarioSceneAtPosition, getScenarioScenes, removeScenarioScene, reorderScenarioScenes } from './sceneTimelineModel';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      attrs: { scenarioType: { default: 'ACTION' }, ending: { default: false }, blockId: { default: null } },
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

  it('supprime une scène entière et conserve les autres intactes', () => {
    const removed = removeScenarioScene(fixture(), 'scene-b');
    expect(getScenarioScenes(removed).map(scene => scene.id)).toEqual(['scene-a', 'scene-c']);
    expect(removed.content.content.map(node => node.attrs.blockId)).not.toContain('b-action');
    expect(removed.textContent).not.toContain('Action B');
    expect(removed.textContent).toContain('Dialogue A');
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
