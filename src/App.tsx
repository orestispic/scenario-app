import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  getCurrentScenarioElementType,
  insertScenarioParagraphAfterPosition,
  ScenarioKeyboardShortcuts,
  ScenarioParagraph,
} from "./editor/extensions/ScenarioParagraph";
import {
  createDefaultTextReplacements,
  hasDuplicateTextReplacementShortcut,
  mergeTextReplacements,
  normalizeTextReplacements,
  removeRetiredDefaultTextReplacements,
  DoubleSpaceToPeriod,
  TextReplacementShortcuts,
  type TextReplacement,
} from "./editor/textReplacements";
import { SentenceCapitalization } from "./editor/sentenceCapitalization";
import {
  CommentAnchorMark,
  addCommentMark,
  createStableId,
  ensureScenarioBlockIds,
  findCommentAnchorPosition,
  getSelectionCommentAnchor,
  reconcileCommentAnchors,
  removeCommentMark,
  type CommentAnchor,
  type CommentThread,
} from "./editor/comments";
import {
  DEFAULT_SCENARIO_ELEMENT_TYPE,
  getScenarioElementLabel,
  toScenarioElementType,
  type ScenarioElementType,
} from "./editor/scenarioTypes";
import {
  acceptSmartTypeSuggestion,
  getSmartTypeContext,
  setSmartTypeSelection,
  type SmartTypeContext,
} from "./editor/smartType";
import {
  isPaginationTransaction,
  paginateScenarioEditor,
  ScenarioPagination,
} from "./editor/pagination";
import { clientPointToOverlay, clientRectToOverlay } from "./editor/overlayCoordinates";
import {
  choosePdfToSave,
  choosePdfToOpen,
  chooseScenarioToOpen,
  chooseScenarioToSave,
  clearRecovery,
  readRecentScenarios,
  readRecovery,
  readScenario,
  recordRecentScenario,
  writeAutosave,
  writeBackup,
  writePdf,
  writeScenario,
  type RecentScenario,
} from "./document/persistence";
import {
  createScenarioFile,
  createEmptyCoverPage,
  getFileTitle,
  getCoverCredits,
  hasCoverPageContent,
  normalizeCoverPage,
  parseRecoveryFile,
  parseScenarioFile,
  serializeRecoveryFile,
  type CoverPageData,
  type ScenarioFile,
} from "./document/scenarioFile";
import { extractPdfText, parseAiScenarioResponse, PDF_MANUAL_PROMPT, PDF_TO_SCENARIO_PROMPT } from "./document/pdfImport";
import {
  createDefaultAiConfig,
  buildAiPromptInstruction,
  readAiConfig,
  RESPONSE_ONLY_INSTRUCTION,
  runAiPrompt,
  translateScenario,
  writeAiConfig,
  type AiConfigView,
  type AiPrompt,
  type ScenarioTranslationSegment,
} from "./document/aiConfig";
import { AccountLicensePanel } from "./commercial/AccountLicensePanel";
import { loadDevelopmentAccountState, type DevelopmentAccountState } from "./commercial/developmentBootstrap";
import "./App.css";

const UNTITLED_DOCUMENT = "Sans titre";
const AUTOSAVE_DELAY_MS = 2_000;
const BACKUP_INTERVAL_MS = 5 * 60 * 1_000;
const MIN_ZOOM = 60;
const MAX_ZOOM = 160;
const ZOOM_STEP = 10;
const TEXT_REPLACEMENTS_STORAGE_KEY = "scenario-text-replacements";
const TEXT_REPLACEMENTS_SEEDED_KEY = "scenario-text-replacements-seeded-v4";
const TEXT_REPLACEMENTS_ENABLED_KEY = "scenario-text-replacements-enabled";
const PDF_CUSTOM_LANGUAGES_STORAGE_KEY = "scenario-pdf-custom-languages";

function readLocalSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Une préférence locale ne doit jamais empêcher l'éditeur de fonctionner.
  }
}

const initialContent: JSONContent = {
  type: "doc",
  content: [{
    type: "paragraph",
    attrs: { scenarioType: DEFAULT_SCENARIO_ELEMENT_TYPE },
  }],
};

const placeholders: Record<ScenarioElementType, string> = {
  SCENE_HEADING: "INT. LIEU - JOUR",
  ACTION: "Action...",
  CHARACTER: "PERSONNAGE",
  DIALOGUE: "Dialogue...",
  PARENTHETICAL: "(indication)",
  // Les transitions sont toujours insérées explicitement depuis le bouton
  // Transition ; aucun texte d'aide ne doit apparaître dans un bloc vide.
  TRANSITION: "",
};

const STANDARD_PARAGRAPH_TRANSITIONS = [
  "FONDU AU NOIR",
  "FONDU ENCHAÎNÉ",
  "FONDU AU BLANC",
  "MATCH CUT VERS",
] as const;

interface SmartTypeViewState extends SmartTypeContext {
  left: number;
  top: number;
}

interface AiParagraphTarget {
  left: number;
  transitionLeft: number;
  top: number;
  highlightLeft: number;
  highlightTop: number;
  highlightWidth: number;
  highlightHeight: number;
  position: number;
  text: string;
  type: "ACTION" | "DIALOGUE";
}

interface CommentActionTarget {
  left: number;
  top: number;
}

interface DocumentState {
  filePath: string | null;
  title: string;
  isDirty: boolean;
  status: string;
}

interface ScenarioContextMenuState {
  left: number;
  top: number;
}

interface PdfExportDraft {
  includeCoverPage: boolean;
  includeSceneNumbers: boolean;
  includePageNumbers: boolean;
  translationLanguage: string;
  customTranslationLanguage: string;
}

const PDF_TRANSLATION_LANGUAGES = [
  "anglais",
  "espagnol",
  "allemand",
  "italien",
  "portugais",
] as const;

function normalizePdfLanguage(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function readCustomPdfLanguages(): string[] {
  try {
    const stored = JSON.parse(readLocalSetting(PDF_CUSTOM_LANGUAGES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) {
      return [];
    }

    const seen = new Set<string>();
    return stored.reduce<string[]>((languages, value) => {
      if (typeof value !== "string") {
        return languages;
      }
      const language = normalizePdfLanguage(value);
      const key = language.toLocaleLowerCase("fr-FR");
      if (!language || language.length > 60 || seen.has(key)) {
        return languages;
      }
      seen.add(key);
      languages.push(language);
      return languages;
    }, []);
  } catch {
    return [];
  }
}

function displayPdfLanguage(language: string): string {
  return language.charAt(0).toLocaleUpperCase("fr-FR") + language.slice(1);
}

interface TextMatch {
  from: number;
  to: number;
}

type Theme = "light" | "dark";

const smartTypeLabels: Record<SmartTypeContext["kind"], string> = {
  CHARACTER: "Personnages",
  SCENE_INTRO: "Intérieur / extérieur",
  LOCATION: "Lieux déjà utilisés",
  TIME: "Moment de la journée",
};

function getCommentActionPosition(
  editor: Editor,
  zoom: number,
  appShell: HTMLElement | null,
): CommentActionTarget | null {
  const { selection } = editor.state;
  if (selection.empty || selection.$from.parent !== selection.$to.parent) {
    return null;
  }
  const coords = editor.view.coordsAtPos(selection.to);
  const overlay = clientPointToOverlay(
    coords.left,
    coords.bottom + 4,
    zoom,
    appShell?.getBoundingClientRect(),
  );
  return {
    left: Math.max(8, overlay.left - 13),
    top: Math.max(76, overlay.top),
  };
}

function findTextMatches(editor: Editor, search: string, matchCase: boolean): TextMatch[] {
  const query = matchCase ? search : search.toLocaleLowerCase("fr-FR");
  if (!query) {
    return [];
  }

  const matches: TextMatch[] = [];
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) {
      return;
    }

    const text = matchCase ? node.text : node.text.toLocaleLowerCase("fr-FR");
    let index = text.indexOf(query);
    while (index !== -1) {
      matches.push({ from: position + index, to: position + index + query.length });
      index = text.indexOf(query, index + query.length);
    }
  });
  return matches;
}

function App() {
  const [currentType, setCurrentType] = useState<ScenarioElementType>(
    DEFAULT_SCENARIO_ELEMENT_TYPE,
  );
  const [smartType, setSmartType] = useState<SmartTypeViewState | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [commentActionTarget, setCommentActionTarget] = useState<CommentActionTarget | null>(null);
  const [commentAnchor, setCommentAnchor] = useState<CommentAnchor | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [expandedCommentId, setExpandedCommentId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [commentCardPositions, setCommentCardPositions] = useState<Record<string, { top: number; left: number }>>({});
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [recentScenarios, setRecentScenarios] = useState<RecentScenario[]>([]);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [pdfExportBusy, setPdfExportBusy] = useState(false);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [pdfImportPath, setPdfImportPath] = useState<string | null>(null);
  const [pdfImportBusy, setPdfImportBusy] = useState(false);
  const [pdfImportError, setPdfImportError] = useState("");
  const [pdfExportDraft, setPdfExportDraft] = useState<PdfExportDraft>({
    includeCoverPage: false,
    includeSceneNumbers: true,
    includePageNumbers: true,
    translationLanguage: "",
    customTranslationLanguage: "",
  });
  const [customPdfLanguages, setCustomPdfLanguages] = useState<string[]>(
    readCustomPdfLanguages,
  );
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findMatchCase, setFindMatchCase] = useState(false);
  const [findMatchIndex, setFindMatchIndex] = useState(-1);
  const [findMatchTotal, setFindMatchTotal] = useState(0);
  const [textReplacementsOpen, setTextReplacementsOpen] = useState(false);
  const [textReplacementQuery, setTextReplacementQuery] = useState("");
  const [textReplacements, setTextReplacements] = useState<TextReplacement[]>(() => {
    try {
      const savedReplacements = normalizeTextReplacements(
        JSON.parse(readLocalSetting(TEXT_REPLACEMENTS_STORAGE_KEY) ?? "[]"),
      );
      const cleanedReplacements = removeRetiredDefaultTextReplacements(savedReplacements);
      return readLocalSetting(TEXT_REPLACEMENTS_SEEDED_KEY) === "v4"
        ? cleanedReplacements
        : mergeTextReplacements(createDefaultTextReplacements(), cleanedReplacements);
    } catch {
      return createDefaultTextReplacements();
    }
  });
  const [textReplacementDrafts, setTextReplacementDrafts] = useState<TextReplacement[]>([]);
  const [textReplacementError, setTextReplacementError] = useState("");
  const [textReplacementsEnabled, setTextReplacementsEnabled] = useState(
    () => readLocalSetting(TEXT_REPLACEMENTS_ENABLED_KEY) !== "false",
  );
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const [coverPage, setCoverPage] = useState<CoverPageData>(() =>
    createEmptyCoverPage(),
  );
  const [coverDraft, setCoverDraft] = useState<CoverPageData>(() =>
    createEmptyCoverPage(),
  );
  const [coverPageHidden, setCoverPageHidden] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfigView>(() =>
    createDefaultAiConfig(),
  );
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiHelpOpen, setAiHelpOpen] = useState(false);
  const [aiMissingKeyNoticeOpen, setAiMissingKeyNoticeOpen] = useState(false);
  const [selectedAiPromptId, setSelectedAiPromptId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState(() => ({
    apiKey: "",
    model: createDefaultAiConfig().model,
    prompts: createDefaultAiConfig().prompts,
  }));
  const [aiTarget, setAiTarget] = useState<AiParagraphTarget | null>(null);
  const [aiPromptMenuOpen, setAiPromptMenuOpen] = useState(false);
  const [transitionMenuOpen, setTransitionMenuOpen] = useState(false);
  const [customTransitionOpen, setCustomTransitionOpen] = useState(false);
  const [customTransitionText, setCustomTransitionText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [developmentAccountState, setDevelopmentAccountState] = useState<DevelopmentAccountState | null>(null);
  const [developmentAccountStatus, setDevelopmentAccountStatus] = useState<"loading" | "ready" | "error">("loading");
  const [scenarioContextMenu, setScenarioContextMenu] =
    useState<ScenarioContextMenuState | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    readLocalSetting("scenario-theme") === "dark" ? "dark" : "light",
  );
  const [zoom, setZoom] = useState(() => {
    const storedZoom = Number(readLocalSetting("scenario-zoom"));
    return Number.isFinite(storedZoom)
      ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, storedZoom))
      : 100;
  });
  const [documentState, setDocumentState] = useState<DocumentState>({
    filePath: null,
    title: UNTITLED_DOCUMENT,
    isDirty: false,
    status: "Prêt",
  });
  const [initialRecoveryFinished, setInitialRecoveryFinished] = useState(false);
  const paginationFrame = useRef<number | null>(null);
  const isReplacingDocument = useRef(false);
  const recoveryWasChecked = useRef(false);
  const launchedScenarioWasChecked = useRef(false);
  const lastBackupAt = useRef(0);
  const closeInProgress = useRef(false);
  const smartTypeInteractionStarted = useRef(false);
  const aiPointerPosition = useRef<{ clientX: number; clientY: number } | null>(null);
  const findInput = useRef<HTMLInputElement | null>(null);
  const currentDocumentState = useRef(documentState);
  // La tête fait partie du document .scenario. Cette référence donne toujours
  // à l'enregistrement (manuel comme automatique) la dernière valeur saisie,
  // sans attendre un rendu React ou un clic sur « Appliquer ».
  const coverPageRef = useRef<CoverPageData>(coverPage);
  const coverPageHiddenRef = useRef(coverPageHidden);
  const textReplacementsRef = useRef(textReplacements);
  const textReplacementsEnabledRef = useRef(textReplacementsEnabled);
  const commentsRef = useRef(comments);
  const commentInput = useRef<HTMLTextAreaElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pdfImportOpen) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const path = event.payload.paths.find((candidate) => candidate.toLocaleLowerCase().endsWith(".pdf"));
      if (path) {
        setPdfImportPath(path);
        setPdfImportError("");
      } else {
        setPdfImportError("Dépose un fichier PDF depuis l’explorateur Windows.");
      }
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, [pdfImportOpen]);

  useEffect(() => {
    currentDocumentState.current = documentState;
  }, [documentState]);

  useEffect(() => {
    const clientVersion = import.meta.env.VITE_SCENARIO_CLIENT_VERSION ?? "0.0.0";
    void loadDevelopmentAccountState(clientVersion)
      .then((state) => {
        setDevelopmentAccountState(state);
        setDevelopmentAccountStatus("ready");
      })
      .catch(() => setDevelopmentAccountStatus("error"));
  }, []);

  useEffect(() => {
    coverPageRef.current = coverPage;
  }, [coverPage]);

  useEffect(() => {
    coverPageHiddenRef.current = coverPageHidden;
  }, [coverPageHidden]);

  useEffect(() => {
    textReplacementsRef.current = textReplacements;
    writeLocalSetting(
      TEXT_REPLACEMENTS_STORAGE_KEY,
      JSON.stringify(textReplacements),
    );
    writeLocalSetting(TEXT_REPLACEMENTS_SEEDED_KEY, "v4");
  }, [textReplacements]);

  useEffect(() => {
    textReplacementsEnabledRef.current = textReplacementsEnabled;
    writeLocalSetting(
      TEXT_REPLACEMENTS_ENABLED_KEY,
      String(textReplacementsEnabled),
    );
  }, [textReplacementsEnabled]);

  useEffect(() => {
    void readRecentScenarios().then(setRecentScenarios).catch(() => {
      // Les projets récents sont une aide de navigation, pas une dépendance au démarrage.
    });
  }, []);

  const refreshPagination = useCallback((editor: Editor) => {
    if (paginationFrame.current !== null) {
      cancelAnimationFrame(paginationFrame.current);
    }

    paginationFrame.current = requestAnimationFrame(() => {
      paginationFrame.current = null;
      if (editor.isDestroyed) {
        return;
      }
      const selectionDom = editor.view.domAtPos(editor.state.selection.from);
      const selectionElement =
        selectionDom.node instanceof HTMLElement
          ? selectionDom.node
          : selectionDom.node.parentElement;
      const pagination = paginateScenarioEditor(editor, selectionElement);
      setPageCount((previous) =>
        previous === pagination.pageCount ? previous : pagination.pageCount,
      );
      setCurrentPage((previous) =>
        previous === pagination.currentPage ? previous : pagination.currentPage,
      );
    });
  }, []);

  const refreshSmartType = useCallback((editor: Editor) => {
    if (!smartTypeInteractionStarted.current) {
      setSmartType(null);
      return;
    }
    const context = getSmartTypeContext(editor);

    if (!context) {
      setSmartType(null);
      return;
    }
    const coordinates = editor.view.coordsAtPos(editor.state.selection.from);
    const overlay = clientPointToOverlay(
      coordinates.left,
      coordinates.bottom + 6,
      zoom,
      appShellRef.current?.getBoundingClientRect(),
    );

    setSmartType({
      ...context,
      // La liste est volontairement sans limite d'écran : elle doit rester
      // exactement attachée au curseur, y compris quand celui-ci approche
      // d'un bord de fenêtre.
      left: overlay.left,
      top: overlay.top,
    });
  }, [zoom]);

  const refreshCurrentType = useCallback((editor: Editor) => {
    setCurrentType(getCurrentScenarioElementType(editor));
  }, []);

  const refreshEditorState = useCallback(
    (editor: Editor) => {
      refreshCurrentType(editor);
      refreshSmartType(editor);
      refreshPagination(editor);
    },
    [refreshCurrentType, refreshPagination, refreshSmartType],
  );

  const markDocumentChanged = useCallback(() => {
    if (isReplacingDocument.current) {
      return;
    }

    setDocumentState((previous) => ({
      ...previous,
      isDirty: true,
      status: "Modifications non enregistrées",
    }));
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false,
        paragraph: false,
      }),
      ScenarioParagraph,
      CommentAnchorMark,
      ScenarioKeyboardShortcuts,
      SentenceCapitalization,
      TextReplacementShortcuts.configure({
        getReplacements: () =>
          textReplacementsEnabledRef.current ? textReplacementsRef.current : [],
      }),
      DoubleSpaceToPeriod,
      ScenarioPagination,
      Placeholder.configure({
        placeholder: ({ node }) =>
          placeholders[toScenarioElementType(node.attrs.scenarioType)],
      }),
    ],
    content: initialContent,
    // Au démarrage, l'éditeur attend un clic réel de l'auteur. Cela évite
    // d'ouvrir SmartType sur le paragraphe initial avant toute interaction.
    autofocus: false,
    editorProps: {
      attributes: {
        class: "scenario-editor",
        spellcheck: "true",
      },
      handleDOMEvents: {
        mousedown: () => {
          smartTypeInteractionStarted.current = true;
          return false;
        },
        keydown: () => {
          smartTypeInteractionStarted.current = true;
          return false;
        },
      },
    },
    onCreate: ({ editor: activeEditor }) => {
      ensureScenarioBlockIds(activeEditor);
      refreshCurrentType(activeEditor);
      refreshPagination(activeEditor);
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      refreshEditorState(activeEditor);
      setCommentActionTarget(getCommentActionPosition(activeEditor, zoom, appShellRef.current));
    },
    onTransaction: ({ editor: activeEditor, transaction }) => {
      const updatesBlockIds = transaction.getMeta("scenario-block-ids") === true;
      if (!updatesBlockIds) {
        ensureScenarioBlockIds(activeEditor);
      }
      if (transaction.docChanged && !isReplacingDocument.current) {
        const reconciled = reconcileCommentAnchors(
          commentsRef.current,
          transaction.before,
          transaction.doc,
        );
        if (JSON.stringify(reconciled) !== JSON.stringify(commentsRef.current)) {
          commentsRef.current = reconciled;
          setComments(reconciled);
        }
      }
      if (!isPaginationTransaction(transaction) && !updatesBlockIds) {
        refreshEditorState(activeEditor);
      }
    },
    onUpdate: ({ editor: activeEditor, transaction }) => {
      if (transaction.getMeta("scenario-block-ids") !== true) {
        markDocumentChanged();
      }
      requestAnimationFrame(() => {
        if (!activeEditor.isDestroyed) {
          convertActionStartToSceneHeading(activeEditor);
        }
      });
    },
  });

  // Les suggestions sont affichées en position fixe. Elles doivent donc être
  // recalculées quand la feuille défile, même si le curseur reste immobile.
  useEffect(() => {
    if (!editor) {
      return;
    }
    const workspace = editor.view.dom.closest<HTMLElement>(".workspace");
    let frame: number | null = null;
    const refreshAfterLayoutChange = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!editor.isDestroyed) {
          refreshSmartType(editor);
        }
      });
    };
    workspace?.addEventListener("scroll", refreshAfterLayoutChange, { passive: true });
    window.addEventListener("resize", refreshAfterLayoutChange);
    refreshAfterLayoutChange();
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      workspace?.removeEventListener("scroll", refreshAfterLayoutChange);
      window.removeEventListener("resize", refreshAfterLayoutChange);
    };
  }, [editor, refreshSmartType, zoom]);

  useEffect(() => {
    commentsRef.current = comments;
    if (editor) {
      editor.view.dom.querySelectorAll<HTMLElement>("[data-comment-thread-id]").forEach((anchor) => {
        anchor.classList.toggle("is-active", anchor.dataset.commentThreadId === activeCommentId);
      });
    }
  }, [activeCommentId, comments, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const handleCommentClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const threadId = target.closest<HTMLElement>("[data-comment-thread-id]")?.dataset.commentThreadId;
        if (threadId) {
          setActiveCommentId(threadId);
        }
      }
    };
    editor.view.dom.addEventListener("click", handleCommentClick);
    return () => editor.view.dom.removeEventListener("click", handleCommentClick);
  }, [editor]);

  useEffect(() => {
    const clearCommentActionOutsideEditor = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(".comment-inline-button") ||
        editor?.view.dom.contains(target)
      ) {
        return;
      }
      if (editor && !editor.state.selection.empty) {
        // Les feuilles et la zone de travail ne sont pas du texte éditable.
        // Un clic à cet endroit doit donc retirer toute sélection visible.
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.create(editor.state.doc, editor.state.selection.to),
          ),
        );
      }
      setCommentActionTarget(null);
    };
    window.addEventListener("pointerdown", clearCommentActionOutsideEditor);
    return () => window.removeEventListener("pointerdown", clearCommentActionOutsideEditor);
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const updatePositions = () => {
      const next: Record<string, { top: number; left: number }> = {};
      const canvas = editor.view.dom.closest<HTMLElement>(".document-canvas");
      const canvasRect = canvas?.getBoundingClientRect();
      const appShellRect = appShellRef.current?.getBoundingClientRect();
      const anchoredComments = comments
        .filter((item) => item.status === "open" && !item.anchor.lost)
        .flatMap((thread) => {
        const position = findCommentAnchorPosition(editor, thread.anchor);
        if (!position) {
          return [];
        }
        const coords = editor.view.coordsAtPos(position.from);
        const overlay = clientPointToOverlay(coords.left, coords.top, zoom, appShellRect);
        return [{ thread, desiredTop: Math.max(82, overlay.top), coords, overlay }];
        })
        .sort((left, right) => left.desiredTop - right.desiredTop);

      let occupiedBottom = 82;
      for (const { thread, desiredTop, coords } of anchoredComments) {
        const card = document.querySelector<HTMLElement>(`[data-comment-card-id="${thread.id}"]`);
        const cardHeight = card?.offsetHeight ?? (expandedCommentId === thread.id ? 230 : 48);
        const top = Math.max(desiredTop, occupiedBottom);
        next[thread.id] = {
          top,
          left: Math.max(
            8,
            clientPointToOverlay(canvasRect?.left ?? coords.left, 0, zoom, appShellRect).left - 168,
          ),
        };
        occupiedBottom = top + cardHeight + 6;
      }
      setCommentCardPositions((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const frame = requestAnimationFrame(updatePositions);
    const workspace = editor.view.dom.closest<HTMLElement>(".workspace");
    const handleLayoutChange = () => {
      updatePositions();
      setCommentActionTarget(getCommentActionPosition(editor, zoom, appShellRef.current));
    };
    window.addEventListener("resize", handleLayoutChange);
    workspace?.addEventListener("scroll", handleLayoutChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleLayoutChange);
      workspace?.removeEventListener("scroll", handleLayoutChange);
    };
  }, [comments, editor, expandedCommentId, zoom]);

  const refreshAiTarget = useCallback(
    (target: EventTarget | null, clientX: number, clientY: number) => {
      if (!editor) {
        return;
      }
      // Une transition ouverte reste attachée au paragraphe d'origine :
      // les déplacements de souris ne doivent ni la fermer ni déplacer sa
      // surbrillance vers un autre paragraphe.
      if (transitionMenuOpen) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest(
          ".ai-popover, .ai-inline-button, .ai-settings-panel, .transition-popover, .transition-inline-button",
        )
      ) {
        return;
      }

      const paragraphFromTarget =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>("p[data-scenario-type]")
          : null;
      const paragraph =
        paragraphFromTarget ?? findAiParagraphAtPoint(editor, clientX, clientY, zoom);
      const type = toScenarioElementType(
        paragraph?.getAttribute("data-scenario-type"),
      );

      if (
        !(paragraph instanceof HTMLElement) ||
        (type !== "ACTION" && type !== "DIALOGUE") ||
        paragraph.dataset.scenarioEnding === "true"
      ) {
        setAiPromptMenuOpen(false);
        if (!aiBusy) {
          setAiTarget(null);
        }
        return;
      }

      const position = findParagraphPosition(editor, paragraph);
      if (position === null) {
        return;
      }

      const rect = paragraph.getBoundingClientRect();
      const canvas = paragraph.closest(".document-canvas");
      const canvasRect = canvas?.getBoundingClientRect();
      if (!canvasRect) {
        return;
      }

      if (aiTarget && aiTarget.position !== position) {
        setAiPromptMenuOpen(false);
      }
      const appShellRect = appShellRef.current?.getBoundingClientRect();
      const paragraphOverlay = clientRectToOverlay(rect, zoom, appShellRect);
      const canvasOverlay = clientRectToOverlay(canvasRect, zoom, appShellRect);
      setAiTarget({
        left: paragraphOverlay.left + paragraphOverlay.width,
        transitionLeft: paragraphOverlay.left + paragraphOverlay.width + 36 * (zoom / 100),
        top: paragraphOverlay.top + paragraphOverlay.height / 2,
        highlightLeft: canvasOverlay.left,
        highlightTop: paragraphOverlay.top,
        highlightWidth: canvasOverlay.width,
        highlightHeight: paragraphOverlay.height,
        position,
        text: paragraph.textContent ?? "",
        type,
      });
    },
    [aiBusy, aiTarget, editor, transitionMenuOpen, zoom],
  );

  useEffect(() => {
    if (!transitionMenuOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".transition-popover, .transition-inline-button")
      ) {
        return;
      }
      setTransitionMenuOpen(false);
      setCustomTransitionOpen(false);
      setCustomTransitionText("");
      setAiTarget(null);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [transitionMenuOpen]);

  // Le bouton et sa bande sont en position fixe. Après un scroll ou un zoom,
  // le paragraphe a bougé sans déclencher mousemove : on le recalcule donc à
  // partir de la dernière position connue du curseur.
  useEffect(() => {
    if (!editor) {
      return;
    }

    const workspace = editor.view.dom.closest<HTMLElement>(".workspace");
    let frame: number | null = null;
    const refreshHoverAfterLayoutChange = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        const pointer = aiPointerPosition.current;
        if (!pointer) {
          return;
        }
        refreshAiTarget(
          document.elementFromPoint(pointer.clientX, pointer.clientY),
          pointer.clientX,
          pointer.clientY,
        );
      });
    };

    workspace?.addEventListener("scroll", refreshHoverAfterLayoutChange, { passive: true });
    window.addEventListener("resize", refreshHoverAfterLayoutChange);
    refreshHoverAfterLayoutChange();
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      workspace?.removeEventListener("scroll", refreshHoverAfterLayoutChange);
      window.removeEventListener("resize", refreshHoverAfterLayoutChange);
    };
  }, [editor, refreshAiTarget, zoom]);

  const createDocument = useCallback(
    (activeEditor: Editor, title: string): ScenarioFile =>
      createScenarioFile(
        activeEditor,
        title,
        coverPageRef.current,
        commentsRef.current,
        coverPageHiddenRef.current,
      ),
    [],
  );

  const persistRecovery = useCallback(
    async (
      activeEditor: Editor,
      title: string,
      filePath: string | null,
      createBackup = false,
    ): Promise<void> => {
      const document = createDocument(activeEditor, title);
      await writeAutosave(serializeRecoveryFile(document, filePath));

      if (createBackup || Date.now() - lastBackupAt.current >= BACKUP_INTERVAL_MS) {
        await writeBackup(JSON.stringify(document, null, 2));
        lastBackupAt.current = Date.now();
      }
    },
    [createDocument],
  );

  const replaceDocument = useCallback(
    (document: ScenarioFile, filePath: string | null) => {
      if (!editor) {
        return;
      }

      isReplacingDocument.current = true;
      smartTypeInteractionStarted.current = false;
      setSmartType(null);
      replaceEditorDocumentWithoutHistory(editor, document.content);
      ensureScenarioBlockIds(editor);
      coverPageRef.current = document.coverPage;
      setCoverPage(document.coverPage);
      setCoverDraft(document.coverPage);
      coverPageHiddenRef.current = document.coverPageHidden;
      setCoverPageHidden(document.coverPageHidden);
      commentsRef.current = document.comments;
      setComments(document.comments);
      setActiveCommentId(null);
      for (const thread of document.comments) {
        addCommentMark(editor, thread.id, thread.anchor);
      }
      setDocumentState({
        filePath,
        title: document.title || getFileTitle(filePath ?? UNTITLED_DOCUMENT),
        isDirty: false,
        status: filePath ? "Document ouvert" : "Récupération automatique restaurée",
      });
      refreshEditorState(editor);
      requestAnimationFrame(() => {
        isReplacingDocument.current = false;
      });
    },
    [editor, refreshEditorState],
  );

  const showError = useCallback(async (error: unknown) => {
    await message(error instanceof Error ? error.message : String(error), {
      title: "Scénario",
      kind: "error",
    });
  }, []);

  const rememberRecentScenario = useCallback(async (path: string) => {
    try {
      setRecentScenarios(await recordRecentScenario(path));
    } catch {
      // Un fichier vient d'être enregistré/ouvert : l'absence de liste récente
      // ne doit jamais faire échouer cette action principale.
    }
  }, []);

  const askToDiscardChanges = useCallback(async (): Promise<boolean> => {
    if (!documentState.isDirty) {
      return true;
    }

    return confirm(
      "Des modifications ne sont pas enregistrées. Continuer sans les enregistrer ?",
      {
        title: "Scénario",
        kind: "warning",
        okLabel: "Continuer",
        cancelLabel: "Annuler",
      },
    );
  }, [documentState.isDirty]);

  const saveDocument = useCallback(
    async (saveAs = false) => {
      if (!editor) {
        return;
      }

      let path = documentState.filePath;
      if (saveAs || !path) {
        path = await chooseScenarioToSave(documentState.title);
      }
      if (!path) {
        return;
      }

      try {
        const title = getFileTitle(path);
        const document = createDocument(editor, title);
        const contents = JSON.stringify(document, null, 2);
        await writeScenario(path, contents);
        await rememberRecentScenario(path);
        let recoveryAvailable = true;
        try {
          await persistRecovery(editor, title, path, true);
        } catch {
          recoveryAvailable = false;
        }
        setDocumentState({
          filePath: path,
          title,
          isDirty: false,
          status: recoveryAvailable
            ? "Enregistré"
            : "Enregistré (sauvegarde de secours indisponible)",
        });
      } catch (error) {
        await showError(error);
      }
    },
    [
      createDocument,
      documentState.filePath,
      documentState.title,
      editor,
      rememberRecentScenario,
      persistRecovery,
      showError,
    ],
  );

  const rememberCustomPdfLanguage = useCallback((value: string): string => {
    const language = normalizePdfLanguage(value);
    if (!language || language.length > 60) {
      return "";
    }

    setCustomPdfLanguages((previous) => {
      const existing = previous.find(
        (candidate) => candidate.toLocaleLowerCase("fr-FR") === language.toLocaleLowerCase("fr-FR"),
      );
      const next = existing ? previous : [...previous, language];
      writeLocalSetting(PDF_CUSTOM_LANGUAGES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    return language;
  }, []);

  const addCustomPdfLanguage = useCallback(() => {
    const language = rememberCustomPdfLanguage(pdfExportDraft.customTranslationLanguage);
    if (!language) {
      return;
    }
    setPdfExportDraft((draft) => ({
      ...draft,
      translationLanguage: language,
      customTranslationLanguage: "",
    }));
  }, [pdfExportDraft.customTranslationLanguage, rememberCustomPdfLanguage]);

  const removeCustomPdfLanguage = useCallback((language: string) => {
    setCustomPdfLanguages((previous) => {
      const next = previous.filter((candidate) => candidate !== language);
      writeLocalSetting(PDF_CUSTOM_LANGUAGES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setPdfExportDraft((draft) =>
      draft.translationLanguage === language
        ? { ...draft, translationLanguage: "" }
        : draft,
    );
  }, []);

  const openPdfExport = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setPdfExportDraft({
      includeCoverPage: hasCoverPageContent(coverPage),
      includeSceneNumbers: true,
      includePageNumbers: true,
      translationLanguage: "",
      customTranslationLanguage: "",
    });
    setPdfExportOpen(true);
  }, [coverPage]);

  const exportPdf = useCallback(async () => {
    if (!editor) {
      return;
    }

    try {
      const selectedTranslationLanguage = pdfExportDraft.translationLanguage;
      const translationLanguage = selectedTranslationLanguage === "__custom__"
        ? pdfExportDraft.customTranslationLanguage.trim()
        : selectedTranslationLanguage;
      if (selectedTranslationLanguage === "__custom__" && !translationLanguage) {
        throw new Error("Indique la langue dans laquelle traduire le scénario.");
      }
      if (selectedTranslationLanguage === "__custom__") {
        rememberCustomPdfLanguage(translationLanguage);
      }

      const path = await choosePdfToSave(documentState.title);
      if (!path) {
        return;
      }
      let document = createDocument(editor, documentState.title);
      if (translationLanguage) {
        setPdfExportBusy(true);
        const translation = createPdfTranslationSegments(document.content);
        const translatedTexts = await translateScenario(
          translationLanguage,
          translation.segments,
        );
        document = {
          ...document,
          content: applyPdfTranslations(document.content, translation.positions, translatedTexts),
        };
      }
      const { createScenarioPdf } = await import("./document/pdfExport");
      await writePdf(path, await createScenarioPdf(document, pdfExportDraft));
      setPdfExportOpen(false);
      setDocumentState((previous) => ({
        ...previous,
        status: translationLanguage ? "PDF traduit et exporté" : "PDF exporté",
      }));
    } catch (error) {
      await showError(error);
    } finally {
      setPdfExportBusy(false);
    }
  }, [createDocument, documentState.title, editor, pdfExportDraft, rememberCustomPdfLanguage, showError]);

  const openFindReplace = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setFindReplaceOpen(true);
    setFindMatchIndex(-1);
    setFindMatchTotal(findTextMatches(editor!, findQuery, findMatchCase).length);
    requestAnimationFrame(() => findInput.current?.focus());
  }, [editor, findMatchCase, findQuery]);

  const selectFindMatch = useCallback((matches: TextMatch[], index: number) => {
    if (!editor || matches.length === 0) {
      return;
    }
    const match = matches[index];
    editor.chain().focus().setTextSelection(match).scrollIntoView().run();
    setFindMatchIndex(index);
    setFindMatchTotal(matches.length);
  }, [editor]);

  const moveFindMatch = useCallback((direction: 1 | -1) => {
    if (!editor || !findQuery) {
      setFindMatchIndex(-1);
      setFindMatchTotal(0);
      return;
    }
    const matches = findTextMatches(editor, findQuery, findMatchCase);
    if (matches.length === 0) {
      setFindMatchIndex(-1);
      setFindMatchTotal(0);
      return;
    }
    const index =
      findMatchIndex === -1
        ? direction === 1 ? 0 : matches.length - 1
        : (findMatchIndex + direction + matches.length) % matches.length;
    selectFindMatch(matches, index);
  }, [editor, findMatchCase, findMatchIndex, findQuery, selectFindMatch]);

  const replaceCurrentMatch = useCallback(() => {
    if (!editor || !findQuery) {
      return;
    }
    const matches = findTextMatches(editor, findQuery, findMatchCase);
    if (matches.length === 0) {
      setFindMatchIndex(-1);
      setFindMatchTotal(0);
      return;
    }
    const index = findMatchIndex >= 0 ? Math.min(findMatchIndex, matches.length - 1) : 0;
    const match = matches[index];
    editor.view.dispatch(editor.state.tr.insertText(replaceQuery, match.from, match.to));
    refreshEditorState(editor);
    setDocumentState((previous) => ({ ...previous, isDirty: true, status: "Texte remplacé" }));
    const remaining = findTextMatches(editor, findQuery, findMatchCase);
    if (remaining.length > 0) {
      selectFindMatch(remaining, Math.min(index, remaining.length - 1));
    } else {
      setFindMatchIndex(-1);
      setFindMatchTotal(0);
    }
  }, [editor, findMatchCase, findMatchIndex, findQuery, refreshEditorState, replaceQuery, selectFindMatch]);

  const replaceAllMatches = useCallback(() => {
    if (!editor || !findQuery) {
      return;
    }
    const matches = findTextMatches(editor, findQuery, findMatchCase);
    if (matches.length === 0) {
      setFindMatchIndex(-1);
      setFindMatchTotal(0);
      return;
    }
    let transaction = editor.state.tr;
    for (const match of [...matches].reverse()) {
      transaction = transaction.insertText(replaceQuery, match.from, match.to);
    }
    editor.view.dispatch(transaction);
    refreshEditorState(editor);
    setFindMatchIndex(-1);
    setFindMatchTotal(findTextMatches(editor, findQuery, findMatchCase).length);
    setDocumentState((previous) => ({
      ...previous,
      isDirty: true,
      status: `${matches.length} remplacement${matches.length > 1 ? "s" : ""} effectué${matches.length > 1 ? "s" : ""}`,
    }));
  }, [editor, findMatchCase, findQuery, refreshEditorState, replaceQuery]);

  const openCommentComposer = useCallback(async () => {
    if (!editor) {
      return;
    }
    // Les anciens projets n'avaient pas encore d'identifiant de bloc.
    // On les crée juste avant la première annotation si nécessaire.
    ensureScenarioBlockIds(editor);
    const anchor = getSelectionCommentAnchor(editor);
    if (!anchor) {
      await message("Sélectionne une portion de texte dans un seul paragraphe avant d’ajouter un commentaire.", {
        title: "Commentaires",
        kind: "info",
      });
      return;
    }
    setCommentAnchor(anchor);
    setCommentDraft("");
    setCommentComposerOpen(true);
    requestAnimationFrame(() => commentInput.current?.focus());
  }, [editor]);

  const saveNewComment = useCallback(() => {
    if (!commentAnchor || !commentDraft.trim()) {
      return;
    }
    const createdAt = new Date().toISOString();
    const thread: CommentThread = {
      id: createStableId("thread"),
      status: "open",
      createdAt,
      resolvedAt: null,
      anchor: commentAnchor,
      messages: [{ id: createStableId("message"), text: commentDraft.trim(), createdAt, editedAt: null }],
    };
    if (editor) {
      addCommentMark(editor, thread.id, thread.anchor);
    }
    setComments((previous) => [...previous, thread]);
    setActiveCommentId(thread.id);
    setCommentComposerOpen(false);
    setCommentAnchor(null);
    setDocumentState((previous) => ({ ...previous, isDirty: true, status: "Commentaire ajouté" }));
  }, [commentAnchor, commentDraft, editor]);

  const updateCommentThread = useCallback((threadId: string, update: (thread: CommentThread) => CommentThread) => {
    setComments((previous) => previous.map((thread) => thread.id === threadId ? update(thread) : thread));
    setDocumentState((previous) => ({ ...previous, isDirty: true, status: "Commentaires modifiés" }));
  }, []);

  const navigateToComment = useCallback((thread: CommentThread) => {
    if (!editor) {
      return;
    }
    const position = findCommentAnchorPosition(editor, thread.anchor);
    if (!position) {
      setActiveCommentId(thread.id);
      return;
    }
    editor.chain().focus().setTextSelection(position).scrollIntoView().run();
    setActiveCommentId(thread.id);
  }, [editor]);

  const deleteCommentThread = useCallback(async (threadId: string) => {
    const shouldDelete = await confirm("Supprimer ce commentaire et toutes ses réponses ?", {
      title: "Commentaires",
      kind: "warning",
      okLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (!shouldDelete) {
      return;
    }
    const thread = commentsRef.current.find((item) => item.id === threadId);
    if (editor && thread) {
      removeCommentMark(editor, threadId, thread.anchor);
    }
    setComments((previous) => previous.filter((thread) => thread.id !== threadId));
    setActiveCommentId((previous) => previous === threadId ? null : previous);
    setDocumentState((previous) => ({ ...previous, isDirty: true, status: "Commentaire supprimé" }));
  }, [editor]);

  const saveEditedComment = useCallback(() => {
    if (!editingCommentId || !editingCommentText.trim()) {
      return;
    }
    updateCommentThread(editingCommentId, (thread) => ({
      ...thread,
      messages: thread.messages.length === 0 ? [] : [{
        ...thread.messages[0],
        text: editingCommentText.trim(),
        editedAt: new Date().toISOString(),
      }],
    }));
    setEditingCommentId(null);
    setEditingCommentText("");
  }, [editingCommentId, editingCommentText, updateCommentThread]);

  const openAiSettings = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setAiSettingsOpen(true);
    setAiHelpOpen(false);
    setAiMissingKeyNoticeOpen(!aiConfig.hasApiKey);
    setAiDraft({
      apiKey: "",
      model: aiConfig.model,
      prompts: aiConfig.prompts,
    });
    setSelectedAiPromptId(aiConfig.prompts[0]?.id ?? null);
  }, [aiConfig]);

  const openHelp = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setHelpOpen(true);
  }, []);

  const toggleCoverMenu = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen((isOpen) => {
      if (!isOpen) {
        setCoverDraft(coverPage);
      }
      return !isOpen;
    });
  }, [coverPage]);

  const toggleFileMenu = useCallback(() => {
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setFileMenuOpen((isOpen) => !isOpen);
  }, []);

  const toggleViewMenu = useCallback(() => {
    setFileMenuOpen(false);
    setCoverMenuOpen(false);
    setViewMenuOpen((isOpen) => !isOpen);
  }, []);

  const closeTopMenus = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
  }, []);

  const addScenarioEnding = useCallback(() => {
    if (!editor || scenarioHasEnding(editor)) {
      return;
    }

    const { state, view } = editor;
    const ending = editor.schema.nodes.paragraph.create(
      { scenarioType: "ACTION", ending: true },
      editor.schema.text("FIN"),
    );
    const position = state.doc.content.size;
    const transaction = state.tr.insert(position, ending);
    transaction.setSelection(TextSelection.create(transaction.doc, position + 2));
    view.dispatch(transaction.scrollIntoView());
    setScenarioContextMenu(null);
    setDocumentState((previous) => ({
      ...previous,
      isDirty: true,
      status: "FIN ajouté",
    }));
  }, [editor]);

  const removeScenarioEnding = useCallback(() => {
    if (!editor) {
      return;
    }

    const { state, view } = editor;
    const endingPosition = findScenarioEndingPosition(state.doc);
    const ending = endingPosition === null ? null : state.doc.nodeAt(endingPosition);
    if (!ending || endingPosition === null) {
      return;
    }

    const transaction = state.tr.delete(endingPosition, endingPosition + ending.nodeSize);
    transaction.setSelection(TextSelection.create(transaction.doc, Math.max(1, endingPosition)));
    view.dispatch(transaction.scrollIntoView());
    setScenarioContextMenu(null);
    setDocumentState((previous) => ({
      ...previous,
      isDirty: true,
      status: "FIN retiré",
    }));
  }, [editor]);

  const openScenarioContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest(".document-canvas")) {
      return;
    }
    event.preventDefault();
    const overlay = clientPointToOverlay(
      event.clientX,
      event.clientY,
      zoom,
      appShellRef.current?.getBoundingClientRect(),
    );
    setScenarioContextMenu({ left: overlay.left, top: overlay.top });
  }, [zoom]);

  const updateCoverDraft = useCallback(
    (field: keyof CoverPageData, value: string) => {
      setCoverDraft((previous) => {
        const next = { ...previous, [field]: value };
        // La page de garde est enregistrée avec le projet à chaque modification.
        // Le bouton « Appliquer » ne sert plus qu'à fermer ce petit panneau.
        coverPageRef.current = next;
        setCoverPage(next);
        return next;
      });
      setDocumentState((previous) => ({
        ...previous,
        isDirty: true,
        status: "Page de garde mise à jour",
      }));
    },
    [],
  );

  const saveCoverPage = useCallback(() => {
    const normalizedCoverPage = normalizeCoverPage(coverDraft);
    coverPageRef.current = normalizedCoverPage;
    setCoverPage(normalizedCoverPage);
    setCoverDraft(normalizedCoverPage);
    setCoverMenuOpen(false);
    setDocumentState((previous) => ({
      ...previous,
      isDirty: true,
      status: "Page de garde mise à jour",
    }));
  }, [coverDraft]);

  const toggleCoverPageHidden = useCallback((hidden: boolean) => {
    coverPageHiddenRef.current = hidden;
    setCoverPageHidden(hidden);
    setDocumentState((previous) => ({
      ...previous,
      isDirty: true,
      status: hidden ? "Page de garde masquée" : "Page de garde affichée",
    }));
  }, []);

  const saveAiSettings = useCallback(async () => {
    try {
      const savedConfig = await writeAiConfig({
        model: aiDraft.model,
        prompts: aiDraft.prompts,
        apiKey: aiDraft.apiKey.trim() || undefined,
      });
      setAiConfig(savedConfig);
      setAiMissingKeyNoticeOpen(false);
      setAiSettingsOpen(false);
      setDocumentState((previous) => ({
        ...previous,
        status: "Réglages IA enregistrés",
      }));
    } catch (error) {
      await showError(error);
    }
  }, [aiDraft, showError]);

  const updateAiPrompt = useCallback(
    (id: string, field: keyof Pick<AiPrompt, "name" | "instruction">, value: string) => {
      setAiDraft((previous) => ({
        ...previous,
        prompts: previous.prompts.map((prompt) =>
          prompt.id === id ? { ...prompt, [field]: value } : prompt,
        ),
      }));
    },
    [],
  );

  const setAiPromptResponseOnly = useCallback((id: string, responseOnly: boolean) => {
    setAiDraft((previous) => ({
      ...previous,
      prompts: previous.prompts.map((prompt) =>
        prompt.id === id ? { ...prompt, responseOnly } : prompt,
      ),
    }));
  }, []);

  const addAiPrompt = useCallback(() => {
    const newPrompt: AiPrompt = {
      id: `prompt-${Date.now()}`,
      name: "Nouveau prompt",
      instruction: "Réécris ce texte en respectant le style du scénario.",
      responseOnly: true,
    };
    setAiDraft((previous) => ({
      ...previous,
      prompts: [...previous.prompts, newPrompt],
    }));
    setSelectedAiPromptId(newPrompt.id);
  }, []);

  const removeAiPrompt = useCallback((id: string) => {
    const remainingPrompts = aiDraft.prompts.filter((prompt) => prompt.id !== id);
    if (remainingPrompts.length === 0) {
      return;
    }
    setAiDraft((previous) => ({
      ...previous,
      prompts: previous.prompts.filter((prompt) => prompt.id !== id),
    }));
    if (selectedAiPromptId === id) {
      setSelectedAiPromptId(remainingPrompts[0].id);
    }
  }, [aiDraft.prompts, selectedAiPromptId]);

  const applyAiPrompt = useCallback(
    async (prompt: AiPrompt) => {
      if (!editor || !aiTarget) {
        return;
      }

      const paragraphText = aiTarget.text.trim();
      if (!paragraphText) {
        await message("Ce paragraphe est vide.", {
          title: "IA",
          kind: "info",
        });
        return;
      }

      setAiBusy(true);
      setAiPromptMenuOpen(false);
      setDocumentState((previous) => ({
        ...previous,
        status: "IA en cours...",
      }));

      try {
        const result = await runAiPrompt(buildAiPromptInstruction(prompt), paragraphText);
        if (replaceParagraphText(editor, aiTarget.position, result)) {
          setDocumentState((previous) => ({
            ...previous,
            isDirty: true,
            status: "Paragraphe remplacé par l'IA",
          }));
          refreshEditorState(editor);
        }
      } catch (error) {
        await showError(error);
      } finally {
        setAiBusy(false);
        setAiTarget(null);
      }
    },
    [aiTarget, editor, refreshEditorState, showError],
  );

  const insertTransition = useCallback(
    (value: string) => {
      if (!editor || !aiTarget) {
        return;
      }

      const normalized = value.trim().replace(/\s+/g, " ");
      if (!normalized) {
        return;
      }

      const text = normalized.toLocaleUpperCase("fr-FR").endsWith(":")
        ? normalized.toLocaleUpperCase("fr-FR")
        : `${normalized.toLocaleUpperCase("fr-FR")}:`;
      if (insertScenarioParagraphAfterPosition(editor, aiTarget.position, "TRANSITION", text)) {
        setDocumentState((previous) => ({
          ...previous,
          isDirty: true,
          status: "Transition ajoutée",
        }));
        refreshEditorState(editor);
      }
      setTransitionMenuOpen(false);
      setCustomTransitionOpen(false);
      setCustomTransitionText("");
    },
    [aiTarget, editor, refreshEditorState],
  );

  const toggleTheme = useCallback(() => {
    setTheme((previous) => (previous === "light" ? "dark" : "light"));
  }, []);

  const changeZoom = useCallback((amount: number) => {
    setZoom((previous) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, previous + amount)),
    );
  }, []);

  const resetZoom = useCallback(() => setZoom(100), []);

  const handleWorkspaceWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    },
    [changeZoom],
  );

  const createNewDocument = useCallback(async () => {
    if (!editor || !(await askToDiscardChanges())) {
      return;
    }

    isReplacingDocument.current = true;
    smartTypeInteractionStarted.current = false;
    setSmartType(null);
    replaceEditorDocumentWithoutHistory(editor, initialContent);
    ensureScenarioBlockIds(editor);
    const blankCoverPage = createEmptyCoverPage();
    coverPageRef.current = blankCoverPage;
    setCoverPage(blankCoverPage);
    setCoverDraft(blankCoverPage);
    coverPageHiddenRef.current = false;
    setCoverPageHidden(false);
    commentsRef.current = [];
    setComments([]);
    setActiveCommentId(null);
    const blankDocument = createScenarioFile(editor, UNTITLED_DOCUMENT, blankCoverPage);
    setDocumentState({
      filePath: null,
      title: UNTITLED_DOCUMENT,
      isDirty: false,
      status: "Nouveau document",
    });
    refreshEditorState(editor);
    requestAnimationFrame(() => {
      isReplacingDocument.current = false;
    });

    try {
      await writeAutosave(serializeRecoveryFile(blankDocument, null));
    } catch (error) {
      setDocumentState((previous) => ({ ...previous, status: "Autosave indisponible" }));
    }
  }, [askToDiscardChanges, createDocument, editor, refreshEditorState]);

  const openDocumentAtPath = useCallback(async (path: string) => {
    if (!editor || !(await askToDiscardChanges())) {
      return;
    }

    try {
      const document = parseScenarioFile(await readScenario(path));
      replaceDocument(document, path);
      await rememberRecentScenario(path);
      try {
        await persistRecovery(editor, document.title, path);
      } catch {
        setDocumentState((previous) => ({
          ...previous,
          status: "Document ouvert (autosave indisponible)",
        }));
      }
    } catch (error) {
      await showError(error);
    }
  }, [askToDiscardChanges, editor, persistRecovery, rememberRecentScenario, replaceDocument, showError]);

  const openDocument = useCallback(async () => {
    const path = await chooseScenarioToOpen();
    if (path) {
      await openDocumentAtPath(path);
    }
  }, [openDocumentAtPath]);

  const openPdfDocument = useCallback(async () => {
    setFileMenuOpen(false);
    setPdfImportError("");
    setPdfImportOpen(true);
  }, []);

  const selectPdfForImport = useCallback(async () => {
    const path = await choosePdfToOpen();
    if (path) setPdfImportPath(path);
  }, []);

  const importSelectedPdf = useCallback(async () => {
    if (!editor || !(await askToDiscardChanges()) || !pdfImportPath) return;
    setPdfImportBusy(true);
    setPdfImportError("");
    try {
      const rawText = await extractPdfText(pdfImportPath);
      const response = await runAiPrompt(PDF_TO_SCENARIO_PROMPT, rawText);
      const cleanedResponse = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      const firstBrace = cleanedResponse.indexOf("{");
      const lastBrace = cleanedResponse.lastIndexOf("}");
      const jsonResponse = firstBrace >= 0 && lastBrace > firstBrace
        ? cleanedResponse.slice(firstBrace, lastBrace + 1)
        : cleanedResponse;
      const title = getFileTitle(pdfImportPath);
      const importedDocument = parseAiScenarioResponse(jsonResponse, title);
      replaceDocument({ ...importedDocument, title }, null);
      setDocumentState((previous) => ({ ...previous, title, isDirty: true, status: "PDF importé par l’IA — enregistre le scénario" }));
      setPdfImportOpen(false);
      setPdfImportPath(null);
    } catch (error) {
      setPdfImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setPdfImportBusy(false);
    }
  }, [askToDiscardChanges, editor, pdfImportPath, replaceDocument]);

  useEffect(() => {
    if (!editor || recoveryWasChecked.current) {
      return;
    }
    recoveryWasChecked.current = true;

    void readRecovery()
      .then(async (contents) => {
        if (!contents) {
          return;
        }

        const recovery = parseRecoveryFile(contents);
        let documentToRestore = recovery.document;

        // Un projet connu doit toujours être rouvert depuis son vrai fichier
        // .scenario. La récupération ne sert que si ce fichier a disparu ou
        // pour un nouveau document qui n'a encore jamais été enregistré.
        if (recovery.filePath) {
          try {
            documentToRestore = parseScenarioFile(await readScenario(recovery.filePath));
          } catch {
            // Le fichier peut avoir été déplacé ou supprimé : l'autosave reste
            // alors le meilleur moyen de restaurer le travail de l'auteur.
          }
        }

        replaceDocument(documentToRestore, recovery.filePath);
      })
      .catch(() => {
        setDocumentState((previous) => ({
          ...previous,
          status: "Nouvelle session",
        }));
      })
      .finally(() => setInitialRecoveryFinished(true));
  }, [editor, replaceDocument]);

  useEffect(() => {
    if (!editor || !initialRecoveryFinished || launchedScenarioWasChecked.current) {
      return;
    }
    launchedScenarioWasChecked.current = true;

    void invoke<string | null>("launched_scenario_path")
      .then((path) => {
        if (path) {
          return openDocumentAtPath(path);
        }
        return undefined;
      })
      .catch(() => {
        // L'application peut toujours démarrer normalement sans argument.
      });
  }, [editor, initialRecoveryFinished, openDocumentAtPath]);

  useEffect(() => {
    void readAiConfig()
      .then((config) => {
        setAiConfig(config);
        setAiDraft({
          apiKey: "",
          model: config.model,
          prompts: config.prompts,
        });
      })
      .catch(() => {
        const defaultConfig = createDefaultAiConfig();
        setAiConfig(defaultConfig);
        setAiDraft({
          apiKey: "",
          model: defaultConfig.model,
          prompts: defaultConfig.prompts,
        });
      });
  }, []);

  useEffect(() => {
    if (!editor || !documentState.isDirty) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void persistRecovery(editor, documentState.title, documentState.filePath)
        .then(() => {
          setDocumentState((previous) => ({
            ...previous,
            status: "Sauvegarde automatique effectuée",
          }));
        })
        .catch(() => {
          setDocumentState((previous) => ({
            ...previous,
            status: "Autosave indisponible",
          }));
        });
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [
    documentState.filePath,
    documentState.isDirty,
    documentState.title,
    editor,
    persistRecovery,
  ]);

  useEffect(() => {
    writeLocalSetting("scenario-theme", theme);
    writeLocalSetting("scenario-zoom", String(zoom));
  }, [theme, zoom]);

  useEffect(() => {
    if (editor) {
      refreshPagination(editor);
    }
  }, [editor, refreshPagination, zoom]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const repaginate = () => refreshPagination(editor);
    window.addEventListener("resize", repaginate);
    repaginate();

    return () => {
      window.removeEventListener("resize", repaginate);
      if (paginationFrame.current !== null) {
        cancelAnimationFrame(paginationFrame.current);
      }
    };
  }, [editor, refreshPagination]);

  useEffect(() => {
    const closeMenusOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".file-menu-container")) {
        closeTopMenus();
      }
      if (!(target instanceof Element) || !target.closest(".scenario-context-menu")) {
        setScenarioContextMenu(null);
      }
    };

    document.addEventListener("mousedown", closeMenusOutside);
    return () => document.removeEventListener("mousedown", closeMenusOutside);
  }, [closeTopMenus]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    let unlisten: (() => void) | undefined;
    void listen("scenario-close-requested", async () => {
          if (closeInProgress.current) {
            return;
          }

          closeInProgress.current = true;
          let saveBeforeClosing: boolean;
          try {
            saveBeforeClosing = await confirm(
              "Voulez-vous enregistrer le projet avant de quitter ?",
              {
                title: "Scénario",
                kind: "warning",
                okLabel: "Oui, enregistrer",
                cancelLabel: "Non, quitter",
              },
            );
          } catch {
            closeInProgress.current = false;
            return;
          }

          if (saveBeforeClosing) {
            const latestDocument = currentDocumentState.current;
            let path = latestDocument.filePath;
            if (!path) {
              path = await chooseScenarioToSave(latestDocument.title);
            }

            // Annuler la boîte « Enregistrer sous » signifie que l'auteur ne
            // souhaite finalement pas fermer l'application.
            if (!path) {
              closeInProgress.current = false;
              return;
            }

            try {
              const title = getFileTitle(path);
              const document = createDocument(editor, title);
              await writeScenario(path, JSON.stringify(document, null, 2));
              await rememberRecentScenario(path);
              try {
                await persistRecovery(editor, title, path, true);
              } catch {
                // Le fichier .scenario est déjà enregistré : une panne de la
                // sauvegarde secondaire ne doit pas empêcher la fermeture.
              }
              setDocumentState({
                filePath: path,
                title,
                isDirty: false,
                status: "Enregistré",
              });
            } catch (error) {
              await showError(error);
              closeInProgress.current = false;
              return;
            }
          } else if (currentDocumentState.current.filePath === null) {
            // « Non, quitter » doit réellement abandonner un brouillon sans
            // fichier, au lieu de le restaurer silencieusement au prochain lancement.
            try {
              await clearRecovery();
            } catch (error) {
              await showError(error);
              closeInProgress.current = false;
              return;
            }
          }

          try {
            await invoke("close_after_confirmation");
          } catch {
            closeInProgress.current = false;
          }
        })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // L'aperçu web n'émet pas l'événement de fermeture Tauri.
      });

    return () => unlisten?.();
  }, [createDocument, editor, persistRecovery, rememberRecentScenario, showError]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLocaleLowerCase("fr-FR") === "m") {
        event.preventDefault();
        void openCommentComposer();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const key = event.key.toLocaleLowerCase("fr-FR");
      if (key === "n") {
        event.preventDefault();
        void createNewDocument();
      }
      if (key === "o") {
        event.preventDefault();
        void openDocument();
      }
      if (key === "f" || key === "h") {
        event.preventDefault();
        openFindReplace();
      }
      if (key === "s") {
        event.preventDefault();
        void saveDocument(event.shiftKey);
      }
      if (key === "e" && event.shiftKey) {
        event.preventDefault();
        openPdfExport();
      }
      if (key === "d" && event.shiftKey) {
        event.preventDefault();
        toggleTheme();
      }
      if (key === "+" || key === "=") {
        event.preventDefault();
        changeZoom(ZOOM_STEP);
      }
      if (key === "-") {
        event.preventDefault();
        changeZoom(-ZOOM_STEP);
      }
      if (key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    changeZoom,
    createNewDocument,
    openPdfExport,
    openFindReplace,
    openDocument,
    openCommentComposer,
    resetZoom,
    saveDocument,
    toggleTheme,
  ]);

  const acceptSuggestion = useCallback(
    (index: number) => {
      if (!editor || !smartType) {
        return;
      }

      const suggestion = smartType.items[index];
      if (suggestion) {
        acceptSmartTypeSuggestion(editor, smartType.kind, suggestion);
      }
    },
    [editor, smartType],
  );

  const selectSmartTypeSuggestion = useCallback((index: number) => {
    if (editor) {
      setSmartTypeSelection(editor, index);
    }
  }, [editor]);

  const runFileAction = useCallback((action: () => Promise<void>) => {
    setFileMenuOpen(false);
    void action();
  }, []);

  const runViewAction = useCallback((action: () => void) => {
    setViewMenuOpen(false);
    action();
  }, []);

  const openTextReplacements = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    const replacements =
      textReplacements.length > 0
        ? textReplacements
        : createDefaultTextReplacements();
    if (textReplacements.length === 0) {
      setTextReplacements(replacements);
    }
    setTextReplacementDrafts(replacements);
    setTextReplacementError("");
    setTextReplacementQuery("");
    setTextReplacementsOpen(true);
  }, [textReplacements]);

  const updateTextReplacement = useCallback(
    (id: string, field: "shortcut" | "replacement", value: string) => {
      setTextReplacementDrafts((previous) =>
        previous.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
      );
      setTextReplacementError("");
    },
    [],
  );

  const addTextReplacement = useCallback(() => {
    setTextReplacementDrafts((previous) => [
      { id: `shortcut-${Date.now()}`, shortcut: "", replacement: "" },
      ...previous,
    ]);
    setTextReplacementQuery("");
  }, []);

  const removeTextReplacement = useCallback((id: string) => {
    setTextReplacementDrafts((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const saveTextReplacements = useCallback(() => {
    if (hasDuplicateTextReplacementShortcut(textReplacementDrafts)) {
      setTextReplacementError("Ce raccourci existe déjà. Choisis une autre forme raccourcie.");
      return;
    }
    setTextReplacements(normalizeTextReplacements(textReplacementDrafts));
    setTextReplacementsOpen(false);
    setDocumentState((previous) => ({
      ...previous,
      status: "Raccourcis enregistrés",
    }));
  }, [textReplacementDrafts]);

  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const toggleUnderline = useCallback(() => {
    editor?.chain().focus().toggleUnderline().run();
  }, [editor]);

  const coverPagePresent = hasCoverPageContent(coverPage);
  const coverPageVisible = coverPagePresent && !coverPageHidden;
  const documentSheetCount = pageCount + (coverPageVisible ? 1 : 0);
  // Feuille purement visuelle, toujours après le scénario : elle apporte de
  // l'espace de scroll sous la dernière page sans faire partie du document.
  const canvasSheetCount = documentSheetCount + 1;
  const coverCredits = getCoverCredits(coverPage);
  const normalizedTextReplacementQuery = textReplacementQuery.trim().toLocaleLowerCase();
  const visibleTextReplacementDrafts = normalizedTextReplacementQuery
    ? textReplacementDrafts.filter((item) =>
        item.shortcut.toLocaleLowerCase().includes(normalizedTextReplacementQuery) ||
        item.replacement.toLocaleLowerCase().includes(normalizedTextReplacementQuery),
      )
    : textReplacementDrafts;

  return (
    <div ref={appShellRef} className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      <header className="menu-bar">
        <nav aria-label="Menu principal">
          <div className="file-menu-container">
            <button
              className="menu-button"
              type="button"
              aria-expanded={fileMenuOpen}
              onClick={toggleFileMenu}
            >
              Fichier
            </button>
            {fileMenuOpen && (
              <div className="file-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => runFileAction(createNewDocument)}>
                  Nouveau <kbd>Ctrl+N</kbd>
                </button>
                <button type="button" role="menuitem" onClick={() => runFileAction(openDocument)}>
                  Ouvrir… <kbd>Ctrl+O</kbd>
                </button>
                <hr />
                <button type="button" role="menuitem" onClick={() => runFileAction(() => saveDocument())}>
                  Enregistrer <kbd>Ctrl+S</kbd>
                </button>
                <button type="button" role="menuitem" onClick={() => runFileAction(() => saveDocument(true))}>
                  Enregistrer sous… <kbd>Ctrl+Maj+S</kbd>
                </button>
                <hr />
                <button type="button" role="menuitem" onClick={openPdfExport}>
                  Exporter en PDF… <kbd>Ctrl+Maj+E</kbd>
                </button>
                <button type="button" role="menuitem" onClick={() => runFileAction(openPdfDocument)}>
                  Importer un PDF…
                </button>
                {recentScenarios.length > 0 && (
                  <>
                    <hr />
                    <p className="recent-scenarios-heading">Projets récents</p>
                    {recentScenarios.map((recent) => (
                      <button
                        key={recent.path}
                        type="button"
                        role="menuitem"
                        title={recent.path}
                        onClick={() => runFileAction(() => openDocumentAtPath(recent.path))}
                      >
                        <span className="recent-scenario-title">{recent.title}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="file-menu-container">
            <button className="menu-button" type="button" onClick={openFindReplace}>
              Rechercher
            </button>
          </div>
          <div className="file-menu-container">
            <button
              className="menu-button"
              type="button"
              aria-expanded={textReplacementsOpen}
              onClick={openTextReplacements}
            >
              Raccourcis
            </button>
          </div>
          <div className="file-menu-container">
            <button
              className="menu-button"
              type="button"
              aria-expanded={coverMenuOpen}
              onClick={toggleCoverMenu}
            >
              Page de garde
            </button>
            {coverMenuOpen && (
              <form
                className="file-menu cover-menu"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveCoverPage();
                }}
              >
                <h2>Page de garde</h2>
                <label>
                  Nom du projet
                  <input
                    autoFocus
                    value={coverDraft.projectName}
                    onChange={(event) => updateCoverDraft("projectName", event.target.value)}
                  />
                </label>
                <div className="cover-menu-grid">
                  <label>
                    Scénariste
                    <input value={coverDraft.screenwriter} onChange={(event) => updateCoverDraft("screenwriter", event.target.value)} />
                  </label>
                  <label>
                    Réalisateur
                    <input value={coverDraft.director} onChange={(event) => updateCoverDraft("director", event.target.value)} />
                  </label>
                  <label>
                    Production
                    <input value={coverDraft.production} onChange={(event) => updateCoverDraft("production", event.target.value)} />
                  </label>
                  <label>
                    Durée
                    <input placeholder="ex. 1 h 30" value={coverDraft.duration} onChange={(event) => updateCoverDraft("duration", event.target.value)} />
                  </label>
                  <label>
                    Version
                    <input value={coverDraft.version} onChange={(event) => updateCoverDraft("version", event.target.value)} />
                  </label>
                  <label>
                    Date
                    <input value={coverDraft.date} onChange={(event) => updateCoverDraft("date", event.target.value)} />
                  </label>
                  <label>
                    Droits
                    <input value={coverDraft.rights} onChange={(event) => updateCoverDraft("rights", event.target.value)} />
                  </label>
                </div>
                <h3>Contact</h3>
                <label>
                  Nom et prénom
                  <input value={coverDraft.contactName} onChange={(event) => updateCoverDraft("contactName", event.target.value)} />
                </label>
                <div className="cover-menu-grid">
                  <label>
                    Mail
                    <input type="email" value={coverDraft.contactEmail} onChange={(event) => updateCoverDraft("contactEmail", event.target.value)} />
                  </label>
                  <label>
                    Téléphone
                    <input type="tel" value={coverDraft.contactPhone} onChange={(event) => updateCoverDraft("contactPhone", event.target.value)} />
                  </label>
                </div>
                <label>
                  Site internet
                  <input value={coverDraft.contactWebsite} onChange={(event) => updateCoverDraft("contactWebsite", event.target.value)} />
                </label>
                <label className="cover-visibility-toggle">
                  <input
                    type="checkbox"
                    checked={coverPageHidden}
                    onChange={(event) => toggleCoverPageHidden(event.target.checked)}
                  />
                  <span>
                    Masquer
                    <small>Masque la page de garde dans l’éditeur uniquement.</small>
                  </span>
                </label>
                <footer>
                  <button type="button" onClick={() => setCoverMenuOpen(false)}>Fermer</button>
                  <button className="primary-button" type="submit">Appliquer</button>
                </footer>
              </form>
            )}
          </div>
          <div className="file-menu-container">
            <button
              className="menu-button"
              type="button"
              aria-expanded={viewMenuOpen}
              onClick={toggleViewMenu}
            >
              Affichage
            </button>
            {viewMenuOpen && (
              <div className="file-menu view-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => runViewAction(toggleTheme)}>
                  {theme === "dark" ? "Mode clair" : "Mode sombre"} <kbd>Ctrl+Maj+D</kbd>
                </button>
                <hr />
                <button type="button" role="menuitem" onClick={() => runViewAction(() => changeZoom(ZOOM_STEP))}>
                  Zoom avant <kbd>Ctrl++</kbd>
                </button>
                <button type="button" role="menuitem" onClick={() => runViewAction(() => changeZoom(-ZOOM_STEP))}>
                  Zoom arrière <kbd>Ctrl+-</kbd>
                </button>
                <button type="button" role="menuitem" onClick={() => runViewAction(resetZoom)}>
                  Taille réelle ({zoom} %) <kbd>Ctrl+0</kbd>
                </button>
              </div>
            )}
          </div>
          <div className="file-menu-container">
            <button
              className="menu-button"
              type="button"
              aria-haspopup="dialog"
              onClick={openAiSettings}
            >
              IA
            </button>
          </div>
          <div className="file-menu-container">
            <button
              className="menu-button"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setAccountPanelOpen(true)}
            >
              Compte
            </button>
          </div>
          <div className="file-menu-container">
            <button className="menu-button" type="button" onClick={openHelp}>
              Aide
            </button>
          </div>
        </nav>
        <p>
          {documentState.title}
          {documentState.isDirty ? " *" : ""} · {getScenarioElementLabel(currentType)} · Page {currentPage + (coverPageVisible ? 1 : 0)}/{documentSheetCount} · {zoom} % · {documentState.status}
        </p>
      </header>

      <div className="formatting-toolbar" role="toolbar" aria-label="Mise en forme">
        <button
          className={editor?.isActive("bold") ? "is-active" : ""}
          type="button"
          aria-label="Mettre en gras"
          title="Gras (Ctrl+B)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleBold}
        >
          <strong>G</strong>
        </button>
        <button
          className={editor?.isActive("underline") ? "is-active" : ""}
          type="button"
          aria-label="Souligner"
          title="Souligné (Ctrl+U)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleUnderline}
        >
          <u>S</u>
        </button>
      </div>

      {commentActionTarget && !commentComposerOpen && (
        <button
          className="comment-inline-button"
          type="button"
          aria-label="Ajouter un commentaire"
          title="Ajouter un commentaire"
          style={{ left: commentActionTarget.left, top: commentActionTarget.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void openCommentComposer()}
        >
          💬
        </button>
      )}

      {comments.some((thread) => thread.status === "open" && !thread.anchor.lost) && (
        <div className="comment-margin" aria-label="Commentaires ouverts">
          {comments
            .filter((thread) => thread.status === "open" && !thread.anchor.lost && commentCardPositions[thread.id] !== undefined)
            .map((thread) => (
              <article
                className={`comment-margin-card ${activeCommentId === thread.id ? "is-active" : ""} ${expandedCommentId === thread.id ? "is-expanded" : ""}`}
                key={thread.id}
                data-comment-card-id={thread.id}
                style={commentCardPositions[thread.id]}
                onMouseEnter={() => setActiveCommentId(thread.id)}
              >
                {editingCommentId === thread.id ? (
                  <>
                    <textarea value={editingCommentText} onChange={(event) => setEditingCommentText(event.target.value)} />
                    <footer><button type="button" onClick={saveEditedComment}>Valider</button><button type="button" onClick={() => setEditingCommentId(null)}>Annuler</button></footer>
                  </>
                ) : (
                  <>
                    <button className="comment-preview" type="button" onClick={() => {
                      setExpandedCommentId((current) => current === thread.id ? null : thread.id);
                      navigateToComment(thread);
                    }}>
                      {thread.messages[0]?.text}
                    </button>
                    {expandedCommentId === thread.id && (
                      <footer>
                        <button type="button" onClick={() => { setEditingCommentId(thread.id); setEditingCommentText(thread.messages[0]?.text ?? ""); }}>Modifier</button>
                        <button type="button" onClick={() => void deleteCommentThread(thread.id)}>Supprimer</button>
                      </footer>
                    )}
                  </>
                )}
              </article>
            ))}
        </div>
      )}

      <main
        className="workspace"
        aria-label="Editeur de scenario"
        onMouseDown={(event) => {
          setCommentActionTarget(null);
          const clickedEditorText =
            event.target instanceof Element &&
            !!event.target.closest(".scenario-editor");

          // Après un clic dans le vide, ProseMirror perd le focus mais garde
          // sa dernière position interne. Le premier clic sur le texte doit
          // alors à la fois reprendre le focus ET placer le curseur au point
          // cliqué, sans exiger un second clic.
          if (editor && clickedEditorText && !editor.isFocused) {
            const clickedPosition = editor.view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (clickedPosition) {
              editor.view.focus();
              editor.view.dispatch(
                editor.state.tr.setSelection(
                  TextSelection.create(editor.state.doc, clickedPosition.pos),
                ),
              );
              return;
            }
          }

          if (
            editor &&
            !editor.state.selection.empty &&
            (!(event.target instanceof Element) || !event.target.closest(".scenario-editor p"))
          ) {
            editor.view.dispatch(
              editor.state.tr.setSelection(
                TextSelection.create(editor.state.doc, editor.state.selection.to),
              ),
            );
          }
        }}
        onMouseMove={(event) => {
          aiPointerPosition.current = {
            clientX: event.clientX,
            clientY: event.clientY,
          };
          refreshAiTarget(event.target, event.clientX, event.clientY);
        }}
        onWheel={handleWorkspaceWheel}
        onContextMenu={openScenarioContextMenu}
      >
        <div
          className="document-zoom"
          style={{ "--document-zoom": zoom / 100 } as CSSProperties}
        >
          <div
            className="document-canvas"
            style={{
              "--page-count": canvasSheetCount,
            } as CSSProperties}
          >
            <div className="page-sheets" aria-hidden="true">
              {Array.from({ length: canvasSheetCount }, (_, index) => (
                <div className="page-sheet" key={index}>
                  {index < documentSheetCount && (!coverPageVisible || index > 0)
                    ? <span>{coverPageVisible ? index : index + 1}</span>
                    : null}
                </div>
              ))}
            </div>
            {coverPageVisible && (
              <section className="cover-page" aria-label="Page de garde">
                {coverPage.projectName && <h1>{coverPage.projectName}</h1>}
                {coverCredits.length > 0 && (
                  <p className="cover-credits">
                    {coverCredits.map((line) => <span key={line}>{line}</span>)}
                  </p>
                )}
                <p className="cover-primary-details">
                  {[coverPage.production, coverPage.duration, coverPage.version && `Version ${coverPage.version}`, coverPage.date]
                    .filter(Boolean)
                    .map((line) => <span key={line}>{line}</span>)}
                </p>
                {coverPage.rights && <p className="cover-details"><span>{coverPage.rights}</span></p>}
                <p className="cover-contact">
                  {[coverPage.contactName, coverPage.contactEmail, coverPage.contactPhone, coverPage.contactWebsite]
                    .filter(Boolean)
                    .map((line) => <span key={line}>{line}</span>)}
                </p>
              </section>
            )}
            <div className={`editor-layer ${coverPageVisible ? "has-cover-page" : ""}`}>
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </main>

      {smartType && (
        <div
          className="smart-type"
          role="listbox"
          aria-label="Suggestions SmartType"
          style={{ left: smartType.left, top: smartType.top }}
          onMouseLeave={() => selectSmartTypeSuggestion(0)}
        >
          <div className="smart-type-heading">
            <span>{smartTypeLabels[smartType.kind]}</span>
            <kbd>Tab</kbd>
          </div>
          {smartType.items.map((item, index) => (
            <button
              className={index === smartType.selectedIndex ? "is-selected" : ""}
              type="button"
              role="option"
              aria-selected={index === smartType.selectedIndex}
              key={item}
              onMouseEnter={() => selectSmartTypeSuggestion(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                acceptSuggestion(index);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      {aiTarget && (
        <>
          <div
            className="ai-paragraph-highlight"
            aria-hidden="true"
            style={{
              left: aiTarget.highlightLeft,
              top: aiTarget.highlightTop,
              width: aiTarget.highlightWidth,
              height: aiTarget.highlightHeight,
            }}
          />
          <button
            className={`ai-inline-button ${aiBusy ? "is-busy" : ""}`}
            type="button"
            aria-label="Actions IA"
            title="Actions IA"
            style={
              {
                left: aiTarget.left,
                top: aiTarget.top,
                "--ai-scale": zoom / 100,
              } as CSSProperties
            }
            disabled={aiBusy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setTransitionMenuOpen(false);
              setCustomTransitionOpen(false);
              setCustomTransitionText("");
              setAiPromptMenuOpen((isOpen) => !isOpen);
            }}
          >
            IA
          </button>
          <button
            className="transition-inline-button"
            type="button"
            aria-label="Ajouter une transition"
            title="Ajouter une transition"
            style={{
              left: aiTarget.transitionLeft,
              top: aiTarget.top,
              "--ai-scale": zoom / 100,
            } as CSSProperties}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setAiPromptMenuOpen(false);
              setCustomTransitionOpen(false);
              setTransitionMenuOpen((isOpen) => !isOpen);
            }}
          >
            Transition
          </button>
          {transitionMenuOpen && (
            <div
              className="transition-popover"
              role="menu"
              style={{ left: aiTarget.transitionLeft, top: aiTarget.top + 18 }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="transition-popover-heading">Transition</div>
              {STANDARD_PARAGRAPH_TRANSITIONS.map((transition) => (
                <button
                  type="button"
                  role="menuitem"
                  key={transition}
                  onClick={() => insertTransition(transition)}
                >
                  {transition}
                </button>
              ))}
              {!customTransitionOpen ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setCustomTransitionOpen(true)}
                >
                  PERSONNALISÉ
                </button>
              ) : (
                <form
                  className="transition-custom-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    insertTransition(customTransitionText);
                  }}
                >
                  <input
                    autoFocus
                    value={customTransitionText}
                    onChange={(event) => setCustomTransitionText(event.target.value)}
                    placeholder="Votre transition"
                    aria-label="Transition personnalisée"
                  />
                  <button type="submit" disabled={!customTransitionText.trim()}>Ajouter</button>
                </form>
              )}
            </div>
          )}
          {aiPromptMenuOpen && (
            <div
              className="ai-popover"
              role="menu"
              style={{ left: aiTarget.left + 34, top: aiTarget.top - 10 }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="ai-popover-heading">
                <span>IA</span>
                <small>{getScenarioElementLabel(aiTarget.type)}</small>
              </div>
              {aiConfig.prompts.map((prompt) => (
                <button
                  type="button"
                  role="menuitem"
                  key={prompt.id}
                  onClick={() => void applyAiPrompt(prompt)}
                >
                  {prompt.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {helpOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setHelpOpen(false)}>
          <section className="help-panel" role="dialog" aria-modal="true" aria-label="Aide" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Bien démarrer</h2>
                <p>Les gestes essentiels pour écrire ton scénario.</p>
              </div>
              <button className="panel-close-button" type="button" aria-label="Fermer" onClick={() => setHelpOpen(false)}>×</button>
            </header>

            <section>
              <h3>Écrire et changer de type de paragraphe</h3>
              <p><kbd>Tab</kbd> passe au type de paragraphe suivant. Depuis une action : personnage, puis parenthèse, dialogue… <kbd>Maj + Tab</kbd> revient au type précédent.</p>
              <p>Pour créer une scène, place le curseur où tu veux puis utilise <kbd>Ctrl + 1</kbd>. Dans une action vide, écris <strong>I</strong> ou <strong>E</strong>, puis <kbd>Tab</kbd> pour compléter <strong>INT.</strong> ou <strong>EXT.</strong>. Écris le lieu, puis <kbd>Tab</kbd> pour le moment de la journée.</p>
            </section>

            <section>
              <h3>Enregistrer et retrouver ton travail</h3>
              <p><kbd>Ctrl + S</kbd> enregistre. <kbd>Ctrl + Maj + S</kbd> enregistre sous un autre nom. L’application garde aussi une sauvegarde automatique et une copie <code>.bak</code> du dernier enregistrement.</p>
              <p>Pour ouvrir un projet : <kbd>Ctrl + O</kbd>, ou passe par <strong>Fichier</strong>.</p>
            </section>

            <section>
              <h3>Raccourcis de texte</h3>
              <p>Dans <strong>Raccourcis</strong>, tu peux ajouter tes propres remplacements, comme sur iPhone : écris le raccourci puis espace, Entrée ou un point. Le bouton en haut permet de tous les activer ou désactiver sans les supprimer.</p>
            </section>

            <section>
              <h3>Commentaires</h3>
              <p>Sélectionne un passage : une petite bulle 💬 apparaît sous la sélection. Clique dessus, écris ta note puis valide avec <kbd>Ctrl + Entrée</kbd>. Le passage reste discrètement jaune et la note se trouve dans la marge gauche.</p>
            </section>

            <section>
              <h3>Page de garde et PDF</h3>
              <p>Le bouton <strong>Page de garde</strong> sert à remplir le titre, les crédits, la production et les contacts. Ces données sont enregistrées dans ton projet et apparaissent aussi à l’export PDF.</p>
            </section>

            <section>
              <h3>Activer l’IA</h3>
              <ol>
                <li>Ouvre la <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">facturation API OpenAI</a> et ajoute des crédits.</li>
                <li>Avant de confirmer, désactive <strong>Auto recharge</strong> : aucun achat ne sera renouvelé automatiquement.</li>
                <li>Ouvre <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API keys</a>, choisis <strong>Create new secret key</strong>, copie la clé puis colle-la dans <strong>IA</strong>.</li>
              </ol>
              <p>Les crédits API sont séparés de l’abonnement ChatGPT. Garde ta clé privée : ne l’envoie à personne.</p>
            </section>
          </section>
        </div>
      )}

      {accountPanelOpen && (
        <AccountLicensePanel
          overview={developmentAccountState?.overview ?? null}
          status={developmentAccountStatus}
          compatibility={developmentAccountState?.compatibility ?? null}
          onClose={() => setAccountPanelOpen(false)}
        />
      )}

      {commentComposerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCommentComposerOpen(false)}>
          <section className="comment-composer" role="dialog" aria-modal="true" aria-label="Ajouter un commentaire" onMouseDown={(event) => event.stopPropagation()}>
            <h2>Ajouter un commentaire</h2>
            <p>« {commentAnchor?.originalText} »</p>
            <textarea
              ref={commentInput}
              placeholder="Écrire un commentaire…"
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.ctrlKey && event.key === "Enter") {
                  event.preventDefault();
                  saveNewComment();
                }
                if (event.key === "Escape") {
                  setCommentComposerOpen(false);
                }
              }}
            />
            <footer>
              <button type="button" onClick={() => setCommentComposerOpen(false)}>Annuler</button>
              <button className="primary-button" type="button" onClick={saveNewComment}>Commenter</button>
            </footer>
          </section>
        </div>
      )}

      {findReplaceOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setFindReplaceOpen(false)}>
          <section
            className="find-replace-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Rechercher et remplacer"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>Rechercher et remplacer</h2>
                <p>{findQuery ? `${findMatchTotal} occurrence${findMatchTotal > 1 ? "s" : ""}` : "Saisis le texte à rechercher."}</p>
              </div>
              <button className="panel-close-button" type="button" aria-label="Fermer" onClick={() => setFindReplaceOpen(false)}>×</button>
            </header>
            <label>
              Rechercher
              <input
                ref={findInput}
                value={findQuery}
                onChange={(event) => {
                  setFindQuery(event.target.value);
                  setFindMatchIndex(-1);
                  setFindMatchTotal(findTextMatches(editor!, event.target.value, findMatchCase).length);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    moveFindMatch(event.shiftKey ? -1 : 1);
                  }
                }}
              />
            </label>
            <label>
              Remplacer par
              <input value={replaceQuery} onChange={(event) => setReplaceQuery(event.target.value)} />
            </label>
            <label className="find-match-case">
              <input
                type="checkbox"
                checked={findMatchCase}
                onChange={(event) => {
                  const matchCase = event.target.checked;
                  setFindMatchCase(matchCase);
                  setFindMatchIndex(-1);
                  setFindMatchTotal(findTextMatches(editor!, findQuery, matchCase).length);
                }}
              />
              Respecter les majuscules / minuscules
            </label>
            <footer>
              <div>
                <button type="button" onClick={() => moveFindMatch(-1)}>Précédent</button>
                <button type="button" onClick={() => moveFindMatch(1)}>Suivant</button>
              </div>
              <div>
                <button type="button" onClick={replaceCurrentMatch}>Remplacer</button>
                <button className="primary-button" type="button" onClick={replaceAllMatches}>Tout remplacer</button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {pdfExportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !pdfExportBusy && setPdfExportOpen(false)}>
          <section className="pdf-export-panel" role="dialog" aria-modal="true" aria-label="Options d’export PDF" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Exporter en PDF</h2>
                <p>Choisis ce qui doit apparaître dans le document final.</p>
              </div>
              <button className="panel-close-button" type="button" aria-label="Fermer" disabled={pdfExportBusy} onClick={() => setPdfExportOpen(false)}>×</button>
            </header>
            <fieldset>
              <legend>Contenu du PDF</legend>
              <label><input type="checkbox" checked={pdfExportDraft.includeCoverPage} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, includeCoverPage: event.target.checked }))} /> Page de garde</label>
              <label><input type="checkbox" checked={pdfExportDraft.includeSceneNumbers} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, includeSceneNumbers: event.target.checked }))} /> Numérotation de scène</label>
              <label><input type="checkbox" checked={pdfExportDraft.includePageNumbers} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, includePageNumbers: event.target.checked }))} /> Pagination</label>
            </fieldset>
            <label className="pdf-translation-field">
              Traduction du scénario
              <select value={pdfExportDraft.translationLanguage} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, translationLanguage: event.target.value }))}>
                <option value="">Aucune traduction</option>
                {[...PDF_TRANSLATION_LANGUAGES, ...customPdfLanguages].map((language) => <option key={language} value={language}>{displayPdfLanguage(language)}</option>)}
                <option value="__custom__">Autre langue…</option>
              </select>
              {pdfExportDraft.translationLanguage === "__custom__" && (
                <div className="pdf-custom-language-entry">
                  <input
                    type="text"
                    autoFocus
                    value={pdfExportDraft.customTranslationLanguage}
                    placeholder="ex. grec"
                    maxLength={60}
                    aria-label="Langue de traduction"
                    onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, customTranslationLanguage: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustomPdfLanguage();
                      }
                    }}
                  />
                  <button type="button" onClick={addCustomPdfLanguage}>Ajouter</button>
                </div>
              )}
              {customPdfLanguages.length > 0 && (
                <div className="pdf-saved-languages" aria-label="Langues ajoutées">
                  <span>Langues ajoutées</span>
                  <div>
                    {customPdfLanguages.map((language) => (
                      <span className="pdf-language-chip" key={language}>
                        {displayPdfLanguage(language)}
                        <button type="button" aria-label={`Retirer ${language}`} title={`Retirer ${language}`} onClick={() => removeCustomPdfLanguage(language)}>×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <small>La traduction est utilisée uniquement pour ce PDF ; ton fichier .scenario n’est pas modifié.</small>
            </label>
            <footer>
              <button type="button" disabled={pdfExportBusy} onClick={() => setPdfExportOpen(false)}>Annuler</button>
              <button className="primary-button" type="button" disabled={pdfExportBusy} onClick={() => void exportPdf()}>
                {pdfExportBusy ? "Traduction en cours…" : "Exporter"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {pdfImportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !pdfImportBusy && setPdfImportOpen(false)}>
          <section className="pdf-export-panel pdf-import-panel" role="dialog" aria-modal="true" aria-label="Importer un PDF" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Importer un PDF</h2>
                <p>L’IA convertit ton PDF en scénario structuré.</p>
              </div>
              <button className="panel-close-button" type="button" aria-label="Fermer" disabled={pdfImportBusy} onClick={() => setPdfImportOpen(false)}>×</button>
            </header>
            <div
              className={`pdf-import-dropzone${pdfImportPath ? " has-file" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0] as (File & { path?: string }) | undefined;
                if (file?.path?.toLocaleLowerCase().endsWith(".pdf")) setPdfImportPath(file.path);
                else setPdfImportError("Dépose un fichier PDF depuis l’explorateur Windows.");
              }}
            >
              <strong>{pdfImportPath ? getFileTitle(pdfImportPath) : "Dépose ton PDF ici"}</strong>
              <span>ou</span>
              <button type="button" onClick={() => void selectPdfForImport()}>Rechercher dans les fichiers</button>
            </div>
            {!aiConfig.hasApiKey && (
              <div className="pdf-import-manual-help">
                <strong>Aucune clé API configurée</strong>
                <p>Configure ta clé pour automatiser l’import, ou copie le prompt et utilise-le avec ton PDF dans ChatGPT.</p>
                <div>
                  <button type="button" onClick={() => { setPdfImportOpen(false); openAiSettings(); }}>Configurer la clé API</button>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(PDF_MANUAL_PROMPT)}>Copier le prompt</button>
                </div>
              </div>
            )}
            {pdfImportError && <p className="form-error" role="alert">{pdfImportError}</p>}
            <footer>
              <button type="button" disabled={pdfImportBusy} onClick={() => setPdfImportOpen(false)}>Annuler</button>
              <button className="primary-button" type="button" disabled={pdfImportBusy || !pdfImportPath || !aiConfig.hasApiKey} onClick={() => void importSelectedPdf()}>
                {pdfImportBusy ? "Conversion IA en cours…" : "Importer"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {aiSettingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setAiSettingsOpen(false)}
        >
          <section
            className="ai-settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Réglages IA"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>IA</h2>
                <p>
                  {aiConfig.hasApiKey
                    ? "La clé API est déjà configurée."
                    : "Ajoute ta clé API OpenAI pour activer les prompts."}
                </p>
              </div>
              <button
                className="panel-close-button"
                type="button"
                aria-label="Fermer"
                onClick={() => setAiSettingsOpen(false)}
              >
                ×
              </button>
            </header>

            <label>
              <span className="ai-key-heading">
                Clé API OpenAI
                <button type="button" onClick={() => setAiHelpOpen((isOpen) => !isOpen)}>
                  Comment l’obtenir ?
                </button>
              </span>
              <input
                type="password"
                value={aiDraft.apiKey}
                placeholder={
                  aiConfig.hasApiKey
                    ? "Laisse vide pour garder la clé actuelle"
                    : "sk-..."
                }
                onChange={(event) =>
                  setAiDraft((previous) => ({
                    ...previous,
                    apiKey: event.target.value,
                  }))
                }
              />
            </label>

            {aiHelpOpen && (
              <aside className="ai-key-help">
                <strong>Obtenir une clé API avec un crédit non renouvelable</strong>
                <ol>
                  <li>Ouvre <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">la facturation API OpenAI</a>.</li>
                  <li>Ajoute ta carte puis choisis l’achat initial de crédits : le minimum est de 5 $ (OpenAI affiche le montant final).</li>
                  <li><b>Désactive « Auto recharge »</b> avant de confirmer : aucun crédit ne sera acheté automatiquement.</li>
                  <li>Ouvre <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API keys</a>, clique « Create new secret key », copie-la puis colle-la ici.</li>
                </ol>
                <p>Les crédits API sont séparés de ChatGPT, expirent après un an et ne sont pas remboursables.</p>
              </aside>
            )}

            <label>
              Modèle
              <input
                type="text"
                value={aiDraft.model}
                onChange={(event) =>
                  setAiDraft((previous) => ({
                    ...previous,
                    model: event.target.value,
                  }))
                }
              />
            </label>

            <div className="prompt-editor-heading">
              <div>
                <span>Prompts enregistrés</span>
                <small>Choisis un prompt pour le modifier.</small>
              </div>
              <button type="button" onClick={addAiPrompt}>
                Ajouter
              </button>
            </div>

            <div className="prompt-editor">
              <div className="prompt-editor-list" role="list" aria-label="Prompts enregistrés">
                {aiDraft.prompts.map((prompt) => (
                  <button
                    className={`prompt-editor-list-item${prompt.id === selectedAiPromptId ? " is-selected" : ""}`}
                    key={prompt.id}
                    type="button"
                    role="listitem"
                    onClick={() => setSelectedAiPromptId(prompt.id)}
                  >
                    <strong>{prompt.name.trim() || "Prompt sans nom"}</strong>
                    <span>{prompt.instruction.trim() || "Aucune instruction"}</span>
                  </button>
                ))}
              </div>
              {aiDraft.prompts.map((prompt) =>
                prompt.id === selectedAiPromptId ? (
                  <article className="prompt-editor-item" key={prompt.id}>
                    <label>
                      Nom du prompt
                      <input
                        type="text"
                        value={prompt.name}
                        aria-label="Nom du prompt"
                        onChange={(event) =>
                          updateAiPrompt(prompt.id, "name", event.target.value)
                        }
                      />
                    </label>
                    <div className="prompt-instruction-editor">
                      <label className="prompt-instruction-field">
                        Instruction envoyée à l’IA
                        <div
                          className="prompt-instruction-input"
                          contentEditable
                          suppressContentEditableWarning
                          role="textbox"
                          aria-label="Instruction du prompt"
                          aria-multiline="true"
                          onInput={(event) => {
                            const text = event.currentTarget.querySelector<HTMLElement>("[data-prompt-text]")?.innerText ?? "";
                            updateAiPrompt(prompt.id, "instruction", text);
                          }}
                        >
                          <span data-prompt-text className="prompt-instruction-text">
                            {prompt.instruction}
                          </span>
                          {prompt.responseOnly && (
                            <span className="response-only-ghost" contentEditable={false}>
                              {`\n\n${RESPONSE_ONLY_INSTRUCTION}`}
                            </span>
                          )}
                        </div>
                      </label>
                      <button
                        className={`response-only-toggle${prompt.responseOnly ? " is-active" : ""}`}
                        type="button"
                        aria-pressed={prompt.responseOnly}
                        onClick={() =>
                          setAiPromptResponseOnly(prompt.id, !prompt.responseOnly)
                        }
                      >
                        {prompt.responseOnly ? "✓ Réponse uniquement" : "Réponse uniquement"}
                      </button>
                    </div>
                    <button type="button" onClick={() => removeAiPrompt(prompt.id)}>
                      Supprimer ce prompt
                    </button>
                  </article>
                ) : null,
              )}
            </div>

            <footer>
              <button type="button" onClick={() => setAiSettingsOpen(false)}>
                Annuler
              </button>
              <button className="primary-button" type="button" onClick={() => void saveAiSettings()}>
                Enregistrer
              </button>
            </footer>
          </section>
        </div>
      )}

      {aiSettingsOpen && aiMissingKeyNoticeOpen && (
        <div className="modal-backdrop ai-missing-key-backdrop" role="presentation">
          <section className="ai-missing-key-panel" role="alertdialog" aria-modal="true" aria-label="Clé API manquante">
            <header>
              <div>
                <h2>Clé API manquante</h2>
                <p>Ajoute une clé API OpenAI pour utiliser les fonctions IA.</p>
              </div>
              <button className="panel-close-button" type="button" aria-label="Fermer" onClick={() => setAiMissingKeyNoticeOpen(false)}>×</button>
            </header>
            <ol>
              <li>Ouvre <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">la facturation API OpenAI</a> et connecte-toi.</li>
              <li>Clique sur « Buy credits », puis choisis l’achat initial de crédits : le minimum est de 5 $ (de quoi corriger 7 fois la Bible).</li>
              <li>Désactive « Auto recharge » avant de confirmer : aucun crédit ne sera acheté automatiquement.</li>
              <li>Ouvre <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API keys</a>, puis clique sur « Create new secret key ».</li>
              <li>Donne le nom que tu veux à la clé, choisis « Default project » et laisse les permissions sur « All ».</li>
              <li>Copie la clé et colle-la dans le champ ci-dessous.</li>
            </ol>
            <label className="ai-missing-key-field">
              Clé API OpenAI
              <input type="password" autoFocus value={aiDraft.apiKey} placeholder="sk-..." onChange={(event) => setAiDraft((previous) => ({ ...previous, apiKey: event.target.value }))} />
            </label>
            <footer>
              <button type="button" onClick={() => setAiMissingKeyNoticeOpen(false)}>Fermer</button>
              <button className="primary-button" type="button" onClick={() => void saveAiSettings()}>Enregistrer la clé</button>
            </footer>
          </section>
        </div>
      )}

      {scenarioContextMenu && (
        <div
          className="scenario-context-menu"
          role="menu"
          style={{ left: scenarioContextMenu.left, top: scenarioContextMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onMouseDown={(event) => {
              event.preventDefault();
              if (editor && scenarioHasEnding(editor)) {
                removeScenarioEnding();
              } else {
                addScenarioEnding();
              }
            }}
          >
            {editor && scenarioHasEnding(editor) ? "Retirer FIN" : "FIN"}
          </button>
        </div>
      )}

      {textReplacementsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setTextReplacementsOpen(false)}
        >
          <section
            className="text-replacements-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Raccourcis de texte"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>Raccourcis de texte</h2>
                <p>Comme sur iPhone : écris le raccourci puis espace ou Entrée.</p>
              </div>
              <button
                className={`shortcut-toggle ${textReplacementsEnabled ? "is-enabled" : ""}`}
                type="button"
                aria-pressed={textReplacementsEnabled}
                onClick={() => setTextReplacementsEnabled((enabled) => !enabled)}
              >
                {textReplacementsEnabled ? "Désactiver" : "Activer"}
              </button>
              <button
                className="panel-close-button"
                type="button"
                aria-label="Fermer"
                onClick={() => setTextReplacementsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="text-replacement-toolbar">
              <input
                type="search"
                value={textReplacementQuery}
                placeholder="Rechercher un raccourci…"
                aria-label="Rechercher un raccourci"
                onChange={(event) => setTextReplacementQuery(event.target.value)}
              />
              <button className="add-text-replacement" type="button" onClick={addTextReplacement}>
                + Ajouter
              </button>
            </div>
            {textReplacementError && (
              <p className="text-replacement-error" role="alert">{textReplacementError}</p>
            )}
            <div className="text-replacement-list">
              {textReplacementDrafts.length === 0 ? (
                <p className="empty-text-replacements">Aucun raccourci pour le moment.</p>
              ) : visibleTextReplacementDrafts.length === 0 ? (
                <p className="empty-text-replacements">Aucun raccourci ne correspond à cette recherche.</p>
              ) : (
                <>
                  <div className="text-replacement-columns" aria-hidden="true">
                    <span>Raccourci</span>
                    <span>Remplacé par</span>
                    <span />
                  </div>
                  {visibleTextReplacementDrafts.map((item) => (
                    <article className="text-replacement-item" key={item.id}>
                      <input
                        placeholder="ex. adr"
                        aria-label="Raccourci"
                        value={item.shortcut}
                        onChange={(event) => updateTextReplacement(item.id, "shortcut", event.target.value)}
                      />
                      <input
                        placeholder="ex. 12 rue des Lilas"
                        aria-label="Remplacer par"
                        value={item.replacement}
                        onChange={(event) => updateTextReplacement(item.id, "replacement", event.target.value)}
                      />
                      <button type="button" aria-label={`Supprimer ${item.shortcut || "ce raccourci"}`} title="Supprimer" onClick={() => removeTextReplacement(item.id)}>
                        ×
                      </button>
                    </article>
                  ))}
                </>
              )}
            </div>
            <footer>
              <button type="button" onClick={() => setTextReplacementsOpen(false)}>
                Annuler
              </button>
              <button className="primary-button" type="button" onClick={saveTextReplacements}>
                Enregistrer
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function createPdfTranslationSegments(content: JSONContent): {
  segments: ScenarioTranslationSegment[];
  positions: number[];
} {
  const segments: ScenarioTranslationSegment[] = [];
  const positions: number[] = [];
  for (const [position, node] of (content.content ?? []).entries()) {
    if (node.type !== "paragraph" || node.attrs?.ending === true) {
      continue;
    }
    const type = toScenarioElementType(node.attrs?.scenarioType);
    // Les noms de personnages sont des identifiants, pas du texte narratif.
    if (type === "CHARACTER") {
      continue;
    }
    const text = getPdfExportNodeText(node).trim();
    if (!text) {
      continue;
    }
    positions.push(position);
    segments.push({ index: segments.length, type, text });
  }
  if (segments.length === 0) {
    throw new Error("Le scénario ne contient aucun texte à traduire.");
  }
  return { segments, positions };
}

function applyPdfTranslations(
  content: JSONContent,
  positions: number[],
  translatedTexts: string[],
): JSONContent {
  if (positions.length !== translatedTexts.length) {
    throw new Error("La traduction est incomplète. Le PDF n'a pas été exporté.");
  }
  const nodes = [...(content.content ?? [])];
  positions.forEach((position, index) => {
    const node = nodes[position];
    if (!node) {
      return;
    }
    nodes[position] = {
      ...node,
      content: [{ type: "text", text: translatedTexts[index] }],
    };
  });
  return { ...content, content: nodes };
}

function getPdfExportNodeText(node: JSONContent): string {
  return node.type === "text"
    ? node.text ?? ""
    : (node.content ?? []).map(getPdfExportNodeText).join("");
}

function findParagraphPosition(editor: Editor, paragraph: HTMLElement): number | null {
  let foundPosition: number | null = null;

  editor.state.doc.descendants((node, position) => {
    if (foundPosition !== null || node.type.name !== "paragraph") {
      return true;
    }

    if (editor.view.nodeDOM(position) === paragraph) {
      foundPosition = position;
      return false;
    }

    return true;
  });

  return foundPosition;
}

function findScenarioEndingPosition(doc: Editor["state"]["doc"]): number | null {
  let endingPosition: number | null = null;
  doc.forEach((node, position) => {
    if (node.type.name === "paragraph" && node.attrs.ending === true) {
      endingPosition = position;
    }
  });
  return endingPosition;
}

function scenarioHasEnding(editor: Editor): boolean {
  return findScenarioEndingPosition(editor.state.doc) !== null;
}

function findAiParagraphAtPoint(
  editor: Editor,
  clientX: number,
  clientY: number,
  zoom = 100,
): HTMLElement | null {
  const paragraphs = editor.view.dom.querySelectorAll<HTMLElement>(
    'p[data-scenario-type="ACTION"]:not([data-scenario-ending]), p[data-scenario-type="DIALOGUE"]',
  );

  for (const paragraph of paragraphs) {
    const canvas = paragraph.closest(".document-canvas");
    const canvasRect = canvas?.getBoundingClientRect();
    const paragraphRect = paragraph.getBoundingClientRect();
    const documentScale = zoom / 100;
    if (
      canvasRect &&
      clientX >= canvasRect.left * documentScale &&
      clientX <= canvasRect.right * documentScale &&
      clientY >= paragraphRect.top * documentScale &&
      clientY <= paragraphRect.bottom * documentScale
    ) {
      return paragraph;
    }
  }

  return null;
}

function replaceParagraphText(editor: Editor, position: number, text: string): boolean {
  const node = editor.state.doc.nodeAt(position);
  if (!node || node.type.name !== "paragraph") {
    return false;
  }

  const from = position + 1;
  const to = position + node.nodeSize - 1;
  const transaction = editor.state.tr.insertText(text.trim(), from, to);
  transaction.setSelection(TextSelection.create(transaction.doc, from + text.trim().length));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

/**
 * Charge un autre document sans laisser son remplacement complet dans
 * l'historique d'annulation. Sans cela, Ctrl+Z pouvait annuler l'ouverture
 * du projet entier et donner l'impression que tout le scénario était effacé.
 */
function replaceEditorDocumentWithoutHistory(editor: Editor, content: JSONContent): void {
  const document = editor.schema.nodeFromJSON(content);
  const cleanState = EditorState.create({
    schema: editor.schema,
    doc: document,
    // À l'ouverture, le curseur ne doit pas se retrouver dans le tout premier
    // en-tête déjà rempli, ce qui ouvrirait inutilement les suggestions.
    selection: TextSelection.atEnd(document),
    plugins: editor.state.plugins,
  });
  editor.view.updateState(cleanState);
}

function convertActionStartToSceneHeading(editor: Editor): void {
  if (getCurrentScenarioElementType(editor) !== "ACTION") {
    return;
  }

  const text = editor.state.selection.$from.parent.textContent.toUpperCase();
  if (/^(?:INT\.|EXT\.|INT\.\/EXT\.)/.test(text)) {
    editor.commands.setScenarioElementType("SCENE_HEADING");
  }
}

export default App;
