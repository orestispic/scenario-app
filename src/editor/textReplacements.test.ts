import { describe, expect, it } from "vitest";
import {
  createDefaultTextReplacements,
  hasDuplicateTextReplacementShortcut,
  normalizeTextReplacements,
} from "./textReplacements";

describe("raccourcis de texte", () => {
  it("garde les raccourcis valides et écarte les doublons ou les valeurs incomplètes", () => {
    expect(
      normalizeTextReplacements([
        { id: "1", shortcut: "adr", replacement: "12 rue des Lilas" },
        { id: "2", shortcut: "ADR", replacement: "Autre adresse" },
        { id: "3", shortcut: "deux mots", replacement: "Invalide" },
        { id: "4", shortcut: "tel", replacement: "06 00 00 00 00" },
      ]),
    ).toEqual([
      { id: "1", shortcut: "adr", replacement: "12 rue des Lilas" },
      { id: "4", shortcut: "tel", replacement: "06 00 00 00 00" },
    ]);
  });

  it("fournit la liste de raccourcis préconfigurée", () => {
    const defaults = createDefaultTextReplacements();

    expect(defaults.length).toBeGreaterThan(200);
    expect(defaults).toContainEqual({
      id: expect.any(String),
      shortcut: "ajd",
      replacement: "aujourd’hui",
    });
    expect(defaults.some((item) => item.shortcut === "oremail")).toBe(false);
    expect(defaults.some((item) => item.shortcut === "yt")).toBe(false);
  });

  it("détecte un raccourci saisi deux fois, sans tenir compte des majuscules", () => {
    expect(
      hasDuplicateTextReplacementShortcut([
        { id: "1", shortcut: "Rdv", replacement: "rendez-vous" },
        { id: "2", shortcut: "rdv", replacement: "rendez vous" },
      ]),
    ).toBe(true);
  });
});
