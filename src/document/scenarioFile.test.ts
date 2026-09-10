import { describe, expect, it } from "vitest";
import {
  getCoverCredits,
  getFileTitle,
  parseScenarioFile,
  SCENARIO_FORMAT_VERSION,
} from "./scenarioFile";

describe("format .scenario", () => {
  it("lit un document compatible et garde ses métadonnées", () => {
    const parsed = parseScenarioFile(
      JSON.stringify({
        formatVersion: SCENARIO_FORMAT_VERSION,
        title: "Mon film",
        content: { type: "doc", content: [] },
        characters: ["LÉA"],
        locations: ["APPARTEMENT"],
        times: ["NUIT"],
        savedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(parsed.title).toBe("Mon film");
    expect(parsed.characters).toEqual(["LÉA"]);
    expect(parsed.locations).toEqual(["APPARTEMENT"]);
    expect(parsed.coverPage.projectName).toBe("");
    expect(parsed.coverPageHidden).toBe(false);
  });

  it("crée le crédit commun quand le scénariste réalise aussi le film", () => {
    expect(
      getCoverCredits({
        projectName: "",
        screenwriter: "Orestis",
        director: "Orestis",
        production: "",
        duration: "",
        version: "",
        date: "",
        rights: "",
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        contactWebsite: "",
      }),
    ).toEqual(["ÉCRIT ET RÉALISÉ PAR", "Orestis"]);
  });

  it("restaure toutes les informations de la page de garde depuis le fichier projet", () => {
    const coverPage = {
      projectName: "Le Dernier Plan",
      screenwriter: "Orestis",
      director: "Orestis",
      production: "Studio Exemple",
      duration: "12 min",
      version: "3",
      date: "30 août 2026",
      rights: "Tous droits réservés",
      contactName: "Orestis Picard",
      contactEmail: "ore@example.com",
      contactPhone: "06 00 00 00 00",
      contactWebsite: "mon-site.local",
    };
    const parsed = parseScenarioFile(
      JSON.stringify({
        formatVersion: SCENARIO_FORMAT_VERSION,
        title: "Le Dernier Plan",
        content: { type: "doc", content: [] },
        coverPage,
      }),
    );

    expect(parsed.coverPage).toEqual(coverPage);
  });

  it("conserve le choix de masquer la page de garde", () => {
    const parsed = parseScenarioFile(JSON.stringify({
      formatVersion: SCENARIO_FORMAT_VERSION,
      title: "Film",
      content: { type: "doc", content: [] },
      coverPageHidden: true,
    }));

    expect(parsed.coverPageHidden).toBe(true);
  });

  it("conserve les fils de commentaires avec leurs ancres", () => {
    const comments = [{
      id: "thread_1",
      status: "open",
      createdAt: "2026-08-30T10:00:00.000Z",
      resolvedAt: null,
      anchor: {
        sceneId: "scene_1",
        blockId: "block_1",
        startOffset: 2,
        endOffset: 8,
        originalText: "voiture",
        lost: false,
      },
      messages: [{
        id: "message_1",
        text: "À revoir.",
        createdAt: "2026-08-30T10:00:00.000Z",
        editedAt: null,
      }],
    }];
    const parsed = parseScenarioFile(JSON.stringify({
      formatVersion: SCENARIO_FORMAT_VERSION,
      title: "Film",
      content: { type: "doc", content: [] },
      comments,
    }));

    expect(parsed.comments).toEqual(comments);
  });

  it("ignore les commentaires corrompus sans empêcher l'ouverture du projet", () => {
    const parsed = parseScenarioFile(JSON.stringify({
      formatVersion: SCENARIO_FORMAT_VERSION,
      title: "Film",
      content: { type: "doc", content: [] },
      comments: [
        null,
        { id: "incomplet", status: "open", anchor: {}, messages: [] },
        {
          id: "valide",
          status: "open",
          anchor: {
            sceneId: "scene_1",
            blockId: "block_1",
            startOffset: 0,
            endOffset: 4,
            originalText: "Test",
            lost: false,
          },
          messages: [{ id: "m1", text: "À revoir", createdAt: "", editedAt: null }],
        },
      ],
    }));

    expect(parsed.comments.map((comment) => comment.id)).toEqual(["valide"]);
  });

  it("refuse un format incompatible", () => {
    expect(() => parseScenarioFile('{"formatVersion":99}')).toThrow(
      "n’est pas compatible",
    );
  });

  it("déduit le titre depuis un chemin Windows ou Unix", () => {
    expect(getFileTitle("C:\\Scénarios\\Mon Film.scenario")).toBe("Mon Film");
    expect(getFileTitle("/films/Final.scenario")).toBe("Final");
  });
});
