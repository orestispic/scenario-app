import { describe, expect, it } from "vitest";
import {
  ENTER_TRANSITIONS,
  getEnterType,
  getShiftTabType,
  SHIFT_TAB_TRANSITIONS,
} from "./scenarioStateMachine";
import { SCENARIO_ELEMENT_TYPES } from "./scenarioTypes";

describe("machine d'états du scénario", () => {
  it("définit une transition Entrée pour chaque type de paragraphe", () => {
    for (const type of SCENARIO_ELEMENT_TYPES) {
      expect(getEnterType(type)).toBe(ENTER_TRANSITIONS[type]);
      expect(SCENARIO_ELEMENT_TYPES).toContain(getEnterType(type));
    }
  });

  it("définit une transition Maj+Tab pour chaque type de paragraphe", () => {
    for (const type of SCENARIO_ELEMENT_TYPES) {
      expect(getShiftTabType(type)).toBe(SHIFT_TAB_TRANSITIONS[type]);
      expect(SCENARIO_ELEMENT_TYPES).toContain(getShiftTabType(type));
    }
  });

  it("conserve le flux d'écriture attendu", () => {
    expect(getEnterType("SCENE_HEADING")).toBe("ACTION");
    expect(getEnterType("CHARACTER")).toBe("DIALOGUE");
    expect(getEnterType("PARENTHETICAL")).toBe("DIALOGUE");
    expect(getShiftTabType("ACTION")).toBe("SCENE_HEADING");
    expect(getShiftTabType("DIALOGUE")).toBe("CHARACTER");
  });
});
