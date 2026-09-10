import { describe, expect, it } from "vitest";
import { analyzeSceneHeading } from "./smartType";

describe("analyse des en-têtes de scène", () => {
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
});
