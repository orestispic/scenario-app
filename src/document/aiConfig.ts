import { invoke } from "@tauri-apps/api/core";
import { createRuntimeCommercialApi } from "../commercial/runtime";

export interface AiPrompt {
  id: string;
  name: string;
  instruction: string;
  responseOnly: boolean;
}

export const RESPONSE_ONLY_INSTRUCTION =
  "Réponds uniquement avec le texte, sans guillemets, titre, commentaire ni explication.";

export function buildAiPromptInstruction(prompt: AiPrompt): string {
  const instruction = prompt.instruction.trim();
  return prompt.responseOnly ? `${instruction}\n\n${RESPONSE_ONLY_INSTRUCTION}` : instruction;
}

export interface AiConfigView {
  prompts: AiPrompt[];
}

export interface AiConfigDraft {
  prompts: AiPrompt[];
}

export interface ScenarioTranslationSegment {
  index: number;
  type: string;
  text: string;
}

export const DEFAULT_AI_PROMPTS: AiPrompt[] = [
  {
    id: "correct",
    name: "Corriger les fautes",
    instruction:
      "Corrige les fautes de ce texte sans changer le style, le sens ni la mise en forme.",
    responseOnly: true,
  },
  {
    id: "translate-en",
    name: "Traduire en anglais",
    instruction: "Traduis ce texte en anglais en gardant le ton, le sous-texte et l'intention.",
    responseOnly: true,
  },
  {
    id: "shorten",
    name: "Raccourcir",
    instruction:
      "Raccourcis ce texte en gardant les informations importantes et le rythme de scénario.",
    responseOnly: true,
  },
];

export function createDefaultAiConfig(): AiConfigView {
  return {
    prompts: DEFAULT_AI_PROMPTS,
  };
}

export async function readAiConfig(): Promise<AiConfigView> {
  return invoke<AiConfigView>("read_ai_config");
}

export async function writeAiConfig(config: AiConfigDraft): Promise<AiConfigView> {
  return invoke<AiConfigView>("write_ai_config", { config });
}

export async function runAiPrompt(
  promptInstruction: string,
  paragraphText: string,
): Promise<string> {
  const response = await createRuntimeCommercialApi().runAiAction({
    kind: "rewrite",
    instruction: promptInstruction,
    text: paragraphText,
  });
  if (response.result?.kind !== "text") throw new Error("Réponse IA invalide.");
  return response.result.text;
}

export async function translateScenario(
  targetLanguage: string,
  segments: ScenarioTranslationSegment[],
): Promise<string[]> {
  const response = await createRuntimeCommercialApi().runAiAction({
    kind: "translate",
    targetLanguage,
    segments,
  });
  if (response.result?.kind !== "translations") throw new Error("Traduction IA invalide.");
  const values = new Map(response.result.translations.map((item) => [item.index, item.text]));
  const translated = segments.map((segment) => values.get(segment.index));
  if (translated.some((value) => !value)) throw new Error("Traduction IA incomplète.");
  return translated as string[];
}

export async function importPdfScenario(extractedText: string): Promise<string> {
  const response = await createRuntimeCommercialApi().runAiPdfImport({ extractedText });
  if (response.result?.kind !== "scenario_json") throw new Error("Import PDF IA invalide.");
  return response.result.scenarioJson;
}
