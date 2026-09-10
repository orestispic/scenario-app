import { Extension, mergeAttributes, Node } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  DEFAULT_SCENARIO_ELEMENT_TYPE,
  toScenarioElementType,
  type ScenarioElementType,
} from "../scenarioTypes";
import {
  getEnterType,
  getShiftTabType,
} from "../scenarioStateMachine";
import {
  acceptSelectedSmartTypeSuggestion,
  analyzeSceneHeading,
  dismissSmartType,
  moveSmartTypeSelection,
} from "../smartType";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    scenarioParagraph: {
      setScenarioElementType: (type: ScenarioElementType) => ReturnType;
    };
  }
}

export const ScenarioParagraph = Node.create({
  name: "paragraph",
  priority: 1000,
  group: "block",
  content: "inline*",

  addAttributes() {
    return {
      scenarioType: {
        default: DEFAULT_SCENARIO_ELEMENT_TYPE,
        parseHTML: (element) =>
          toScenarioElementType(element.getAttribute("data-scenario-type")),
        renderHTML: (attributes) => ({
          "data-scenario-type": toScenarioElementType(
            attributes.scenarioType,
          ),
        }),
      },
      ending: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-scenario-ending") === "true",
        renderHTML: (attributes) =>
          attributes.ending ? { "data-scenario-ending": "true" } : {},
      },
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-block-id"),
        renderHTML: (attributes) =>
          attributes.blockId ? { "data-block-id": attributes.blockId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setScenarioElementType:
        (type) =>
        ({ editor }) =>
          setCurrentScenarioElementType(editor, type),
    };
  },
});

export const ScenarioKeyboardShortcuts = Extension.create({
  name: "scenarioKeyboardShortcuts",
  priority: 1100,

  addKeyboardShortcuts() {
    return {
      Tab: () =>
        acceptSelectedSmartTypeSuggestion(this.editor) || handleTab(this.editor),
      "Shift-Tab": () => changeCurrentType(this.editor),
      Enter: () => handleEnter(this.editor),
      Backspace: () => deleteCurrentEmptyParagraph(this.editor),
      "Mod-1": () => createNewScene(this.editor),
      ArrowDown: () => moveSmartTypeSelection(this.editor, 1),
      ArrowUp: () => moveSmartTypeSelection(this.editor, -1),
      Escape: () => dismissSmartType(this.editor),
    };
  },
});

export function getCurrentScenarioElementType(
  editor: Editor,
): ScenarioElementType {
  return toScenarioElementType(editor.state.selection.$from.parent.attrs.scenarioType);
}

function changeCurrentType(editor: Editor): boolean {
  const currentType = getCurrentScenarioElementType(editor);
  const nextType = getShiftTabType(currentType);

  return setCurrentScenarioElementType(editor, nextType);
}

function handleTab(editor: Editor): boolean {
  const currentType = getCurrentScenarioElementType(editor);
  const text = editor.state.selection.$from.parent.textContent;
  const isEmpty = isVisuallyEmpty(currentType, text);

  if (currentType === "SCENE_HEADING") {
    return handleSceneHeadingTab(editor);
  }

  if (currentType === "ACTION") {
    return isEmpty
      ? setCurrentScenarioElementType(editor, "CHARACTER")
      : insertParagraphAfter(editor, "CHARACTER");
  }

  if (currentType === "CHARACTER") {
    if (isEmpty) {
      return setCurrentScenarioElementType(editor, "ACTION");
    }

    normalizeCurrentCharacter(editor);
    return insertParagraphAfter(editor, "PARENTHETICAL", "()", 1);
  }

  if (currentType === "DIALOGUE") {
    return isEmpty
      ? replaceCurrentParagraph(editor, "PARENTHETICAL", "()", 1)
      : insertParagraphAfter(editor, "PARENTHETICAL", "()", 1);
  }

  if (currentType === "PARENTHETICAL") {
    return isEmpty
      ? replaceCurrentParagraph(editor, "DIALOGUE", "")
      : insertParagraphAfter(editor, "DIALOGUE");
  }

  return isEmpty
    ? setCurrentScenarioElementType(editor, "SCENE_HEADING")
    : insertParagraphAfter(editor, "SCENE_HEADING");
}

function handleEnter(editor: Editor): boolean {
  if (acceptSelectedSmartTypeSuggestion(editor, "CHARACTER")) {
    return true;
  }

  // Au milieu d'un bloc, Entrée doit le couper à l'emplacement du curseur.
  // Le second morceau garde volontairement le même type et les mêmes styles
  // au lieu d'appliquer la transition de scénario usuelle.
  if (splitCurrentParagraphAtCursor(editor)) {
    return true;
  }

  if (getCurrentScenarioElementType(editor) === "CHARACTER") {
    normalizeCurrentCharacter(editor);
  }

  if (getCurrentScenarioElementType(editor) === "SCENE_HEADING") {
    normalizeCurrentSceneHeading(editor);
  }

  return insertNextTypedParagraph(editor);
}

function splitCurrentParagraphAtCursor(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (
    !empty ||
    $from.depth < 1 ||
    $from.parent.type.name !== "paragraph" ||
    $from.parentOffset >= $from.parent.content.size
  ) {
    return false;
  }

  const transaction = state.tr.split($from.pos, 1, [{
    type: $from.parent.type,
    attrs: { ...$from.parent.attrs, blockId: null },
  }]);
  transaction.setSelection(
    TextSelection.create(transaction.doc, transaction.mapping.map($from.pos, 1)),
  );
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function deleteCurrentEmptyParagraph(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  const currentType = getCurrentScenarioElementType(editor);

  if (
    !empty ||
    !isVisuallyEmpty(currentType, $from.parent.textContent) ||
    $from.depth < 1 ||
    $from.parent.type.name !== "paragraph"
  ) {
    return false;
  }

  const paragraphPosition = $from.before($from.depth);
  const previousNode = state.doc.resolve(paragraphPosition).nodeBefore;
  if (!previousNode) {
    return false;
  }

  const transaction = state.tr.delete(
    paragraphPosition,
    paragraphPosition + $from.parent.nodeSize,
  );
  transaction.setSelection(
    TextSelection.create(transaction.doc, paragraphPosition - 1),
  );
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function createNewScene(editor: Editor): boolean {
  const currentType = getCurrentScenarioElementType(editor);
  const currentText = editor.state.selection.$from.parent.textContent;

  if (isVisuallyEmpty(currentType, currentText)) {
    return replaceCurrentParagraph(editor, "SCENE_HEADING", "");
  }

  return insertParagraphAfter(editor, "SCENE_HEADING");
}

function handleSceneHeadingTab(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  const analysis = analyzeSceneHeading($from.parent.textContent, $from.parentOffset);

  if (analysis.part === "INTRO") {
    return true;
  }

  if (analysis.part === "LOCATION") {
    if (!analysis.location) {
      return true;
    }

    const heading = `${analysis.intro} ${analysis.location.toLocaleUpperCase("fr-FR")} - `;
    return replaceCurrentText(editor, heading, heading.length);
  }

  if (!analysis.time) {
    return true;
  }

  return insertParagraphAfter(editor, "ACTION");
}

function insertNextTypedParagraph(editor: Editor): boolean {
  const nextType = getEnterType(getCurrentScenarioElementType(editor));
  return insertParagraphAfter(editor, nextType);
}

function setCurrentScenarioElementType(
  editor: Editor,
  type: ScenarioElementType,
): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;

  if ($from.depth < 1 || $from.parent.type.name !== "paragraph") {
    return false;
  }

  const paragraphPosition = $from.before($from.depth);
  const transaction = state.tr.setNodeMarkup(paragraphPosition, undefined, {
    ...$from.parent.attrs,
    scenarioType: type,
  });

  view.dispatch(transaction.scrollIntoView());
  return true;
}

function insertParagraphAfter(
  editor: Editor,
  type: ScenarioElementType,
  text = "",
  cursorOffset = text.length,
): boolean {
  const { $from } = editor.state.selection;

  if ($from.depth < 1 || $from.parent.type.name !== "paragraph") {
    return false;
  }

  return insertScenarioParagraphAfterPosition(
    editor,
    $from.before($from.depth),
    type,
    text,
    cursorOffset,
  );
}

/** Insère un paragraphe après un bloc précis, même si le curseur est ailleurs. */
export function insertScenarioParagraphAfterPosition(
  editor: Editor,
  paragraphPosition: number,
  type: ScenarioElementType,
  text = "",
  cursorOffset = text.length,
): boolean {
  const { state, view } = editor;
  const currentParagraph = state.doc.nodeAt(paragraphPosition);

  if (!currentParagraph || currentParagraph.type.name !== "paragraph") {
    return false;
  }

  const insertionPosition = paragraphPosition + currentParagraph.nodeSize;
  const content = text ? state.schema.text(text) : undefined;
  const paragraph = state.schema.nodes.paragraph.create(
    { scenarioType: type },
    content,
  );
  const transaction = state.tr.insert(insertionPosition, paragraph);
  transaction.setSelection(
    TextSelection.create(
      transaction.doc,
      insertionPosition + 1 + cursorOffset,
    ),
  );
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function replaceCurrentParagraph(
  editor: Editor,
  type: ScenarioElementType,
  text: string,
  cursorOffset = text.length,
): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;

  if ($from.depth < 1 || $from.parent.type.name !== "paragraph") {
    return false;
  }

  const paragraphPosition = $from.before($from.depth);
  const content = text ? state.schema.text(text) : undefined;
  const paragraph = state.schema.nodes.paragraph.create(
    { ...$from.parent.attrs, scenarioType: type },
    content,
  );
  const transaction = state.tr.replaceWith(
    paragraphPosition,
    paragraphPosition + $from.parent.nodeSize,
    paragraph,
  );
  transaction.setSelection(
    TextSelection.create(transaction.doc, paragraphPosition + 1 + cursorOffset),
  );
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function replaceCurrentText(
  editor: Editor,
  text: string,
  cursorOffset: number,
): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  const contentStart = $from.start($from.depth);
  const transaction = state.tr.insertText(
    text,
    contentStart,
    $from.end($from.depth),
  );
  transaction.setSelection(
    TextSelection.create(transaction.doc, contentStart + cursorOffset),
  );
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function normalizeCurrentCharacter(editor: Editor): void {
  const text = editor.state.selection.$from.parent.textContent;
  const normalizedName = text
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("fr-FR");

  if (normalizedName && normalizedName !== text) {
    replaceCurrentText(editor, normalizedName, normalizedName.length);
  }
}

function normalizeCurrentSceneHeading(editor: Editor): void {
  const text = editor.state.selection.$from.parent.textContent;
  const normalizedHeading = text
    .trim()
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("fr-FR");

  if (normalizedHeading && normalizedHeading !== text) {
    replaceCurrentText(editor, normalizedHeading, normalizedHeading.length);
  }
}

function isVisuallyEmpty(type: ScenarioElementType, text: string): boolean {
  const trimmedText = text.trim();
  return (
    trimmedText.length === 0 ||
    (type === "PARENTHETICAL" && trimmedText === "()")
  );
}
