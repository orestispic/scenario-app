import type { ScenarioElementType } from "./scenarioTypes";

export const ENTER_TRANSITIONS: Record<
  ScenarioElementType,
  ScenarioElementType
> = {
  SCENE_HEADING: "ACTION",
  ACTION: "ACTION",
  CHARACTER: "DIALOGUE",
  DIALOGUE: "ACTION",
  PARENTHETICAL: "DIALOGUE",
  TRANSITION: "SCENE_HEADING",
};

export const SHIFT_TAB_TRANSITIONS: Record<
  ScenarioElementType,
  ScenarioElementType
> = {
  SCENE_HEADING: "ACTION",
  ACTION: "SCENE_HEADING",
  CHARACTER: "ACTION",
  DIALOGUE: "CHARACTER",
  PARENTHETICAL: "CHARACTER",
  TRANSITION: "ACTION",
};

export function getEnterType(currentType: ScenarioElementType) {
  return ENTER_TRANSITIONS[currentType];
}

export function getShiftTabType(currentType: ScenarioElementType) {
  return SHIFT_TAB_TRANSITIONS[currentType];
}
