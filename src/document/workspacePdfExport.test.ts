import { describe, expect, it } from 'vitest';
import { DEFAULT_TECHNICAL_COLUMNS, type TechnicalBreakdown } from '../editor/technicalBreakdownModel';
import type { SceneBreakdown } from '../editor/breakdownModel';
import type { ScenarioScene } from '../editor/sceneTimelineModel';
import { createBreakdownPdf, createTechnicalBreakdownPdf } from './workspacePdfExport';

const scenes: ScenarioScene[] = [
  { id: 'scene-1', title: 'INT. ATELIER DE RESTAURATION - JOUR', index: 0, from: 0, to: 10, blockIds: [], act: 1, summary: '', tag: '', color: '', estimatedPages: 1 },
  { id: 'scene-2', title: 'EXT. RUE SOUS LA PLUIE - NUIT', index: 1, from: 11, to: 20, blockIds: [], act: 2, summary: '', tag: '', color: '', estimatedPages: 1 },
];

const breakdowns: Record<string, SceneBreakdown> = Object.fromEntries(scenes.map((scene, sceneIndex) => [scene.id, {
  categories: [
    { id: `actors-${sceneIndex}`, name: 'Personnages', items: Array.from({ length: 8 }, (_, index) => ({ id: `actor-${sceneIndex}-${index}`, name: `Personnage secondaire ${index + 1}`, hue: null, secondaryHue: null })) },
    { id: `props-${sceneIndex}`, name: 'Accessoires spéciaux', items: [{ id: `prop-${sceneIndex}`, name: 'Un accessoire avec une description suffisamment longue pour vérifier le retour à la ligne automatique', hue: null, secondaryHue: null }] },
    { id: `empty-${sceneIndex}`, name: 'Catégorie personnalisée vide', items: [] },
  ],
}]));

const referenceImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EF//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EF//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EF//2Q==';
const technical: TechnicalBreakdown = {
  version: 1,
  columns: DEFAULT_TECHNICAL_COLUMNS.map(column => ({ ...column })),
  shots: Array.from({ length: 18 }, (_, index) => ({
    id: `shot-${index}`,
    sceneId: index < 10 ? 'scene-1' : 'scene-2',
    values: {
      image: index % 4 === 0 ? referenceImage : '',
      description: `Mouvement complexe du plan ${index + 1}. ${'La caméra accompagne le personnage dans le décor. '.repeat(index % 3 + 1)}`,
      actors: index % 2 ? 'Léa, Marc' : 'Léa',
      focal: index % 2 ? '24 mm' : '50 mm',
      angle: 'Niveau des yeux',
      'shot-size': index % 2 ? 'Plan américain' : 'Plan rapproché',
      dialogue: index % 3 === 0 ? 'Une réplique assez longue pour tester correctement les cellules multilignes.' : '',
      duration: '00:04',
      vfx: index % 5 === 0 ? 'Extension de décor' : '',
      fps: '24',
      notes: 'Raccord lumière et continuité du mouvement.',
    },
  })),
};

describe('exports PDF des espaces de travail', () => {
  it('produit un dépouillement paginé avec catégories personnalisées', async () => {
    const pdf = await createBreakdownPdf('Film de test', scenes, breakdowns, {
      pageFormat: 'a4', orientation: 'auto', contentSize: 'normal', includePageNumbers: true,
      categoryNames: ['Personnages', 'Accessoires spéciaux'], includeEmptyCategories: false,
    });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(3_000);
  });

  it('produit un découpage multipage en respectant les colonnes et les images', async () => {
    const pdf = await createTechnicalBreakdownPdf('Film de test', scenes, technical, {
      pageFormat: 'a4', orientation: 'auto', contentSize: 'normal', includePageNumbers: true,
      columnIds: technical.columns.map(column => column.id), includeImages: true,
    });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(5_000);
  });
});
