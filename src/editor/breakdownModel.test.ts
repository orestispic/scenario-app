import type { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  applyAutomaticBreakdownColors,
  createDefaultBreakdown,
  getBreakdownCatalogue,
  getNextAutomaticBreakdownAppearance,
  getBreakdownSuggestionItems,
  getBreakdownSuggestions,
  getProjectBreakdowns,
  updateScenarioBreakdown,
  updateScenarioBreakdowns,
  type SceneBreakdown,
} from './breakdownModel';
import { duplicateScenarioScene, removeScenarioScene, reorderScenarioScenes } from './sceneTimelineModel';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      attrs: {
        scenarioType: { default: 'ACTION' },
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

function paragraph(type: string, id: string, text: string) {
  return schema.node('paragraph', { scenarioType: type, blockId: id }, text ? [schema.text(text)] : []);
}

function fixture() {
  return schema.node('doc', null, [
    paragraph('SCENE_HEADING', 'scene-a', 'INT. ATELIER - JOUR'),
    paragraph('ACTION', 'action-a', 'Une paire de chaussures attend.'),
    paragraph('SCENE_HEADING', 'scene-b', 'EXT. RUE - NUIT'),
    paragraph('ACTION', 'action-b', 'La rue est vide.'),
  ]);
}

function editableDocument() {
  let state = EditorState.create({ schema, doc: fixture() });
  const editor = {
    isEditable: true,
    get state() { return state; },
    view: { dispatch(transaction: Parameters<typeof state.apply>[0]) { state = state.apply(transaction); } },
  } as unknown as Editor;
  return { editor, read: () => state.doc };
}

describe('dépouillement synchronisé avec les scènes', () => {
  it('fournit les sept catégories natives à chaque scène sans données enregistrées', () => {
    const breakdowns = getProjectBreakdowns(fixture());
    expect(breakdowns['scene-a'].categories.map(category => category.name)).toEqual([
      'Personnages', 'Décors', 'Accessoires', 'Costumes', 'Son', 'Besoins spéciaux', 'Notes',
    ]);
    expect(breakdowns['scene-b']).toEqual(createDefaultBreakdown());
  });

  it('enregistre la fiche sur le titre de scène et la conserve pendant un déplacement', () => {
    const { editor, read } = editableDocument();
    const value: SceneBreakdown = { categories: [{
      id: 'props',
      name: 'Accessoires',
      items: [{ id: 'shoes', name: 'Chaussures', hue: 42, secondaryHue: 210 }],
    }] };
    expect(updateScenarioBreakdown(editor, 'scene-a', value)).toBe(true);
    expect(getProjectBreakdowns(read())['scene-a']).toEqual(value);

    const moved = reorderScenarioScenes(read(), 'scene-a', 2);
    expect(getProjectBreakdowns(moved)['scene-a']).toEqual(value);
    expect(getProjectBreakdowns(moved)['scene-b'].categories).toHaveLength(7);
  });

  it('duplique la fiche avec une scène et la retire avec la scène supprimée', () => {
    const { editor, read } = editableDocument();
    const value: SceneBreakdown = { categories: [{
      id: 'characters', name: 'Personnages', items: [{ id: 'lea', name: 'Léa', hue: null, secondaryHue: null }],
    }] };
    updateScenarioBreakdown(editor, 'scene-a', value);
    const duplicateId = duplicateScenarioScene(editor, 'scene-a');
    expect(duplicateId).toBeTruthy();
    expect(getProjectBreakdowns(read())[duplicateId!]).toEqual(value);

    const withoutSource = removeScenarioScene(read(), 'scene-a');
    expect(getProjectBreakdowns(withoutSource)['scene-a']).toBeUndefined();
    expect(getProjectBreakdowns(withoutSource)[duplicateId!]).toEqual(value);
  });

  it('propose sans doublon les éléments des catégories portant le même nom', () => {
    const breakdowns: Record<string, SceneBreakdown> = {
      one: { categories: [{ id: 'a', name: 'Accessoires', items: [
        { id: '1', name: 'Chaussures', hue: null, secondaryHue: null }, { id: '2', name: 'Chapeau', hue: null, secondaryHue: null },
      ] }] },
      two: { categories: [{ id: 'b', name: 'accessoires', items: [
        { id: '3', name: 'Chaussures', hue: null, secondaryHue: null }, { id: '4', name: 'Chandelier', hue: null, secondaryHue: null },
      ] }] },
      three: { categories: [{ id: 'c', name: 'Costumes', items: [{ id: '5', name: 'Châle', hue: null, secondaryHue: null }] }] },
    };
    expect(getBreakdownSuggestions(breakdowns, 'ACCESSOIRES', 'Cha')).toEqual([
      'Chandelier', 'Chapeau', 'Chaussures',
    ]);
    expect(getBreakdownSuggestions(breakdowns, 'Accessoires', '')).toEqual([
      'Chandelier', 'Chapeau', 'Chaussures',
    ]);
    expect(getBreakdownSuggestions(breakdowns, 'Accessoires', 'Cha', ['Chaussures'])).toEqual([
      'Chandelier', 'Chapeau',
    ]);
    delete breakdowns.two;
    expect(getBreakdownSuggestions(breakdowns, 'Accessoires', 'Chan')).toEqual([]);
  });

  it('expose la couleur partagée dans SmartType et la réconcilie dans tout le projet', () => {
    const { editor, read } = editableDocument();
    updateScenarioBreakdowns(editor, {
      'scene-a': { categories: [{ id: 'a', name: 'Accessoires', items: [
        { id: 'shoes-a', name: 'Chaussures', hue: 38, secondaryHue: 212 },
      ] }] },
      'scene-b': { categories: [{ id: 'b', name: 'accessoires', items: [
        { id: 'shoes-b', name: 'chaussures', hue: null, secondaryHue: null },
      ] }] },
    });
    const breakdowns = getProjectBreakdowns(read());
    expect(breakdowns['scene-b'].categories[0].items[0]).toMatchObject({ hue: 38, secondaryHue: 212 });
    expect(getBreakdownSuggestionItems(breakdowns, 'Accessoires', '', [])).toEqual([
      expect.objectContaining({ name: 'Chaussures', hue: 38, secondaryHue: 212 }),
    ]);
  });

  it('met à jour plusieurs scènes dans une transaction unique annulable', () => {
    let state = EditorState.create({ schema, doc: fixture() });
    const dispatched: Parameters<typeof state.apply>[0][] = [];
    const editor = {
      isEditable: true,
      get state() { return state; },
      view: { dispatch(transaction: Parameters<typeof state.apply>[0]) { dispatched.push(transaction); state = state.apply(transaction); } },
    } as unknown as Editor;
    const empty: SceneBreakdown = { categories: [] };
    expect(updateScenarioBreakdowns(editor, { 'scene-a': empty, 'scene-b': empty })).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(getProjectBreakdowns(state.doc)['scene-a']).toEqual(empty);
    expect(getProjectBreakdowns(state.doc)['scene-b']).toEqual(empty);
  });

  it('attribue huit couleurs perceptuellement espacées puis équilibre les premières rayures', () => {
    const breakdowns: Record<string, SceneBreakdown> = {
      one: { categories: [{ id: 'props', name: 'Accessoires', items: [] }] },
    };
    expect(getNextAutomaticBreakdownAppearance(breakdowns)).toEqual({ hue: 0, secondaryHue: null });

    const appearances: Array<{ hue: number | null; secondaryHue: number | null }> = [];
    for (let index = 0; index < 20; index += 1) {
      const appearance = getNextAutomaticBreakdownAppearance(breakdowns);
      appearances.push(appearance);
      breakdowns.one.categories[0].items.push({ id: `item-${index}`, name: `Élément ${index}`, ...appearance });
    }
    const solids = appearances.slice(0, 8);
    expect(solids.every(appearance => appearance.hue !== null && appearance.secondaryHue === null)).toBe(true);
    expect(new Set(solids.map(appearance => appearance.hue)).size).toBe(8);
    const firstStriped = appearances.find(appearance => appearance.secondaryHue !== null);
    expect(firstStriped).toBeTruthy();
    expect(appearances.indexOf(firstStriped!)).toBe(8);
    expect(firstStriped?.hue).not.toBe(firstStriped?.secondaryHue);
    const firstStripeGroup = appearances.slice(8, 12);
    expect(firstStripeGroup.every(appearance => appearance.secondaryHue !== null)).toBe(true);
    expect(new Set(firstStripeGroup.flatMap(appearance => [appearance.hue, appearance.secondaryHue])).size).toBe(8);
  });

  it('synchronise une apparence automatique unique pour chaque élément identique du projet', () => {
    const breakdowns: Record<string, SceneBreakdown> = {
      one: { categories: [{ id: 'a', name: 'Accessoires', items: [
        { id: '1', name: 'Chaussures', hue: 120, secondaryHue: null },
        { id: '2', name: 'Chapeau', hue: 138, secondaryHue: null },
      ] }] },
      two: { categories: [{ id: 'b', name: 'accessoires', items: [
        { id: '3', name: 'chaussures', hue: null, secondaryHue: null },
      ] }] },
    };
    const colored = applyAutomaticBreakdownColors(breakdowns);
    const catalogue = getBreakdownCatalogue(colored);
    expect(catalogue).toHaveLength(2);
    expect(catalogue.every(item => item.hue !== null)).toBe(true);
    expect(new Set(catalogue.map(item => `${item.hue}:${item.secondaryHue}`)).size).toBe(2);
    expect(colored.one.categories[0].items[0]).toMatchObject({ hue: 0, secondaryHue: null });
    expect(colored.one.categories[0].items[1]).toMatchObject({ hue: expect.any(Number), secondaryHue: null });
    expect(colored.one.categories[0].items[1].hue).not.toBe(colored.one.categories[0].items[0].hue);
    expect(colored.two.categories[0].items[0]).toMatchObject({ hue: 0, secondaryHue: null });
  });
});
