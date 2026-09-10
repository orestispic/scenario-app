import { describe, expect, it } from "vitest";
import { createEmptyCoverPage, type ScenarioFile } from "./scenarioFile";
import { createScenarioPdf } from "./pdfExport";

describe("export PDF", () => {
  it("produit un document PDF A4 à partir des paragraphes structurés", async () => {
    const document: ScenarioFile = {
      formatVersion: 1,
      title: "Test d'export",
      characters: ["LÉA"],
      locations: ["APPARTEMENT"],
      times: ["NUIT"],
      coverPage: createEmptyCoverPage(),
      coverPageHidden: false,
      comments: [],
      savedAt: "2026-01-01T00:00:00.000Z",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { scenarioType: "SCENE_HEADING" },
            content: [{ type: "text", text: "INT. APPARTEMENT - NUIT" }],
          },
          {
            type: "paragraph",
            attrs: { scenarioType: "CHARACTER" },
            content: [{ type: "text", text: "LÉA" }],
          },
          {
            type: "paragraph",
            attrs: { scenarioType: "DIALOGUE" },
            content: [{ type: "text", text: "Καλημέρα." }],
          },
        ],
      },
    };

    const pdf = await createScenarioPdf(document);

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });
});
