import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
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

export type SmartTypeCandidates = Pick<SmartTypeContext, "kind" | "items">;
export type SceneHeadingSmartTypeKind = Extract<SmartTypeKind, "SCENE_INTRO" | "LOCATION" | "TIME">;
export type SceneHeadingSmartTypeCandidates = Omit<SmartTypeCandidates, "kind"> & { kind: SceneHeadingSmartTypeKind };

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
  // Un lecteur d'un projet partagé peut déplacer son curseur pour consulter
  // le scénario, mais SmartType ne doit ni lui être proposé ni modifier le
  // document. `isEditable` est la garde commune appliquée par le runtime Cloud.
  if (!editor.isEditable) return null;
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
  const { $from, empty } = editor.state.selection;

  // SmartType completes what is being typed at a cursor. A text selection can
  // start in a scene heading and end in another block; treating its `$from` as
  // an editable heading would replace the selection on Tab.
  if (!empty) {
    return null;
  }

  if ($from.parent.type.name !== "paragraph") {
    return null;
  }

  const type = toScenarioElementType($from.parent.attrs.scenarioType);
  const text = $from.parent.textContent;
  const currentParagraphPosition = $from.before($from.depth);

  if (type === "SCENE_HEADING") {
    return getSceneHeadingSmartTypeCandidates(
      editor.state.doc,
      text,
      $from.parentOffset,
      currentParagraphPosition,
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
  if (!editor.isEditable) return false;
  const { $from } = editor.state.selection;

  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  const text = $from.parent.textContent;
  const contentStart = $from.start($from.depth);
  const currentType = toScenarioElementType($from.parent.attrs.scenarioType);
  let replacement = suggestion;

  if (kind === "SCENE_INTRO" || kind === "LOCATION" || kind === "TIME") {
    replacement = applySceneHeadingSmartTypeSuggestion(text, kind, suggestion, $from.parentOffset);
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

/** Même source de suggestions pour l'éditeur principal et le Whiteboard. */
export function getSceneHeadingSmartTypeCandidates(
  document: ProseMirrorNode,
  text: string,
  cursorOffset = text.length,
  excludedPosition = -1,
): SceneHeadingSmartTypeCandidates | null {
  const analysis = analyzeSceneHeading(text, cursorOffset);
  if (analysis.part === "INTRO") return makeContext("SCENE_INTRO", SCENE_INTROS, analysis.query);
  if (analysis.part === "LOCATION") {
    return makeContext(
      "LOCATION",
      collectKnownValuesFromDocument(document, "LOCATION", excludedPosition),
      analysis.query,
    );
  }
  return makeContext(
    "TIME",
    uniqueValues([
      ...STANDARD_TIMES,
      ...collectKnownValuesFromDocument(document, "TIME", excludedPosition),
    ]),
    analysis.query,
  );
}

export function applySceneHeadingSmartTypeSuggestion(
  text: string,
  kind: SceneHeadingSmartTypeKind,
  suggestion: string,
  cursorOffset = text.length,
): string {
  if (kind === "SCENE_INTRO") return `${suggestion} `;
  const analysis = analyzeSceneHeading(text, cursorOffset);
  if (kind === "LOCATION") return `${analysis.intro} ${suggestion} - `;
  return `${analysis.intro} ${analysis.location} - ${suggestion}`;
}

function makeContext<Kind extends SmartTypeKind>(
  kind: Kind,
  values: readonly string[],
  query: string,
): (Omit<SmartTypeCandidates, "kind"> & { kind: Kind }) | null {
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
  return collectKnownValuesFromDocument(editor.state.doc, kind, excludedPosition);
}

function collectKnownValuesFromDocument(
  document: ProseMirrorNode,
  kind: "CHARACTER" | "LOCATION" | "TIME",
  excludedPosition: number,
): string[] {
  const values: string[] = [];

  document.descendants((node, position) => {
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
