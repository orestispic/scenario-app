import { describe, expect, it } from "vitest";
import { Schema } from '@tiptap/pm/model';
import {
  analyzeSceneHeading,
  applySceneHeadingSmartTypeSuggestion,
  getSmartTypeContext,
  getSceneHeadingSmartTypeCandidates,
} from "./smartType";

describe("analyse des en-têtes de scène", () => {
  it("ne propose pas SmartType dans un éditeur en lecture seule", () => {
    expect(getSmartTypeContext({ isEditable: false } as never)).toBeNull();
  });

  it("reconnaît une amorce intérieur / extérieur", () => {
    expect(analyzeSceneHeading("in")).toMatchObject({
      part: "INTRO",
      query: "IN",
    });
  });

  it("reconnaît le lieu après une amorce valide", () => {
    expect(analyzeSceneHeading("EXT. PARC")).toMatchObject({
      part: "LOCATION",
      intro: "EXT.",
      location: "PARC",
    });
  });

  it("reconnaît le moment après le séparateur", () => {
    expect(analyzeSceneHeading("INT. CUISINE - NUIT")).toMatchObject({
      part: "TIME",
      intro: "INT.",
      location: "CUISINE",
      time: "NUIT",
    });
  });

  it("respecte la position du curseur", () => {
    expect(analyzeSceneHeading("INT. BUREAU - JOUR", 11)).toMatchObject({
      part: "LOCATION",
      location: "BUREAU",
    });
  });

  it("partage les lieux et la logique d'insertion avec l'éditeur du Whiteboard", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', attrs: { scenarioType: { default: 'ACTION' } } },
        text: {},
      },
    });
    const paragraph = (scenarioType: string, text: string) => schema.node(
      'paragraph', { scenarioType }, text ? schema.text(text) : undefined,
    );
    const document = schema.node('doc', null, [
      paragraph('SCENE_HEADING', 'INT. OBSERVATOIRE - NUIT'),
      paragraph('ACTION', 'La coupole tourne.'),
      paragraph('SCENE_HEADING', 'EXT. ROUTE - JOUR'),
    ]);
    expect(getSceneHeadingSmartTypeCandidates(document, 'INT. OBS')).toEqual({
      kind: 'LOCATION',
      items: ['OBSERVATOIRE'],
    });
    expect(applySceneHeadingSmartTypeSuggestion('INT. OBS', 'LOCATION', 'OBSERVATOIRE'))
      .toBe('INT. OBSERVATOIRE - ');
  });
});
