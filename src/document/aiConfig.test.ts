import { describe, expect, it } from "vitest";
import {
  buildAiPromptInstruction,
  createDefaultAiConfig,
  RESPONSE_ONLY_INSTRUCTION,
} from "./aiConfig";

describe("configuration IA", () => {
  it("ne propose que les trois actions simples prévues par défaut", () => {
    const prompts = createDefaultAiConfig().prompts;
    expect(prompts.map((prompt) => prompt.id)).toEqual([
      "correct",
      "translate-en",
      "shorten",
    ]);
    expect(prompts.every((prompt) => prompt.responseOnly)).toBe(true);
  });

  it("ajoute la consigne de réponse uniquement à la toute fin", () => {
    const prompt = {
      ...createDefaultAiConfig().prompts[0],
      instruction: "Corrige ce texte.",
      responseOnly: true,
    };

    expect(buildAiPromptInstruction(prompt)).toBe(
      `Corrige ce texte.\n\n${RESPONSE_ONLY_INSTRUCTION}`,
    );
  });
});
