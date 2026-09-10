import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const DEFAULT_PAGE_HEIGHT = 1122.52;
const DEFAULT_PAGE_GAP = 24;
const DEFAULT_PRINTABLE_HEIGHT = 930.52;
const paginationPluginKey = new PluginKey<DecorationSet>("scenarioPagination");

interface NodePageBreakDecoration {
  from: number;
  to: number;
  spacer: number;
}

interface ContinuationBreakDecoration {
  position: number;
  spacer: number;
  markerTop: number;
  type: "ACTION" | "DIALOGUE";
}

interface PageBreaks {
  nodes: NodePageBreakDecoration[];
  continuations: ContinuationBreakDecoration[];
}

export interface PaginationResult {
  pageCount: number;
  currentPage: number;
}

export const ScenarioPagination = Extension.create({
  name: "scenarioPagination",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paginationPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, decorations) => {
            const pageBreaks = transaction.getMeta(paginationPluginKey) as
              | PageBreaks
              | undefined;

            if (pageBreaks) {
              return DecorationSet.create(
                transaction.doc,
                pageBreaks.nodes.map(({ from, to, spacer }) =>
                  Decoration.node(from, to, {
                    class: "has-page-break-before",
                    style: `--page-break-before: ${spacer}px`,
                  }),
                ).concat(
                  pageBreaks.continuations.map(({ position, spacer, markerTop, type }) =>
                    Decoration.widget(
                      position,
                      () => continuationWidget(spacer, markerTop, type),
                      { side: -1 },
                    ),
                  ),
                ),
              );
            }

            return decorations.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations: (state) => paginationPluginKey.getState(state),
        },
      }),
    ];
  },
});

/**
 * Measures the rendered screenplay, then applies visual-only ProseMirror
 * decorations. No spacer is stored in the screenplay document.
 */
export function paginateScenarioEditor(
  editor: Editor,
  selectionPosition?: HTMLElement | null,
): PaginationResult {
  if (editor.isDestroyed) {
    return { pageCount: 1, currentPage: 1 };
  }

  clearPageBreaks(editor);

  const editorElement = editor.view.dom;
  const canvas = editorElement.closest<HTMLElement>(".document-canvas");
  const pageSheet = canvas?.querySelector<HTMLElement>(".page-sheet");
  const canvasStyle = canvas ? getComputedStyle(canvas) : null;
  // offsetTop/offsetHeight des paragraphes sont exprimés dans les coordonnées
  // de mise en page, avant le zoom CSS. getBoundingClientRect(), lui, est
  // déjà agrandi ou réduit par ce zoom. Il faut donc garder offsetHeight ici
  // pour que les deux côtés du calcul restent dans la même unité.
  const pageHeight = pageSheet?.offsetHeight || DEFAULT_PAGE_HEIGHT;
  const pageGap = readPixelValue(canvasStyle, "--page-gap", DEFAULT_PAGE_GAP);
  const pageStride = pageHeight + pageGap;
  const printableHeight = readPixelValue(
    getComputedStyle(editorElement),
    "min-height",
    DEFAULT_PRINTABLE_HEIGHT,
  );
  const paragraphs = Array.from(
    editorElement.querySelectorAll<HTMLElement>(":scope > p"),
  );
  const pageBreaks: NodePageBreakDecoration[] = [];
  const continuations: ContinuationBreakDecoration[] = [];
  let documentPosition = 0;
  let accumulatedSpacer = 0;
  let visualDocumentBottom = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const documentNode = editor.state.doc.child(index);
    const top = paragraph.offsetTop + accumulatedSpacer;
    const pageIndex = Math.max(0, Math.floor((top + 0.5) / pageStride));
    const pageStart = pageIndex * pageStride;
    const printableBottom = pageStart + printableHeight;
    const type = paragraph.dataset.scenarioType;
    const isEmptyParagraph = (paragraph.textContent ?? "").trim().length === 0;
    const protectedHeight = getProtectedBlockHeight(
      paragraphs,
      index,
      top,
      printableBottom,
    );

    // Une action ou une réplique longue doit être scindée à la ligne, et non
    // déplacée intégralement sur la page suivante. Les autres blocs restent
    // protégés pour ne pas être isolés en bas de page.
    const canContinueAcrossPages = type === "ACTION" || type === "DIALOGUE";
    if (
      (!canContinueAcrossPages || isEmptyParagraph) &&
      top > pageStart + 0.5 &&
      top + Math.max(paragraph.offsetHeight, protectedHeight) > printableBottom
    ) {
      const spacer = Math.max(0, pageStart + pageStride - top);
      pageBreaks.push({
        from: documentPosition,
        to: documentPosition + documentNode.nodeSize,
        spacer,
      });
      accumulatedSpacer += spacer;
    }

    // Si le paragraphe lui-même est repoussé à la page suivante, son haut
    // visuel doit inclure cette coupure avant de calculer le bas du document.
    const visualTop = paragraph.offsetTop + accumulatedSpacer;

    let continuationSpacer = 0;
    if (type === "ACTION" || type === "DIALOGUE") {
      const paragraphContinuations = getContinuationBreaks(
        editor,
        paragraph,
        accumulatedSpacer,
        pageStride,
        printableHeight,
      );
      continuations.push(...paragraphContinuations);
      continuationSpacer = paragraphContinuations.reduce(
        (total, continuation) => total + continuation.spacer,
        0,
      );
      accumulatedSpacer += continuationSpacer;
    }

    // Les décorations de pagination viennent juste d'être calculées et ne
    // sont pas encore forcément reflétées dans offsetTop/offsetHeight. Cette
    // valeur virtuelle garantit qu'une feuille est rendue avant que le texte
    // puisse visuellement descendre dans le vide.
    visualDocumentBottom = Math.max(
      visualDocumentBottom,
      visualTop + paragraph.offsetHeight + continuationSpacer,
    );

    documentPosition += documentNode.nodeSize;
  }

  if (pageBreaks.length > 0 || continuations.length > 0) {
    editor.view.dispatch(
      editor.state.tr.setMeta(paginationPluginKey, {
        nodes: pageBreaks,
        continuations,
      } satisfies PageBreaks),
    );
  }

  const pageCount = Math.max(1, Math.floor(visualDocumentBottom / pageStride) + 1);
  const selectedParagraph = selectionPosition?.closest<HTMLElement>("p");
  const selectedTextTop = selectedParagraph
    ? selectedParagraph.offsetTop +
      readPixelValue(
        getComputedStyle(selectedParagraph),
        "--page-break-before",
        0,
      )
    : 0;
  const currentPage = Math.min(
    pageCount,
    Math.max(1, Math.floor(selectedTextTop / pageStride) + 1),
  );

  return { pageCount, currentPage };
}

export function isPaginationTransaction(transaction: Transaction): boolean {
  return transaction.getMeta(paginationPluginKey) !== undefined;
}

function clearPageBreaks(editor: Editor): void {
  const decorations = paginationPluginKey.getState(editor.state);
  if (decorations && decorations !== DecorationSet.empty) {
    editor.view.dispatch(
      editor.state.tr.setMeta(paginationPluginKey, { nodes: [], continuations: [] }),
    );
  }
}

function getProtectedBlockHeight(
  paragraphs: HTMLElement[],
  index: number,
  top: number,
  printableBottom: number,
): number {
  const paragraph = paragraphs[index];
  const type = paragraph.dataset.scenarioType;

  if (type !== "CHARACTER" && type !== "SCENE_HEADING") {
    return paragraph.offsetHeight;
  }

  const nextParagraph = paragraphs[index + 1];
  if (!nextParagraph) {
    return paragraph.offsetHeight;
  }

  if (type === "CHARACTER") {
    const nextType = nextParagraph.dataset.scenarioType;
    if (nextType !== "DIALOGUE" && nextType !== "PARENTHETICAL") {
      return paragraph.offsetHeight;
    }

    if (nextType === "DIALOGUE") {
      const lineHeight = getLineHeight(nextParagraph);
      const dialogueTop = top + (nextParagraph.offsetTop - paragraph.offsetTop);
      const availableLines = Math.max(0, Math.floor((printableBottom - dialogueTop) / lineHeight));
      const dialogueWouldSplit = dialogueTop + nextParagraph.offsetHeight > printableBottom;

      // Final Draft évite de laisser seulement une à trois lignes de réplique
      // derrière le personnage en bas de page.
      if (dialogueWouldSplit && availableLines <= 3) {
        return nextParagraph.offsetTop - paragraph.offsetTop + nextParagraph.offsetHeight;
      }
      return paragraph.offsetHeight;
    }
  }

  if (
    type === "SCENE_HEADING" &&
    nextParagraph.dataset.scenarioType !== "ACTION"
  ) {
    return paragraph.offsetHeight;
  }

  const lineHeight = getLineHeight(nextParagraph);
  const firstUsefulLineBottom =
    nextParagraph.offsetTop - paragraph.offsetTop +
    Math.min(nextParagraph.offsetHeight, lineHeight * 2);

  return Math.max(paragraph.offsetHeight, firstUsefulLineBottom);
}

/**
 * Ajoute une coupure visuelle dans les paragraphes qui traversent une page.
 * Le texte n'est jamais modifié : seul l'affichage reçoit l'espace et « (SUITE) ».
 */
function getContinuationBreaks(
  editor: Editor,
  paragraph: HTMLElement,
  accumulatedSpacer: number,
  pageStride: number,
  printableHeight: number,
): ContinuationBreakDecoration[] {
  const type = paragraph.dataset.scenarioType as "ACTION" | "DIALOGUE";
  const paragraphTop = paragraph.offsetTop + accumulatedSpacer;
  const paragraphPage = Math.max(0, Math.floor((paragraphTop + 0.5) / pageStride));
  const paragraphPrintableBottom = paragraphPage * pageStride + printableHeight;
  // Cas très majoritaire : le paragraphe tient sur sa page. Éviter alors de
  // mesurer chaque caractère réduit fortement le coût de chaque frappe.
  if (paragraphTop + paragraph.offsetHeight <= paragraphPrintableBottom + 0.5) {
    return [];
  }

  const editorRect = editor.view.dom.getBoundingClientRect();
  const layoutWidth = editor.view.dom.offsetWidth || 1;
  // La feuille peut être zoomée avec Ctrl + molette. Les rectangles Range
  // sont alors dans les pixels affichés, contrairement aux offsets des
  // paragraphes : on les ramène dans les coordonnées de mise en page.
  const renderScale = editorRect.width / layoutWidth || 1;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  const breaks: ContinuationBreakDecoration[] = [];
  let node: Text | null;
  let extraSpacer = accumulatedSpacer;

  while ((node = walker.nextNode() as Text | null)) {
    for (let offset = 0; offset < node.data.length; offset += 1) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) {
        continue;
      }

      const position = editor.view.posAtDOM(node, offset);
      const textTop = (rect.top - editorRect.top) / renderScale;
      const bottom = (rect.bottom - editorRect.top) / renderScale + extraSpacer;
      const markerTop =
        (rect.top - paragraph.getBoundingClientRect().top) / renderScale;
      const pageIndex = Math.max(0, Math.floor((textTop + extraSpacer) / pageStride));
      const printableBottom = pageIndex * pageStride + printableHeight;
      if (bottom <= printableBottom + 0.5) {
        continue;
      }

      // La coupure est placée avant le tout premier caractère qui ne rentre
      // plus. Cela évite de laisser une lettre isolée avant « (SUITE) ».
      const spacer = Math.max(0, pageIndex * pageStride + pageStride - (textTop + extraSpacer));
      if (spacer > 0) {
        breaks.push({ position, spacer, markerTop, type });
        // Le reste du paragraphe est maintenant virtuellement sur la page
        // suivante. Continuer permet de traiter aussi un bloc exceptionnellement
        // long qui traverserait plusieurs pages, avec une seule marque par coupure.
        extraSpacer += spacer;
      }
    }
  }

  return breaks;
}

function continuationWidget(
  spacer: number,
  markerTop: number,
  type: "ACTION" | "DIALOGUE",
): HTMLElement {
  const widget = document.createElement("span");
  widget.className = `page-continuation page-continuation-${type.toLowerCase()}`;
  widget.style.setProperty("--continuation-spacer", `${spacer}px`);
  widget.contentEditable = "false";
  widget.setAttribute("aria-hidden", "true");
  const marker = document.createElement("span");
  marker.className = "page-continuation-marker";
  marker.style.setProperty("--continuation-marker-top", `${markerTop}px`);
  marker.textContent = "(SUITE)";
  widget.append(marker);
  return widget;
}

function getLineHeight(element: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(element).lineHeight) || 16;
}

function readPixelValue(
  style: CSSStyleDeclaration | null,
  property: string,
  fallback: number,
): number {
  const value = Number.parseFloat(style?.getPropertyValue(property) ?? "");
  return Number.isFinite(value) ? value : fallback;
}
