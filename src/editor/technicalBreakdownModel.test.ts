import type { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TECHNICAL_COLUMNS,
  applyTechnicalFilterLogic,
  createDefaultTechnicalBreakdown,
  createTechnicalCustomColumn,
  formatTechnicalDuration,
  getScenarioCharacters,
  getSceneDuration,
  getTechnicalBreakdown,
  getTechnicalColumnBaseWidth,
  getTechnicalColumnEffectiveWidth,
  getTechnicalColumnInitialWidth,
  getTechnicalTableWidth,
  getTechnicalSuggestions,
  getVisibleTechnicalColumns,
  isTechnicalColumnWidthAutomatic,
  parseTechnicalDuration,
  reorderTechnicalShots,
  updateTechnicalBreakdown,
  type TechnicalBreakdown,
} from './technicalBreakdownModel';
import { getScenarioScenes, reorderScenarioScenes } from './sceneTimelineModel';

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
        technicalBreakdownData: { default: '' },
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
    paragraph('CHARACTER', 'character-a', 'LÉA'),
    paragraph('DIALOGUE', 'dialogue-a', 'On commence.'),
    paragraph('SCENE_HEADING', 'scene-b', 'EXT. RUE - NUIT'),
    paragraph('CHARACTER', 'character-b', 'MARC (OFF)'),
  ]);
}

function editableDocument() {
  let state = EditorState.create({ schema, doc: fixture() });
  const transactions: Parameters<typeof state.apply>[0][] = [];
  const editor = {
    isEditable: true,
    get state() { return state; },
    view: { dispatch(transaction: Parameters<typeof state.apply>[0]) { transactions.push(transaction); state = state.apply(transaction); } },
  } as unknown as Editor;
  return { editor, transactions, read: () => state.doc };
}

describe('découpage technique synchronisé', () => {
  it('expose les douze colonnes utiles dans l’ordre demandé, la scène restant portée par le groupe', () => {
    const value = getTechnicalBreakdown(fixture());
    expect(value.columns.map(column => column.name)).toEqual([
      'Plan', 'Image', 'Description', 'Acteurs', 'Focale', 'Angle',
      'Valeur de plan', 'Dialogue', 'Durée', 'VFX', 'IPS', 'Notes',
    ]);
    expect(value.columns).toHaveLength(DEFAULT_TECHNICAL_COLUMNS.length);
  });

  it('sépare la largeur automatique du plancher de redimensionnement manuel', () => {
    const value = createDefaultTechnicalBreakdown();
    const description = value.columns.find(column => column.kind === 'description')!;
    const angle = value.columns.find(column => column.kind === 'angle')!;
    expect(description.widthMode).toBe('auto');
    expect(isTechnicalColumnWidthAutomatic(description)).toBe(true);
    expect(getTechnicalColumnInitialWidth(value, angle)).toBeGreaterThan(getTechnicalColumnBaseWidth(angle));

    value.shots = [{ id: 'shot-a', sceneId: 'scene-a', values: { description: 'Un travelling très lent révèle progressivement le décor.' } }];
    expect(getTechnicalColumnInitialWidth(value, description)).toBeGreaterThan(getTechnicalColumnBaseWidth(description));
    const manual = { ...description, width: 48, widthMode: 'manual' as const };
    expect(isTechnicalColumnWidthAutomatic(manual)).toBe(false);
    expect(getTechnicalColumnEffectiveWidth(value, manual, { smartTypeValues: ['Une valeur beaucoup plus longue'] })).toBe(48);
    expect(getTechnicalColumnEffectiveWidth(value, description)).toBeGreaterThan(48);
  });

  it('inclut le titre, SmartType et les contrôles dans la largeur automatique', () => {
    const value = createDefaultTechnicalBreakdown();
    const custom = createTechnicalCustomColumn('Coordination des effets pratiques');
    expect(custom.widthMode).toBe('auto');
    expect(custom.width).toBe(getTechnicalColumnBaseWidth(custom));
    const titleWidth = getTechnicalColumnEffectiveWidth(value, custom);
    const smartTypeWidth = getTechnicalColumnEffectiveWidth(value, custom, {
      smartTypeValues: ['Travelling compensé panoramique très lent'],
      headerAccessoryWidth: 34,
    });
    expect(titleWidth).toBe(custom.width);
    expect(smartTypeWidth).toBeGreaterThan(titleWidth);
  });

  it('calcule la largeur totale exacte à partir des largeurs effectives', () => {
    expect(getTechnicalTableWidth([60, 74, 92])).toBe(270);
  });

  it('enregistre plans et colonnes en une transaction annulable puis suit le déplacement des scènes', () => {
    const { editor, transactions, read } = editableDocument();
    const value: TechnicalBreakdown = {
      ...createDefaultTechnicalBreakdown(),
      shots: [
        { id: 'shot-a', sceneId: 'scene-a', values: { description: 'Entrée de Léa', duration: '12 s' } },
        { id: 'shot-b', sceneId: 'scene-b', values: { description: 'Rue vide' } },
      ],
      adaptedCells: ['shot-a:description'],
      imageFitDisabledCells: ['shot-a:image'],
    };
    value.columns = value.columns.map(column => column.kind === 'description'
      ? { ...column, width: 73, widthMode: 'manual' }
      : column);
    expect(updateTechnicalBreakdown(editor, value)).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(getTechnicalBreakdown(read()).shots).toEqual(value.shots);
    expect(getTechnicalBreakdown(read()).adaptedCells).toEqual(['shot-a:description']);
    expect(getTechnicalBreakdown(read()).imageFitDisabledCells).toEqual(['shot-a:image']);
    expect(getTechnicalBreakdown(read()).columns.find(column => column.kind === 'description'))
      .toMatchObject({ width: 73, widthMode: 'manual' });

    const edited = getTechnicalBreakdown(read());
    edited.shots[0] = { ...edited.shots[0], values: { ...edited.shots[0].values, notes: 'Raccord lumière' } };
    expect(updateTechnicalBreakdown(editor, edited)).toBe(true);
    expect(getTechnicalBreakdown(read()).shots[0].values.notes).toBe('Raccord lumière');

    const moved = reorderScenarioScenes(read(), 'scene-b', 0);
    expect(getTechnicalBreakdown(moved).shots.map(shot => shot.id)).toEqual(['shot-b', 'shot-a']);
  });

  it('reclasse atomiquement plusieurs plans dans une autre scène', () => {
    const value: TechnicalBreakdown = {
      ...createDefaultTechnicalBreakdown(),
      shots: [
        { id: 'a', sceneId: 'scene-a', values: {} },
        { id: 'b', sceneId: 'scene-a', values: {} },
        { id: 'c', sceneId: 'scene-b', values: {} },
      ],
    };
    const moved = reorderTechnicalShots(value, ['a', 'b'], 'scene-b', 'c', getScenarioScenes(fixture()));
    expect(moved.shots.map(shot => `${shot.sceneId}:${shot.id}`)).toEqual(['scene-b:a', 'scene-b:b', 'scene-b:c']);
    expect(reorderTechnicalShots(value, ['a', 'b'], 'scene-a', 'a', getScenarioScenes(fixture()))).toBe(value);
  });

  it('autorise la suppression de toutes les catégories sans recréer les catégories natives', () => {
    const { editor, read } = editableDocument();
    expect(updateTechnicalBreakdown(editor, { version: 1, columns: [], shots: [] })).toBe(true);
    expect(getTechnicalBreakdown(read()).columns).toEqual([]);
  });

  it('persiste le masquage des colonnes sans supprimer leurs valeurs', () => {
    const { editor, read } = editableDocument();
    const value = createDefaultTechnicalBreakdown();
    value.columns = value.columns.map(column => column.id === 'focal' ? { ...column, hidden: true } : column);
    value.shots = [{ id: 'shot-a', sceneId: 'scene-a', values: { focal: '24 mm' } }];
    expect(updateTechnicalBreakdown(editor, value)).toBe(true);
    const restored = getTechnicalBreakdown(read());
    expect(getVisibleTechnicalColumns(restored).some(column => column.id === 'focal')).toBe(false);
    expect(restored.columns.find(column => column.id === 'focal')?.hidden).toBe(true);
    expect(restored.shots[0].values.focal).toBe('24 mm');
  });

  it('alimente SmartType avec ses listes natives, les personnages et les valeurs de colonnes homonymes', () => {
    const value = createDefaultTechnicalBreakdown();
    const customA = { id: 'custom-a', name: 'Mouvement', kind: 'custom' as const, width: 180, widthMode: 'auto' as const, hidden: false };
    const customB = { id: 'custom-b', name: 'mouvement', kind: 'custom' as const, width: 180, widthMode: 'auto' as const, hidden: false };
    value.columns.push(customA, customB);
    value.shots.push(
      { id: 'a', sceneId: 'scene-a', values: { 'custom-a': 'Travelling' } },
      { id: 'b', sceneId: 'scene-b', values: { 'custom-b': 'travelling', actors: 'Léa, Marc' } },
    );
    expect(getTechnicalSuggestions(value, customA)).toEqual(['Travelling']);
    expect(getTechnicalSuggestions(value, value.columns.find(column => column.kind === 'angle')!, [], 'plong')).toEqual(['Contre-plongée', 'Plongée']);
    expect(getScenarioCharacters(fixture())).toEqual(['LÉA', 'MARC']);
    expect(getTechnicalSuggestions(value, value.columns.find(column => column.kind === 'actors')!, getScenarioCharacters(fixture()))).toEqual(['LÉA', 'MARC']);
  });

  it('combine puis garde ou exclut les correspondances des filtres', () => {
    const oneMatch = [true, false];
    const allMatch = [true, true];
    expect(applyTechnicalFilterLogic(oneMatch, 'addition', 'keep')).toBe(true);
    expect(applyTechnicalFilterLogic(oneMatch, 'addition', 'exclude')).toBe(false);
    expect(applyTechnicalFilterLogic(oneMatch, 'restriction', 'keep')).toBe(false);
    expect(applyTechnicalFilterLogic(oneMatch, 'restriction', 'exclude')).toBe(true);
    expect(applyTechnicalFilterLogic(allMatch, 'restriction', 'keep')).toBe(true);
    expect(applyTechnicalFilterLogic(allMatch, 'restriction', 'exclude')).toBe(false);
    expect(applyTechnicalFilterLogic([], 'addition', 'exclude')).toBe(true);
  });

  it('calcule les durées usuelles par scène et pour le total', () => {
    expect(parseTechnicalDuration('1:30')).toBe(90);
    expect(parseTechnicalDuration('2 min 05 s')).toBe(125);
    expect(parseTechnicalDuration('75')).toBe(75);
    expect(formatTechnicalDuration(3725)).toBe('1 h 02 min 05 s');
    const value = createDefaultTechnicalBreakdown();
    value.shots = [
      { id: 'a', sceneId: 'scene-a', values: { duration: '1:30' } },
      { id: 'b', sceneId: 'scene-a', values: { duration: '15 s' } },
    ];
    expect(getSceneDuration(value, 'scene-a')).toBe(105);
  });
});
