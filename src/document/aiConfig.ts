import { invoke } from "@tauri-apps/api/core";

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
  return prompt.responseOnly
    ? `${instruction}\n\n${RESPONSE_ONLY_INSTRUCTION}`
    : instruction;
}

export interface AiConfigView {
  model: string;
  prompts: AiPrompt[];
  hasApiKey: boolean;
}

export interface AiConfigDraft {
  model: string;
  prompts: AiPrompt[];
  apiKey?: string;
}

export interface ScenarioTranslationSegment {
  index: number;
  type: string;
  text: string;
}

export const DEFAULT_AI_MODEL = "gpt-5-nano";

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
    instruction:
      "Traduis ce texte en anglais en gardant le ton, le sous-texte et l'intention.",
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
    model: DEFAULT_AI_MODEL,
    prompts: DEFAULT_AI_PROMPTS,
    hasApiKey: false,
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
  return invoke<string>("run_ai_prompt", { promptInstruction, paragraphText });
}

export async function translateScenario(
  targetLanguage: string,
  segments: ScenarioTranslationSegment[],
): Promise<string[]> {
  return invoke<string[]>("translate_scenario", { targetLanguage, segments });
}
