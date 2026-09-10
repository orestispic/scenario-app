export const SCENARIO_ELEMENT_TYPES = [
  "SCENE_HEADING",
  "ACTION",
  "CHARACTER",
  "DIALOGUE",
  "PARENTHETICAL",
  "TRANSITION",
] as const;

export type ScenarioElementType = (typeof SCENARIO_ELEMENT_TYPES)[number];

export const DEFAULT_SCENARIO_ELEMENT_TYPE: ScenarioElementType = "SCENE_HEADING";

export const SCENARIO_ELEMENT_LABELS: Record<ScenarioElementType, string> = {
  SCENE_HEADING: "Titre de scene",
  ACTION: "Action",
  CHARACTER: "Personnage",
  DIALOGUE: "Dialogue",
  PARENTHETICAL: "Parenthese",
  TRANSITION: "Transition",
};

export function isScenarioElementType(
  value: unknown,
): value is ScenarioElementType {
  return (
    typeof value === "string" &&
    SCENARIO_ELEMENT_TYPES.includes(value as ScenarioElementType)
  );
}

export function toScenarioElementType(value: unknown): ScenarioElementType {
  return isScenarioElementType(value) ? value : DEFAULT_SCENARIO_ELEMENT_TYPE;
}

export function getScenarioElementLabel(type: ScenarioElementType): string {
  return SCENARIO_ELEMENT_LABELS[type];
}
