import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { toScenarioElementType } from "./scenarioTypes";

export const SCENE_INTROS = ["INT.", "EXT.", "INT./EXT."] as const;
export const STANDARD_TIMES = [
  "JOUR",
  "NUIT",
  "MATIN",
  "SOIR",
  "AUBE",
  "CRÉPUSCULE",
  "CONTINU",
  "MIDI",
  "APRÈS-MIDI",
  "PLUS TARD",
] as const;
export type SmartTypeKind =
  | "CHARACTER"
  | "SCENE_INTRO"
  | "LOCATION"
  | "TIME";

export type SceneHeadingPart = "INTRO" | "LOCATION" | "TIME";

export interface SmartTypeContext {
  kind: SmartTypeKind;
  items: string[];
  selectedIndex: number;
  signature: string;
}

type SmartTypeCandidates = Pick<SmartTypeContext, "kind" | "items">;

const selectionByEditor = new WeakMap<
  Editor,
  { signature: string; selectedIndex: number }
>();
const dismissedSignatureByEditor = new WeakMap<Editor, string>();

interface SceneHeadingAnalysis {
  part: SceneHeadingPart;
  intro: string;
  location: string;
  time: string;
  query: string;
}

export function getSmartTypeContext(editor: Editor): SmartTypeContext | null {
  const candidates = getSmartTypeCandidates(editor);
  if (!candidates) {
    return null;
  }

  const { $from } = editor.state.selection;
  const signature = [
    editor.state.selection.from,
    $from.parent.attrs.scenarioType,
    $from.parent.textContent,
  ].join(":");

  if (dismissedSignatureByEditor.get(editor) === signature) {
    return null;
  }

  const previousSelection = selectionByEditor.get(editor);
  const selectedIndex =
    previousSelection?.signature === signature
      ? Math.min(previousSelection.selectedIndex, candidates.items.length - 1)
      : 0;
  selectionByEditor.set(editor, { signature, selectedIndex });

  return { ...candidates, selectedIndex, signature };
}

export function acceptSelectedSmartTypeSuggestion(
  editor: Editor,
  onlyKind?: SmartTypeKind,
): boolean {
  const context = getSmartTypeContext(editor);
  if (onlyKind && context?.kind !== onlyKind) {
    return false;
  }

  const suggestion = context?.items[context.selectedIndex];
  return context && suggestion
    ? acceptSmartTypeSuggestion(editor, context.kind, suggestion)
    : false;
}

export function moveSmartTypeSelection(
  editor: Editor,
  direction: 1 | -1,
): boolean {
  const context = getSmartTypeContext(editor);
  if (!context) {
    return false;
  }

  const selectedIndex =
    (context.selectedIndex + direction + context.items.length) %
    context.items.length;
  return setSmartTypeSelection(editor, selectedIndex, context);
}

/** Synchronise une proposition survolée avec le choix utilisé par Tab. */
export function setSmartTypeSelection(
  editor: Editor,
  selectedIndex: number,
  context = getSmartTypeContext(editor),
): boolean {
  if (!context) {
    return false;
  }
  selectionByEditor.set(editor, {
    signature: context.signature,
    selectedIndex: Math.max(0, Math.min(selectedIndex, context.items.length - 1)),
  });
  editor.view.dispatch(editor.state.tr.setMeta("smartTypeNavigation", true));
  return true;
}

export function dismissSmartType(editor: Editor): boolean {
  const context = getSmartTypeContext(editor);
  if (!context) {
    return false;
  }

  dismissedSignatureByEditor.set(editor, context.signature);
  editor.view.dispatch(editor.state.tr.setMeta("smartTypeDismissed", true));
  return true;
}

function getSmartTypeCandidates(editor: Editor): SmartTypeCandidates | null {
  const { $from } = editor.state.selection;

  if ($from.parent.type.name !== "paragraph") {
    return null;
  }

  const type = toScenarioElementType($from.parent.attrs.scenarioType);
  const text = $from.parent.textContent;
  const currentParagraphPosition = $from.before($from.depth);

  if (type === "SCENE_HEADING") {
    const analysis = analyzeSceneHeading(text, $from.parentOffset);

    if (analysis.part === "INTRO") {
      return makeContext("SCENE_INTRO", SCENE_INTROS, analysis.query);
    }

    if (analysis.part === "LOCATION") {
      return makeContext(
        "LOCATION",
        collectKnownValues(editor, "LOCATION", currentParagraphPosition),
        analysis.query,
      );
    }

    return makeContext(
      "TIME",
      uniqueValues([
        ...STANDARD_TIMES,
        ...collectKnownValues(editor, "TIME", currentParagraphPosition),
      ]),
      analysis.query,
    );
  }

  // Final Draft also lets a writer begin a new scene from a blank Action
  // paragraph by typing I or E, then accepting INT. or EXT. with Tab.
  if (type === "ACTION" && isSceneIntroPrefix(text)) {
    return makeContext("SCENE_INTRO", SCENE_INTROS, text);
  }

  if (type === "CHARACTER") {
    const characters = collectKnownValues(
      editor,
      "CHARACTER",
      currentParagraphPosition,
    );
    const predicted = predictNextCharacter(editor, currentParagraphPosition);
    const orderedCharacters = predicted
      ? [predicted, ...characters.filter((name) => name !== predicted)]
      : characters;

    return makeContext("CHARACTER", orderedCharacters, text);
  }

  return null;
}

export function acceptSmartTypeSuggestion(
  editor: Editor,
  kind: SmartTypeKind,
  suggestion: string,
): boolean {
  const { $from } = editor.state.selection;

  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  const text = $from.parent.textContent;
  const contentStart = $from.start($from.depth);
  const currentType = toScenarioElementType($from.parent.attrs.scenarioType);
  let replacement = suggestion;

  if (kind === "SCENE_INTRO") {
    replacement = `${suggestion} `;
  } else if (kind === "LOCATION") {
    const analysis = analyzeSceneHeading(text, $from.parentOffset);
    replacement = `${analysis.intro} ${suggestion} - `;
  } else if (kind === "TIME") {
    const analysis = analyzeSceneHeading(text, $from.parentOffset);
    replacement = `${analysis.intro} ${analysis.location} - ${suggestion}`;
  }

  const transaction = editor.state.tr.insertText(
    replacement,
    contentStart,
    $from.end($from.depth),
  );

  if (kind === "SCENE_INTRO" && currentType === "ACTION") {
    transaction.setNodeMarkup($from.before($from.depth), undefined, {
      ...$from.parent.attrs,
      scenarioType: "SCENE_HEADING",
    });
  }
  transaction.setSelection(
    TextSelection.create(transaction.doc, contentStart + replacement.length),
  );
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export function analyzeSceneHeading(
  text: string,
  cursorOffset = text.length,
): SceneHeadingAnalysis {
  const textBeforeCursor = text.slice(0, cursorOffset).toUpperCase();
  const separatorIndex = textBeforeCursor.indexOf(" - ");

  if (separatorIndex >= 0) {
    const beforeSeparator = textBeforeCursor.slice(0, separatorIndex);
    const { intro, location } = splitIntroAndLocation(beforeSeparator);
    const time = textBeforeCursor.slice(separatorIndex + 3).trim();

    return { part: "TIME", intro, location, time, query: time };
  }

  const introMatch = textBeforeCursor.match(/^(INT\.\/EXT\.|INT\.|EXT\.)\s*/);

  if (!introMatch) {
    const query = textBeforeCursor.trim();
    return { part: "INTRO", intro: "", location: "", time: "", query };
  }

  const intro = introMatch[1];
  const location = textBeforeCursor.slice(introMatch[0].length).trim();
  return {
    part: "LOCATION",
    intro,
    location,
    time: "",
    query: location,
  };
}

function makeContext(
  kind: SmartTypeKind,
  values: readonly string[],
  query: string,
): SmartTypeCandidates | null {
  const normalizedQuery = normalizeValue(query);
  const items = uniqueValues(values)
    .filter((value) => {
      const normalizedValue = normalizeValue(value);
      return (
        normalizedValue !== normalizedQuery &&
        normalizedValue.startsWith(normalizedQuery)
      );
    })
    .slice(0, 7);

  return items.length > 0 ? { kind, items } : null;
}

function isSceneIntroPrefix(text: string): boolean {
  const query = normalizeValue(text);
  return query.length > 0 && SCENE_INTROS.some((intro) => intro.startsWith(query));
}

function collectKnownValues(
  editor: Editor,
  kind: "CHARACTER" | "LOCATION" | "TIME",
  excludedPosition: number,
): string[] {
  const values: string[] = [];

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "paragraph" || position === excludedPosition) {
      return;
    }

    const type = toScenarioElementType(node.attrs.scenarioType);
    const text = normalizeValue(node.textContent);

    if (kind === "CHARACTER" && type === "CHARACTER" && text) {
      values.push(text);
    }

    if (type === "SCENE_HEADING") {
      const scene = parseCompletedSceneHeading(text);
      if (kind === "LOCATION" && scene.location) {
        values.push(scene.location);
      }
      if (kind === "TIME" && scene.time) {
        values.push(scene.time);
      }
    }
  });

  return uniqueValues(values);
}

function predictNextCharacter(
  editor: Editor,
  excludedPosition: number,
): string | null {
  const speakers: string[] = [];

  editor.state.doc.descendants((node, position) => {
    if (
      node.type.name === "paragraph" &&
      position < excludedPosition &&
      position !== excludedPosition &&
      toScenarioElementType(node.attrs.scenarioType) === "CHARACTER"
    ) {
      const name = normalizeValue(node.textContent);
      if (name) {
        speakers.push(name);
      }
    }
  });

  if (speakers.length < 2) {
    return null;
  }

  const previousSpeaker = speakers[speakers.length - 2] ?? null;
  const lastSpeaker = speakers[speakers.length - 1] ?? null;
  return previousSpeaker && previousSpeaker !== lastSpeaker
    ? previousSpeaker
    : null;
}

function parseCompletedSceneHeading(text: string): {
  location: string;
  time: string;
} {
  const match = normalizeValue(text).match(
    /^(?:INT\.\/EXT\.|INT\.|EXT\.)\s+(.+?)(?:\s+-\s+(.+))?$/,
  );
  return {
    location: match?.[1]?.trim() ?? "",
    time: match?.[2]?.trim() ?? "",
  };
}

function splitIntroAndLocation(text: string): {
  intro: string;
  location: string;
} {
  const match = text.match(/^(INT\.\/EXT\.|INT\.|EXT\.)\s*(.*)$/);
  return {
    intro: match?.[1] ?? "INT.",
    location: match?.[2]?.trim() ?? "",
  };
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeValue).filter(Boolean))];
}

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr-FR");
}
