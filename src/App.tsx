import { UiTextarea } from './ui/UiTextarea';
import { AiBudgetUsage } from './commercial/AiBudgetUsage';
import { UiSelect } from './ui/UiSelect';
import { ensureVersionedProject, captureVersion, selectProjectVersion, addProjectVersion, deleteProjectVersion,
  renameProjectVersion, nextVersionName, type VersionedProject } from './document/projectVersions';
import { ProjectVersionControl } from './document/ProjectVersionControl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { UiIcon } from './ui/UiIcon';
import { createAutomaticUpdater, type AutomaticUpdater } from './updates/automaticUpdater';
import { ReleaseInfo } from "./commercial/ReleaseInfo";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { invoke, isTauri } from "@tauri-apps/api/core";
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
  syncProjectCommentMarks,
  type CommentThread,
} from "./editor/comments";
import {
  DEFAULT_SCENARIO_ELEMENT_TYPE,
  getScenarioElementLabel,
  SCENARIO_ELEMENT_TYPES,
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
  chooseWorkspacePdfToSave,
  choosePdfToOpen,
  registerBrowserPdf,
  chooseInterchangeToOpen,
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
  saveInterchangeFile,
  writeScenario,
  type RecentScenario,
} from "./document/persistence";
import {
  INTERCHANGE_FORMATS,
  exportInterchange,
  importInterchange,
  type InterchangeFormat,
} from './document/interchange';
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
import { extractPdfText, parseAiScenarioResponse } from "./document/pdfImport";
import {
  createDefaultAiConfig,
  buildAiPromptInstruction,
  readAiConfig,
  importPdfScenario,
  RESPONSE_ONLY_INSTRUCTION,
  runAiPrompt,
  translateScenario,
  writeAiConfig,
  type AiConfigView,
  type AiPrompt,
  type ScenarioTranslationSegment,
} from "./document/aiConfig";
import { AccountLicensePanel } from "./commercial/AccountLicensePanel";
import { CommercialHttpError } from "./commercial/authenticatedApi";
import { AuthSessionError } from "./commercial/auth";
import { hasActiveEntitlement } from './commercial/offlineLicense';
import { OfflineLicenseStatus } from './commercial/OfflineLicenseStatus';
import { CloudProjectsPanel, CloudProjectStatus } from './commercial/CloudProjectsPanel';
import { resolveProjectCommentAnchors } from './commercial/projectMetadataClient';
import { CommentMargin } from './editor/CommentMargin';
import { SceneTimeline } from './editor/SceneTimeline';
import { SceneWhiteboard } from './editor/SceneWhiteboard';
import { SceneBreakdown } from './editor/SceneBreakdown';
import { getProjectBreakdowns, updateScenarioBreakdown, updateScenarioBreakdowns, type SceneBreakdown as SceneBreakdownData } from './editor/breakdownModel';
import { TechnicalBreakdown } from './editor/TechnicalBreakdown';
import { WorkspacePdfExportDialog, type WorkspacePdfExportRequest } from './editor/WorkspacePdfExportDialog';
import {
  getScenarioCharacters,
  getTechnicalBreakdown,
  updateTechnicalBreakdown,
  type TechnicalBreakdown as TechnicalBreakdownData,
} from './editor/technicalBreakdownModel';
import { getDocumentStatistics } from './editor/documentStatistics';
import {
  addScenarioAct,
  addScenarioScene,
  deleteScenarioAct,
  deleteScenarioScene,
  duplicateScenarioScene,
  ensureScenarioSceneActs,
  getScenarioActDescriptions,
  getScenarioSceneAtPosition,
  getScenarioActCount,
  getScenarioScenes,
  MAX_SCENARIO_ACT_COUNT,
  moveScenarioScene,
  moveScenarioSceneGroup,
  updateScenarioActDescription,
  updateScenarioScene,
  type ScenarioAct,
  type ScenarioScene,
  type SceneWhiteboardMetadata,
} from './editor/sceneTimelineModel';
import { cloudProjectRuntime, type CloudProjectEditor, type OpenProjectState } from './commercial/cloudProjectRuntime';
import { collaborationTransaction } from './editor/collaborationTransaction';
import {
  authenticatedOperations,
  cloudSyncQueue,
  createRuntimeCommercialApi,
  offlineLicense,
  sessions,
} from "./commercial/runtime";
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
// Bêta locale : toutes les fonctions sont ouvertes pour pouvoir tester les
// parcours complets sans modifier l'offre réellement attribuée à un compte.
// Remettre à false lors du retour des limites commerciales.

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
  SCENE_HEADING: "",
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

type ExportFormat = "pdf" | InterchangeFormat;
type FileSubmenu = "import" | "export" | null;

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

function isTemporaryAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof CommercialHttpError && [502, 503, 504].includes(error.status))
  );
}

function App() {
  useEffect(() => {
    let active = true;
    const stopListening = sessions.subscribe((authenticated) => {
      if (!active || authenticated) return;
      authenticatedOperations.stop();
      void cloudProjectRuntime.close().catch(() => undefined);
    });

    void sessions
      .getAccessToken()
      .then((token) => {
        if (!active) return;
        if (token) {
          authenticatedOperations.reset();
        }
      })
      .catch(async (error) => {
        if (!active) return;
        if (isTemporaryAuthenticationFailure(error)) {
          const restored = await offlineLicense.restore().catch(() => null);
          if (!active) return;
          if (restored) {
            authenticatedOperations.reset();
            return;
          }
        }
        if (error instanceof AuthSessionError && error.terminal) {
          await offlineLicense.clear().catch(() => undefined);
        }
      });

    return () => {
      active = false;
      stopListening();
    };
  }, []);

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [licenseState, setLicenseState] = useState(() => offlineLicense.state);
  const [currentType, setCurrentType] = useState<ScenarioElementType>(
    DEFAULT_SCENARIO_ELEMENT_TYPE,
  );
  const [smartType, setSmartType] = useState<SmartTypeViewState | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [fileSubmenu, setFileSubmenu] = useState<FileSubmenu>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [commentActionTarget, setCommentActionTarget] = useState<CommentActionTarget | null>(null);
  const [commentEditingRequestId, setCommentEditingRequestId] = useState<string | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [cloudReadOnly, setCloudReadOnly] = useState(false);
  const [recentScenarios, setRecentScenarios] = useState<RecentScenario[]>([]);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [pdfExportBusy, setPdfExportBusy] = useState(false);
  const [workspacePdfExportKind, setWorkspacePdfExportKind] = useState<'breakdown' | 'technical' | null>(null);
  const [workspacePdfExportBusy, setWorkspacePdfExportBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
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
  const [selectedAiPromptId, setSelectedAiPromptId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState(() => ({
    prompts: createDefaultAiConfig().prompts,
  }));
  const [aiTarget, setAiTarget] = useState<AiParagraphTarget | null>(null);
  const [aiPromptMenuOpen, setAiPromptMenuOpen] = useState(false);
  const [transitionMenuOpen, setTransitionMenuOpen] = useState(false);
  const [customTransitionOpen, setCustomTransitionOpen] = useState(false);
  const [customTransitionText, setCustomTransitionText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [cloudProjectsOpen, setCloudProjectsOpen] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [technicalBreakdownOpen, setTechnicalBreakdownOpen] = useState(false);
  const [scenarioContextMenu, setScenarioContextMenu] =
    useState<ScenarioContextMenuState | null>(null);
  const [zoom, setZoom] = useState(() => {
    const storedZoom = Number(readLocalSetting("scenario-zoom") ?? "100");
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
  const projectVersionsRef = useRef<VersionedProject | null>(null);
  const [projectVersions, setProjectVersions] = useState<VersionedProject | null>(null);
  const versionTransition = useRef(false);
  const documentLoadPending = useRef(false);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const documentSavePending = useRef(false);
  const [versionBusy, setVersionBusy] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [versionCloudState, setVersionCloudState] = useState<OpenProjectState>({project:null,status:'closed',message:''});
  const canUseProfessionalFormats = hasActiveEntitlement(licenseState, 'pro_formats');
  const canUseProjectVersions = hasActiveEntitlement(licenseState, 'scenario_versions');
  const canUseSceneTimeline = hasActiveEntitlement(licenseState, 'scene_cards');
  const cloudVersionLocked = versionCloudState.status === 'loading' || Boolean(versionCloudState.project && !versionCloudState.branches?.length);
  const listedProjectVersions = versionCloudState.project ? versionCloudState.branches ?? [] : projectVersions?.versions ?? [];
  const listedActiveVersionId = versionCloudState.project ? versionCloudState.activeBranchId : projectVersions?.activeVersionId;
  const paginationFrame = useRef<number | null>(null);
  const scenarioWorkspaceVisibleRef = useRef(false);
  scenarioWorkspaceVisibleRef.current = initialRecoveryFinished
    && !cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen;
  const isReplacingDocument = useRef(false);
  const recoveryWasChecked = useRef(false);
  const launchedScenarioWasChecked = useRef(false);
  const lastBackupAt = useRef(0);
  const closeInProgress = useRef(false);
  const smartTypeInteractionStarted = useRef(false);
  const aiPointerPosition = useRef<{ clientX: number; clientY: number } | null>(null);
  const findInput = useRef<HTMLInputElement | null>(null);
  const currentDocumentState = useRef(documentState);
  const automaticUpdater = useRef<AutomaticUpdater | null>(null);
  // La tête fait partie du document .scenario. Cette référence donne toujours
  // à l'enregistrement (manuel comme automatique) la dernière valeur saisie,
  // sans attendre un rendu React ou un clic sur « Appliquer ».
  const coverPageRef = useRef<CoverPageData>(coverPage);
  const coverPageHiddenRef = useRef(coverPageHidden);
  const textReplacementsRef = useRef(textReplacements);
  const textReplacementsEnabledRef = useRef(textReplacementsEnabled);
  const commentsRef = useRef(comments);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const collaborationListeners = useRef(new Set<(document: JSONContent) => void>());
  useEffect(() => offlineLicense.subscribe(() => setLicenseState(offlineLicense.state)), []);
  useEffect(() => cloudProjectRuntime.subscribe(setVersionCloudState), []);
  useEffect(() => {
    let wasAuthenticated = false;
    return sessions.subscribe(authenticated => {
      if (wasAuthenticated && !authenticated) setCloudProjectsOpen(false);
      wasAuthenticated = authenticated;
    });
  }, []);

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
    const updater = createAutomaticUpdater({
      isSafeToInstall: () => !currentDocumentState.current.isDirty,
      onStatus: (status) => setDocumentState((previous) => ({ ...previous, status })),
    });
    automaticUpdater.current = updater;
    const stop = updater.start();
    return () => {
      automaticUpdater.current = null;
      stop();
    };
  }, []);

  useEffect(() => {
    if (!documentState.isDirty) void automaticUpdater.current?.installWhenSafe();
  }, [documentState.isDirty]);

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

  useEffect(() => {
    const resumeCloudQueue = () => { void cloudSyncQueue.process(); };
    resumeCloudQueue();
    window.addEventListener("online", resumeCloudQueue);
    return () => window.removeEventListener("online", resumeCloudQueue);
  }, []);

  const refreshPagination = useCallback((editor: Editor) => {
    if (!scenarioWorkspaceVisibleRef.current) return;
    if (paginationFrame.current !== null) {
      cancelAnimationFrame(paginationFrame.current);
    }

    paginationFrame.current = requestAnimationFrame(() => {
      paginationFrame.current = null;
      if (editor.isDestroyed || !scenarioWorkspaceVisibleRef.current) {
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
    setActiveSceneId(getScenarioSceneAtPosition(
      editor.state.doc,
      editor.state.selection.from,
    )?.id ?? null);
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

    setDocumentRevision(revision => revision + 1);
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
      if (transaction.getMeta('scenario-comment-projection')) return;
      if (transaction.getMeta("scenario-block-ids") !== true) {
        markDocumentChanged();
        if (!isReplacingDocument.current) {
          const snapshot = activeEditor.getJSON();
          for (const listener of collaborationListeners.current) listener(snapshot);
        }
      }
      if (!transaction.getMeta('scenario-collaboration-remote')) {
        const typedDocument = activeEditor.state.doc;
        requestAnimationFrame(() => {
          if (!activeEditor.isDestroyed && activeEditor.state.doc === typedDocument) {
            convertActionStartToSceneHeading(activeEditor);
          }
        });
      }
    },
  });

  useEffect(() => {
    if (!whiteboardOpen || !editor || editor.isDestroyed || !editor.isEditable) return;
    ensureScenarioSceneActs(editor);
  }, [documentRevision, editor, whiteboardOpen]);

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
          setCommentActionTarget(getCommentActionPosition(editor, zoom, appShellRef.current));
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
      syncProjectCommentMarks(editor, comments);
      editor.view.dom.querySelectorAll<HTMLElement>("[data-comment-thread-id]").forEach((anchor) => {
        anchor.classList.toggle("is-active", anchor.dataset.commentThreadId === activeCommentId);
      });
    }
  }, [activeCommentId, comments, editor]);

  useEffect(() => { cloudProjectRuntime.metadataChanged(); }, [comments, coverPage, coverPageHidden, documentState.title]);

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
        target.closest(".comment-inline-button, .formatting-toolbar, .ui-select-panel") ||
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


  const refreshAiTarget = useCallback(
    (target: EventTarget | null, clientX: number, clientY: number) => {
      if (!editor) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest(
          ".paragraph-action-cluster, .ai-settings-panel",
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
        setTransitionMenuOpen(false);
        setCustomTransitionOpen(false);
        setCustomTransitionText("");
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
        setTransitionMenuOpen(false);
        setCustomTransitionOpen(false);
        setCustomTransitionText("");
      }
      const appShellRect = appShellRef.current?.getBoundingClientRect();
      const paragraphOverlay = clientRectToOverlay(rect, zoom, appShellRect);
      const canvasOverlay = clientRectToOverlay(canvasRect, zoom, appShellRect);
      setAiTarget({
        left: paragraphOverlay.left + paragraphOverlay.width,
        transitionLeft: paragraphOverlay.left + paragraphOverlay.width + 36,
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
    [aiBusy, aiTarget, editor, zoom],
  );

  useEffect(() => {
    if (!transitionMenuOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          ".paragraph-action-cluster",
        )
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
    (activeEditor: Editor, title: string): ScenarioFile => {
      const current = createScenarioFile(
        activeEditor,
        title,
        coverPageRef.current,
        commentsRef.current,
        coverPageHiddenRef.current,
      );
      if (!projectVersionsRef.current) return current;
      const project = captureVersion(projectVersionsRef.current, current);
      projectVersionsRef.current = project;
      return project;
    },
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
    (document: ScenarioFile, filePath: string | null, fromCloud = false) => {
      if (!editor || (versionTransition.current && !fromCloud)) {
        return;
      }
      // A channel is bound to one scenario. Never send a newly opened local
      // file to the previous Studio through the existing editor subscription.
      if (!fromCloud) {
        void cloudProjectRuntime.close();
        editor.setEditable(true);
      }

      projectVersionsRef.current = document.formatVersion === 2 ? ensureVersionedProject(document) : null;
      setProjectVersions(projectVersionsRef.current);

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
      title: "senario",
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
        title: "senario",
        kind: "warning",
        okLabel: "Continuer",
        cancelLabel: "Annuler",
      },
    );
  }, [documentState.isDirty]);

  const saveDocument = useCallback(
    async (saveAs = false): Promise<string | null> => {
      if (!editor || versionTransition.current || documentSavePending.current || documentLoadPending.current) {
        return null;
      }
      documentSavePending.current = true;
      try {
      let path = documentState.filePath;
      if (saveAs || !path) {
        path = await chooseScenarioToSave(documentState.title);
      }
      if (!path) {
        return null;
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
        return path;
      } catch (error) {
        await showError(error);
        return null;
      }
      } finally { documentSavePending.current = false; }
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

  useEffect(() => {
    if (!editor || isTauri()) return;
    const saveRecovery = () => {
      const state = currentDocumentState.current;
      if (!state.isDirty || versionTransition.current) return;
      void persistRecovery(editor, state.title, state.filePath).catch(() => {
        setDocumentState(previous => ({...previous,status:'Copie locale indisponible — téléchargez votre projet avant de fermer.'}));
      });
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const pending = versionCloudState.project ? cloudProjectRuntime.hasUnsyncedChanges() : currentDocumentState.current.isDirty;
      if (!pending) return;
      saveRecovery();
      event.preventDefault();
      event.returnValue = '';
    };
    const visibility = () => { if (document.visibilityState === 'hidden') saveRecovery(); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [editor, persistRecovery, versionCloudState.project]);

  async function changeProjectVersion(action: string, name = '', sourceId = ''): Promise<boolean> {
    if (!canUseProjectVersions && (!versionCloudState.project || ['duplicate','blank','rename','delete','restore'].includes(action))) {
      setVersionError('La gestion des versions est disponible avec l’offre Studio.');
      return false;
    }
    if (!editor || closeInProgress.current || versionTransition.current || documentSavePending.current || documentLoadPending.current || cloudVersionLocked || (cloudReadOnly && (!versionCloudState.project || ['duplicate','blank','rename','delete','restore'].includes(action)))
      || aiBusy || pdfImportBusy || pdfExportBusy) return false;
    // A conflicted/empty comment draft must not be unmounted and silently lost.
    if (document.querySelector('.margin-note textarea')) {
      setVersionError('Enregistrez ou annulez le commentaire en cours avant de changer de version.');
      return false;
    }
    versionTransition.current = true; setVersionBusy(true); setVersionError('');
    editor.setEditable(false);
    try {
      if (versionCloudState.project) {
        await cloudProjectRuntime.changeVersion(action, name, sourceId);
        return true;
      }
      const live = createDocument(editor, currentDocumentState.current.title);
      const before = ensureVersionedProject(live);
      const targetId = sourceId && sourceId !== 'initial' ? sourceId : before.activeVersionId;
      const after = action === 'duplicate' ? addProjectVersion(before, name, sourceId || before.activeVersionId)
        : action === 'blank' ? addProjectVersion(before, name, null)
        : action === 'rename' ? renameProjectVersion(before, targetId, name)
        : action === 'delete' ? deleteProjectVersion(before, targetId)
        : selectProjectVersion(before, action);
      after.savedAt = new Date().toISOString();
      // Never switch the editor until both outgoing backup and complete new bundle are durable.
      await writeBackup(JSON.stringify(before, null, 2));
      await writeAutosave(serializeRecoveryFile(after, currentDocumentState.current.filePath));
      const activeDocumentChanged = before.activeVersionId !== after.activeVersionId;
      isReplacingDocument.current = activeDocumentChanged;
      projectVersionsRef.current = after; setProjectVersions(after);
      if (activeDocumentChanged) {
        replaceEditorDocumentWithoutHistory(editor, after.content);
        ensureScenarioBlockIds(editor);
        coverPageRef.current = after.coverPage; setCoverPage(after.coverPage); setCoverDraft(after.coverPage);
        coverPageHiddenRef.current = after.coverPageHidden; setCoverPageHidden(after.coverPageHidden);
        commentsRef.current = after.comments; setComments(after.comments); setActiveCommentId(null);
        syncProjectCommentMarks(editor, after.comments);
        setSmartType(null); setAiTarget(null); setAiPromptMenuOpen(false); setTransitionMenuOpen(false);
        setCommentEditingRequestId(null); setCoverMenuOpen(false);
      }
      const nextState = { ...currentDocumentState.current, isDirty: true, status: `Version « ${after.versions.find(v => v.id === after.activeVersionId)!.name} » — copie de récupération enregistrée` };
      currentDocumentState.current = nextState; setDocumentState(nextState);
      refreshEditorState(editor);
      cloudProjectRuntime.metadataChanged();
      return true;
    } catch (error) {
      setVersionError(error instanceof Error ? error.message : 'Changement impossible. La version actuelle est conservée.');
      return false;
    } finally {
      isReplacingDocument.current = false; versionTransition.current = false; setVersionBusy(false);
      if (!versionCloudState.project) editor.setEditable(!cloudReadOnly);
    }
  }

  function nextAvailableVersionName(): string {
    const current = projectVersionsRef.current;
    if (versionCloudState.project) {
      let n = 1; while (listedProjectVersions.some(v => !v.deletedAt && v.name.toLowerCase() === `version ${n}`)) n++;
      return `Version ${n}`;
    }
    return current ? nextVersionName(current) : 'Version 2';
  }

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

  const openExportDialog = useCallback((format: ExportFormat) => {
    if (format !== "pdf" && !canUseProfessionalFormats) {
      setFileMenuOpen(false);
      setFileSubmenu(null);
      setAccountPanelOpen(true);
      setDocumentState(previous => ({
        ...previous,
        status: "Les exports professionnels sont disponibles avec l’offre Studio",
      }));
      return;
    }
    setFileMenuOpen(false);
    setFileSubmenu(null);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setExportFormat(format);
    setPdfExportDraft({
      includeCoverPage: hasCoverPageContent(coverPage),
      includeSceneNumbers: true,
      includePageNumbers: true,
      translationLanguage: "",
      customTranslationLanguage: "",
    });
    setPdfExportOpen(true);
  }, [canUseProfessionalFormats, coverPage]);

  const openPdfExport = useCallback(() => {
    openExportDialog("pdf");
  }, [openExportDialog]);

  const openWorkspacePdfExport = useCallback((kind: 'breakdown' | 'technical') => {
    setFileMenuOpen(false);
    setFileSubmenu(null);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setWorkspacePdfExportKind(kind);
  }, []);

  const openCurrentPdfExport = useCallback(() => {
    if (technicalBreakdownOpen) openWorkspacePdfExport('technical');
    else if (breakdownOpen) openWorkspacePdfExport('breakdown');
    else if (!cloudProjectsOpen && !whiteboardOpen) openPdfExport();
  }, [breakdownOpen, cloudProjectsOpen, openPdfExport, openWorkspacePdfExport, technicalBreakdownOpen, whiteboardOpen]);

  const exportCurrentFormat = useCallback(async () => {
    if (!editor) {
      return;
    }

    try {
      if (versionTransition.current || documentSavePending.current || documentLoadPending.current) {
        return;
      }
      if (exportFormat !== "pdf" && !canUseProfessionalFormats) {
        setPdfExportOpen(false);
        setAccountPanelOpen(true);
        setDocumentState(previous => ({
          ...previous,
          status: "Les exports professionnels sont disponibles avec l’offre Studio",
        }));
        return;
      }
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

      let pdfPath: string | null = null;
      if (exportFormat === "pdf") {
        pdfPath = await choosePdfToSave(documentState.title);
        if (!pdfPath) return;
      }

      documentSavePending.current = true;
      setPdfExportBusy(true);
      let document = createDocument(editor, documentState.title);
      if (translationLanguage) {
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

      if (exportFormat === "pdf") {
        const { createScenarioPdf } = await import("./document/pdfExport");
        await writePdf(pdfPath!, await createScenarioPdf(document, pdfExportDraft));
      } else {
        const preparedDocument = applyPortableExportOptions(document, pdfExportDraft);
        const contents = await exportInterchange(exportFormat, preparedDocument);
        const path = await saveInterchangeFile(exportFormat, documentState.title, contents);
        if (!path) return;
      }

      const formatLabel = getExportFormatLabel(exportFormat);
      setPdfExportOpen(false);
      setDocumentState((previous) => ({
        ...previous,
        status: translationLanguage
          ? `${formatLabel} traduit et exporté`
          : `${formatLabel} exporté`,
      }));
    } catch (error) {
      await showError(error);
    } finally {
      setPdfExportBusy(false);
      documentSavePending.current = false;
    }
  }, [canUseProfessionalFormats, createDocument, documentState.title, editor, exportFormat, pdfExportDraft, rememberCustomPdfLanguage, showError]);

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
    if (!editor?.isEditable) {
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
    const createdAt = new Date().toISOString();
    const thread: CommentThread = {
      id: createStableId("thread"),
      status: "open",
      createdAt,
      resolvedAt: null,
      anchor,
      messages: [{ id: createStableId("message"), text: "", createdAt, editedAt: null }],
    };
    addCommentMark(editor, thread.id, thread.anchor);
    setComments((previous) => [...previous, thread]);
    setActiveCommentId(thread.id);
    setCommentEditingRequestId(thread.id);
    setCommentActionTarget(null);
    setDocumentState((previous) => ({ ...previous, isDirty: true, status: "Commentaire créé" }));
  }, [editor]);

  const updateCommentThread = useCallback((threadId: string, update: (thread: CommentThread) => CommentThread) => {
    if (!editor?.isEditable) return;
    setComments((previous) => previous.map((thread) => thread.id === threadId ? update(thread) : thread));
    setDocumentState((previous) => ({ ...previous, isDirty: true, status: "Commentaires modifiés" }));
  }, [editor]);

  const navigateToComment = useCallback((thread: CommentThread, toggle = false) => {
    if (!editor) {
      return;
    }
    if (toggle && activeCommentId === thread.id) {
      setActiveCommentId(null);
      return;
    }
    const position = findCommentAnchorPosition(editor, thread.anchor);
    if (!position) {
      setActiveCommentId(thread.id);
      return;
    }
    editor.chain().setTextSelection(position.from).run();
    window.getSelection()?.removeAllRanges();
    setActiveCommentId(thread.id);
  }, [activeCommentId, editor]);

  const deleteCommentThread = useCallback(async (threadId: string) => {
    if (!editor?.isEditable) return;
    const shouldDelete = isTauri() ? await confirm("Supprimer ce commentaire et toutes ses réponses ?", {
      title: "Commentaires",
      kind: "warning",
      okLabel: "Supprimer",
      cancelLabel: "Annuler",
    }) : window.confirm('Supprimer ce commentaire et toutes ses réponses ?');
    if (!shouldDelete || !editor?.isEditable) {
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

  const openAiSettings = useCallback(() => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
    setCoverMenuOpen(false);
    setAiSettingsOpen(true);
    setAiDraft({
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
    setFileSubmenu(null);
    setFileMenuOpen((isOpen) => !isOpen);
  }, []);

  const toggleViewMenu = useCallback(() => {
    setFileMenuOpen(false);
    setFileSubmenu(null);
    setCoverMenuOpen(false);
    setViewMenuOpen((isOpen) => !isOpen);
  }, []);

  const closeTopMenus = useCallback(() => {
    setFileMenuOpen(false);
    setFileSubmenu(null);
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
      if (!editor?.isEditable) return;
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
    [editor],
  );

  const saveCoverPage = useCallback(() => {
    if (!editor?.isEditable) return;
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
  }, [coverDraft, editor]);

  const toggleCoverPageHidden = useCallback((hidden: boolean) => {
    if (!editor?.isEditable) return;
    coverPageHiddenRef.current = hidden;
    setCoverPageHidden(hidden);
    setDocumentState((previous) => ({
      ...previous,
      isDirty: true,
      status: hidden ? "Page de garde masquée" : "Page de garde affichée",
    }));
  }, [activeCommentId, editor]);

  const saveAiSettings = useCallback(async () => {
    try {
      const savedConfig = await writeAiConfig({
        prompts: aiDraft.prompts,
      });
      setAiConfig(savedConfig);
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
    if (!editor || versionTransition.current || documentSavePending.current || documentLoadPending.current) {
      return;
    }
    documentLoadPending.current = true;
    try {
    if (!(await askToDiscardChanges())) return;
    await cloudProjectRuntime.close();
    projectVersionsRef.current = null; setProjectVersions(null);
    editor.setEditable(true);

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
    } catch {
      setDocumentState((previous) => ({ ...previous, status: "Autosave indisponible" }));
    }
    } finally { documentLoadPending.current = false; }
  }, [askToDiscardChanges, createDocument, editor, refreshEditorState]);

  const openDocumentAtPath = useCallback(async (path: string) => {
    if (!editor || versionTransition.current || documentSavePending.current || documentLoadPending.current) {
      return;
    }
    documentLoadPending.current = true;
    try {
      if (!(await askToDiscardChanges())) return;
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
    } finally { documentLoadPending.current = false; }
  }, [askToDiscardChanges, editor, persistRecovery, rememberRecentScenario, replaceDocument, showError]);

  const openDocument = useCallback(async () => {
    const path = await chooseScenarioToOpen();
    if (path) {
      await openDocumentAtPath(path);
    }
  }, [openDocumentAtPath]);

  const importPortableDocument = useCallback(async (format: InterchangeFormat) => {
    if (!editor || versionTransition.current || documentSavePending.current || documentLoadPending.current) return;
    documentLoadPending.current = true;
    try {
      const selected = await chooseInterchangeToOpen(format);
      if (!selected) return;
      const imported = await importInterchange(format, selected.bytes, selected.name);
      if (!(await askToDiscardChanges())) return;
      replaceDocument(imported, null);
      setDocumentState(previous => ({
        ...previous,
        title: imported.title,
        filePath: null,
        isDirty: true,
        status: `${INTERCHANGE_FORMATS[format].label} importé — enregistre le projet en .scenario`,
      }));
      try {
        await writeAutosave(serializeRecoveryFile(imported, null));
      } catch {
        setDocumentState(previous => ({ ...previous, status: `${INTERCHANGE_FORMATS[format].label} importé (autosave indisponible)` }));
      }
    } catch (error) {
      await showError(error);
    } finally {
      documentLoadPending.current = false;
    }
  }, [askToDiscardChanges, editor, replaceDocument, showError]);

  const openPdfDocument = useCallback(async () => {
    setFileMenuOpen(false);
    setFileSubmenu(null);
    setPdfImportError("");
    setPdfImportOpen(true);
  }, []);

  const selectPdfForImport = useCallback(async () => {
    try {
      const path = await choosePdfToOpen();
      if (path) { setPdfImportPath(path); setPdfImportError(''); }
    } catch (error) { setPdfImportError(error instanceof Error ? error.message : 'PDF indisponible.'); }
  }, []);

  const importSelectedPdf = useCallback(async () => {
    if (!editor || !(await askToDiscardChanges()) || !pdfImportPath) return;
    setPdfImportBusy(true);
    setPdfImportError("");
    try {
      const rawText = await extractPdfText(pdfImportPath);
      const response = await importPdfScenario(rawText);
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

        // Never silently replace a newer recovery (including newly created
        // versions) with an older manual save. Preserve both when identities differ.
        if (recovery.filePath) {
          try {
            const disk = parseScenarioFile(await readScenario(recovery.filePath));
            const sameProject = recovery.document.projectId && disk.projectId
              ? recovery.document.projectId === disk.projectId : recovery.document.title === disk.title;
            if (!sameProject || !(Date.parse(recovery.document.savedAt) > Date.parse(disk.savedAt))) {
              await writeBackup(JSON.stringify(recovery.document, null, 2));
              documentToRestore = disk;
            }
          } catch {
            // Le fichier peut avoir été déplacé ou supprimé : l'autosave reste
            // alors le meilleur moyen de restaurer le travail de l'auteur.
          }
        }

        replaceDocument(documentToRestore, recovery.filePath);
        if (documentToRestore === recovery.document && recovery.filePath) {
          setDocumentState(previous => ({ ...previous, isDirty: true, status: 'Récupération restaurée — enregistrez le projet' }));
        }
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
          prompts: config.prompts,
        });
      })
      .catch(() => {
        const defaultConfig = createDefaultAiConfig();
        setAiConfig(defaultConfig);
        setAiDraft({
          prompts: defaultConfig.prompts,
        });
      });
  }, []);

  useEffect(() => {
    if (!editor || !documentState.isDirty) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (versionTransition.current) return;
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
    versionBusy,
    projectVersions,
    documentRevision,
    comments,
    coverPage,
    coverPageHidden,
  ]);

  useEffect(() => {
    writeLocalSetting("scenario-zoom", String(zoom));
  }, [zoom]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const repaginate = () => {
      if (!cancelled && !editor.isDestroyed) refreshPagination(editor);
    };
    // A self-hosted font can finish loading after the initial pagination.
    void document.fonts.ready.then(repaginate);
    document.fonts.addEventListener('loadingdone', repaginate);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener('loadingdone', repaginate);
    };
  }, [editor, refreshPagination]);

  useEffect(() => {
    if (editor) {
      refreshPagination(editor);
    }
  }, [editor, refreshPagination, zoom]);

  useLayoutEffect(() => {
    if (!editor || !initialRecoveryFinished || cloudProjectsOpen || whiteboardOpen || breakdownOpen || technicalBreakdownOpen) return;
    // Les workspaces secondaires retirent l'éditeur du layout. Dès que le
    // scénario redevient visible, mesurer au prochain frame évite de conserver
    // les dimensions du workspace précédent dans le compteur de pages.
    refreshPagination(editor);
  }, [breakdownOpen, cloudProjectsOpen, editor, initialRecoveryFinished, refreshPagination, technicalBreakdownOpen, whiteboardOpen]);

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
          if (closeInProgress.current || versionTransition.current || documentSavePending.current || documentLoadPending.current) {
            return;
          }

          closeInProgress.current = true;
          let saveBeforeClosing: boolean;
          try {
            saveBeforeClosing = await confirm(
              "Voulez-vous enregistrer le projet avant de quitter ?",
              {
                title: "senario",
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
          } else {
            // An explicit discard must not be restored as a newer autosave.
            // Keep a recoverable backup of all branches before clearing it.
            try {
              await writeBackup(JSON.stringify(createDocument(editor, currentDocumentState.current.title), null, 2));
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
      if (versionTransition.current) { event.preventDefault(); return; }
      if (document.querySelector('[aria-label="Versions du projet"]')) return;
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
        openCurrentPdfExport();
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
    openCurrentPdfExport,
    openFindReplace,
    openDocument,
    openCommentComposer,
    resetZoom,
    saveDocument,
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
    setFileSubmenu(null);
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

  const navigateToScene = useCallback((sceneId: string) => {
    if (!canUseSceneTimeline || !editor || editor.isDestroyed) return;
    const scene = getScenarioScenes(editor.state.doc).find(item => item.id === sceneId);
    if (!scene) return;
    const heading = editor.view.nodeDOM(scene.from);
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, scene.from + 1)),
    );
    setActiveSceneId(scene.id);
    requestAnimationFrame(() => {
      if (heading instanceof Element) {
        heading.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
    });
  }, [canUseSceneTimeline, editor]);

  const moveSceneFromTimeline = useCallback((sceneId: string, destinationBoundary: number) => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    if (moveScenarioScene(editor, sceneId, destinationBoundary)) {
      setActiveSceneId(sceneId);
      setDocumentState(previous => ({
        ...previous,
        isDirty: true,
        status: 'Scène déplacée',
      }));
    }
  }, [canUseSceneTimeline, editor]);

  const deleteSceneFromTimeline = useCallback(async (scene: ScenarioScene) => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    const shouldDelete = isTauri() ? await confirm(
      `Supprimer la scène ${scene.index + 1} « ${scene.title} » et tout son contenu ?`,
      {
        title: 'Supprimer une scène',
        kind: 'warning',
        okLabel: 'Supprimer',
        cancelLabel: 'Annuler',
      },
    ) : window.confirm(`Supprimer la scène ${scene.index + 1} « ${scene.title} » et tout son contenu ?`);
    if (!shouldDelete || !editor?.isEditable) return;

    const deletedBlockIds = new Set(scene.blockIds);
    const previousComments = commentsRef.current;
    const remainingComments = previousComments.filter(thread => !deletedBlockIds.has(thread.anchor.blockId));
    // onTransaction must reconcile only surviving comments against the new
    // document; comments inside the deleted scene disappear with that scene.
    commentsRef.current = remainingComments;
    if (!deleteScenarioScene(editor, scene.id)) {
      commentsRef.current = previousComments;
      return;
    }
    setComments(remainingComments);
    setActiveCommentId(current => current && remainingComments.some(thread => thread.id === current) ? current : null);
    setDocumentState(previous => ({
      ...previous,
      isDirty: true,
      status: 'Scène supprimée',
    }));
  }, [canUseSceneTimeline, editor]);

  const openWhiteboardView = useCallback(() => {
    setViewMenuOpen(false);
    if (!canUseSceneTimeline) {
      setAccountPanelOpen(true);
      setDocumentState(previous => ({
        ...previous,
        status: 'Le Whiteboard est disponible avec l’offre Studio',
      }));
      return;
    }
    setFileMenuOpen(false);
    setCoverMenuOpen(false);
    setAiPromptMenuOpen(false);
    setTransitionMenuOpen(false);
    setScenarioContextMenu(null);
    setCommentActionTarget(null);
    setCloudProjectsOpen(false);
    setBreakdownOpen(false);
    setTechnicalBreakdownOpen(false);
    setWhiteboardOpen(true);
  }, [canUseSceneTimeline]);

  const openBreakdownView = useCallback(() => {
    setViewMenuOpen(false);
    setFileMenuOpen(false);
    setCoverMenuOpen(false);
    setAiPromptMenuOpen(false);
    setTransitionMenuOpen(false);
    setScenarioContextMenu(null);
    setCommentActionTarget(null);
    setCloudProjectsOpen(false);
    setWhiteboardOpen(false);
    setTechnicalBreakdownOpen(false);
    setBreakdownOpen(true);
  }, []);

  const openTechnicalBreakdownView = useCallback(() => {
    setViewMenuOpen(false);
    setFileMenuOpen(false);
    setCoverMenuOpen(false);
    setAiPromptMenuOpen(false);
    setTransitionMenuOpen(false);
    setScenarioContextMenu(null);
    setCommentActionTarget(null);
    setCloudProjectsOpen(false);
    setWhiteboardOpen(false);
    setBreakdownOpen(false);
    setTechnicalBreakdownOpen(true);
  }, []);

  const openCloudView = useCallback(() => {
    setViewMenuOpen(false);
    setFileMenuOpen(false);
    setCoverMenuOpen(false);
    setAiPromptMenuOpen(false);
    setTransitionMenuOpen(false);
    setScenarioContextMenu(null);
    setCommentActionTarget(null);
    setWhiteboardOpen(false);
    setBreakdownOpen(false);
    setTechnicalBreakdownOpen(false);
    setCloudProjectsOpen(true);
  }, []);

  const updateSceneBreakdown = useCallback((sceneId: string, breakdown: SceneBreakdownData) => {
    if (!editor?.isEditable || versionTransition.current) return;
    if (updateScenarioBreakdown(editor, sceneId, breakdown)) {
      setDocumentState(previous => ({ ...previous, isDirty: true, status: 'Dépouillement mis à jour' }));
    }
  }, [editor]);

  const updateSceneBreakdowns = useCallback((breakdowns: Record<string, SceneBreakdownData>) => {
    if (!editor?.isEditable || versionTransition.current) return;
    if (updateScenarioBreakdowns(editor, breakdowns)) {
      setDocumentState(previous => ({ ...previous, isDirty: true, status: 'Dépouillement mis à jour' }));
    }
  }, [editor]);

  const updateProjectTechnicalBreakdown = useCallback((value: TechnicalBreakdownData) => {
    if (!editor?.isEditable || versionTransition.current) return;
    if (updateTechnicalBreakdown(editor, value)) {
      setDocumentState(previous => ({ ...previous, isDirty: true, status: 'Découpage technique mis à jour' }));
    }
  }, [editor]);

  useEffect(() => {
    if ((!breakdownOpen && !technicalBreakdownOpen) || !editor) return;
    const handleBreakdownUndo = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLocaleLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      if (event.shiftKey) editor.commands.redo();
      else editor.commands.undo();
    };
    window.addEventListener('keydown', handleBreakdownUndo);
    return () => window.removeEventListener('keydown', handleBreakdownUndo);
  }, [breakdownOpen, editor, technicalBreakdownOpen]);

  const moveScenesFromWhiteboard = useCallback((
    sceneIds: string[],
    act: ScenarioAct,
    destinationBoundary: number,
  ) => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    if (moveScenarioSceneGroup(editor, sceneIds, act, destinationBoundary)) {
      setActiveSceneId(sceneIds[0] ?? null);
      setDocumentState(previous => ({
        ...previous,
        isDirty: true,
        status: sceneIds.length > 1 ? `${sceneIds.length} scènes déplacées` : 'Scène déplacée',
      }));
    }
  }, [canUseSceneTimeline, editor]);

  const updateSceneFromWhiteboard = useCallback((
    sceneId: string,
    metadata: SceneWhiteboardMetadata,
  ): boolean => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return false;
    const updated = updateScenarioScene(editor, sceneId, metadata);
    if (updated) {
      setDocumentState(previous => ({
        ...previous,
        isDirty: true,
        status: 'Carte de scène actualisée',
      }));
    }
    return updated;
  }, [canUseSceneTimeline, editor]);

  const duplicateSceneFromWhiteboard = useCallback((sceneId: string) => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    const duplicateId = duplicateScenarioScene(editor, sceneId);
    if (!duplicateId) return;
    setActiveSceneId(duplicateId);
    setDocumentState(previous => ({
      ...previous,
      isDirty: true,
      status: 'Scène dupliquée',
    }));
  }, [canUseSceneTimeline, editor]);

  const addSceneFromWhiteboard = useCallback((act: ScenarioAct) => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    const sceneId = addScenarioScene(editor, act);
    if (!sceneId) return;
    setActiveSceneId(sceneId);
    setDocumentState(previous => ({ ...previous, isDirty: true, status: `Scène ajoutée à l’acte ${act}` }));
  }, [canUseSceneTimeline, editor]);

  const addActFromWhiteboard = useCallback(() => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    if (addScenarioAct(editor)) {
      setDocumentState(previous => ({
        ...previous,
        isDirty: true,
        status: 'Acte ajouté',
      }));
    }
  }, [canUseSceneTimeline, editor]);

  const updateActDescriptionFromWhiteboard = useCallback((act: ScenarioAct, description: string) => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    if (updateScenarioActDescription(editor, act, description)) {
      setDocumentState(previous => ({
        ...previous,
        isDirty: true,
        status: `Description de l’acte ${act} actualisée`,
      }));
    }
  }, [canUseSceneTimeline, editor]);

  const deleteActFromWhiteboard = useCallback(async (act: ScenarioAct) => {
    if (!canUseSceneTimeline || !editor?.isEditable || versionTransition.current) return;
    const affectedScenes = getScenarioScenes(editor.state.doc).filter(scene => scene.act === act).length;
    const destination = act > 1 ? `l’acte ${act - 1}` : 'le nouvel acte 1';
    const prompt = affectedScenes
      ? `Supprimer l’acte ${act} ? Ses ${affectedScenes} scène${affectedScenes > 1 ? 's' : ''} seront conservées et rattachées à ${destination}.`
      : `Supprimer l’acte ${act} ?`;
    const shouldDelete = isTauri() ? await confirm(prompt, {
      title: 'Supprimer un acte',
      kind: 'warning',
      okLabel: 'Supprimer l’acte',
      cancelLabel: 'Annuler',
    }) : window.confirm(prompt);
    if (!shouldDelete || !editor.isEditable) return;
    if (deleteScenarioAct(editor, act)) {
      setDocumentState(previous => ({
        ...previous,
        isDirty: true,
        status: affectedScenes ? 'Acte supprimé, scènes conservées' : 'Acte supprimé',
      }));
    }
  }, [canUseSceneTimeline, editor]);

  const openSceneFromWhiteboard = useCallback((sceneId: string) => {
    setWhiteboardOpen(false);
    requestAnimationFrame(() => navigateToScene(sceneId));
  }, [navigateToScene]);

  const openSceneFromBreakdown = useCallback((sceneId: string) => {
    setBreakdownOpen(false);
    requestAnimationFrame(() => navigateToScene(sceneId));
  }, [navigateToScene]);

  const cloudEditor: CloudProjectEditor = {
    read: () => editor?.getJSON() ?? initialContent,
    readFile: () => {
      if (!editor || editor.isDestroyed) throw new Error('Éditeur indisponible.');
      return createDocument(editor, currentDocumentState.current.title);
    },
    openFile: (file) => replaceDocument(file, null, true),
    replaceMetadata: (metadata) => {
      if (!editor || editor.isDestroyed) return;
      const anchored = resolveProjectCommentAnchors(metadata.comments, editor.getJSON());
      coverPageRef.current = metadata.coverPage;
      coverPageHiddenRef.current = metadata.coverPageHidden;
      commentsRef.current = anchored;
      currentDocumentState.current = { ...currentDocumentState.current, title: metadata.title };
      setCoverPage(metadata.coverPage); setCoverDraft(metadata.coverPage);
      setCoverPageHidden(metadata.coverPageHidden); setComments(anchored);
      setDocumentState((previous) => ({ ...previous, title: metadata.title }));
      syncProjectCommentMarks(editor, anchored);
    },
    replaceDocument: (document, initial) => {
      if (!editor || editor.isDestroyed) return;
      isReplacingDocument.current = true;
      try {
        const transaction = collaborationTransaction(editor.state, document);
        if (transaction) editor.view.dispatch(transaction);
        if (!transaction && !initial) return;
        ensureScenarioBlockIds(editor);
        const anchored = resolveProjectCommentAnchors(commentsRef.current, editor.getJSON());
        commentsRef.current = anchored; setComments(anchored);
        syncProjectCommentMarks(editor, anchored);
        setDocumentState((previous) => ({ ...previous, ...(initial ? { filePath: null } : {}), isDirty: true, status: 'Projet cloud actualisé' }));
      } finally { isReplacingDocument.current = false; }
    },
    subscribe: (listener) => {
      collaborationListeners.current.add(listener);
      return () => { collaborationListeners.current.delete(listener); };
    },
    setReadOnly: (value) => { editor?.setEditable(!value); setCloudReadOnly(value); },
  };

  const coverPagePresent = hasCoverPageContent(coverPage);
  const statistics = getDocumentStatistics(editor?.getJSON() ?? initialContent);
  const timelineScenes = editor ? getScenarioScenes(editor.state.doc) : [];
  const projectBreakdowns = editor ? getProjectBreakdowns(editor.state.doc) : {};
  const projectTechnicalBreakdown = editor ? getTechnicalBreakdown(editor.state.doc) : { version: 1, columns: [], shots: [] } as TechnicalBreakdownData;
  const scenarioCharacters = editor ? getScenarioCharacters(editor.state.doc) : [];
  const scenarioActCount = editor ? getScenarioActCount(editor.state.doc) : 3;
  const scenarioActDescriptions = editor ? getScenarioActDescriptions(editor.state.doc) : [];
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

  async function exportWorkspacePdf(request: WorkspacePdfExportRequest): Promise<void> {
    if (!editor || workspacePdfExportBusy || documentSavePending.current || versionTransition.current) return;
    documentSavePending.current = true;
    setWorkspacePdfExportBusy(true);
    try {
      const workspace = request.kind === 'breakdown' ? 'depouillement' : 'decoupage-technique';
      const path = await chooseWorkspacePdfToSave(documentState.title, workspace);
      if (!path) return;
      const { createBreakdownPdf, createTechnicalBreakdownPdf } = await import('./document/workspacePdfExport');
      const contents = request.kind === 'breakdown'
        ? await createBreakdownPdf(documentState.title, timelineScenes, projectBreakdowns, request.options)
        : await createTechnicalBreakdownPdf(documentState.title, timelineScenes, projectTechnicalBreakdown, request.options);
      await writePdf(path, contents);
      setWorkspacePdfExportKind(null);
      setDocumentState(previous => ({
        ...previous,
        status: request.kind === 'breakdown' ? 'Dépouillement PDF exporté' : 'Découpage technique PDF exporté',
      }));
    } catch (error) {
      await showError(error);
    } finally {
      setWorkspacePdfExportBusy(false);
      documentSavePending.current = false;
    }
  }

  if (!initialRecoveryFinished) {
    return <div className="app-shell theme-dark initial-recovery-shell" role="status" aria-live="polite">
      <div className="initial-recovery-screen">
        <img src="/senario-logo.png" alt="" width="34" height="34" />
        <span>Restauration du projet…</span>
      </div>
    </div>;
  }

  return (
    <div
      ref={appShellRef}
      className={`app-shell theme-dark${cloudProjectsOpen || breakdownOpen || technicalBreakdownOpen ? ' has-no-workspace-toolbar' : ''}`}
      onKeyDownCapture={event => { if (versionTransition.current) { event.preventDefault(); event.stopPropagation(); } }}
      onMouseMove={(event) => {
        aiPointerPosition.current = {
          clientX: event.clientX,
          clientY: event.clientY,
        };
        refreshAiTarget(event.target, event.clientX, event.clientY);
      }}
      onMouseLeave={() => {
        aiPointerPosition.current = null;
        setAiPromptMenuOpen(false);
        setTransitionMenuOpen(false);
        setCustomTransitionOpen(false);
        setCustomTransitionText("");
        if (!aiBusy) setAiTarget(null);
      }}
    >
      <header className="menu-bar">
        <div className="app-brand" title="senario — la meilleure page blanche">
          <img src="/senario-logo.png" alt="" width="28" height="28" />
          <span>senario</span>
        </div>
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
                <button type="button" role="menuitem" onClick={() => runFileAction(async () => { await saveDocument(); })}>
                  Enregistrer <kbd>Ctrl+S</kbd>
                </button>
                <button type="button" role="menuitem" onClick={() => runFileAction(async () => { await saveDocument(true); })}>
                  Enregistrer sous… <kbd>Ctrl+Maj+S</kbd>
                </button>
                <hr />
                {!cloudProjectsOpen && !whiteboardOpen && <div
                  className="file-menu-branch"
                  onMouseEnter={() => setFileSubmenu("export")}
                  onMouseLeave={() => setFileSubmenu(null)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setFileSubmenu(null);
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={fileSubmenu === "export"}
                    onFocus={() => setFileSubmenu("export")}
                    onClick={() => setFileSubmenu("export")}
                  >
                    <span>Exporter</span><UiIcon name="chevron" />
                  </button>
                  {fileSubmenu === "export" && (
                    <div className="file-submenu" role="menu" aria-label="Formats d’export">
                      <button type="button" role="menuitem" onClick={openCurrentPdfExport}>
                        Exporter en PDF <kbd>Ctrl+Maj+E</kbd>
                      </button>
                      {!breakdownOpen && !technicalBreakdownOpen && <>
                        <button type="button" role="menuitem" disabled={!canUseProfessionalFormats} title={!canUseProfessionalFormats ? "Disponible avec l’offre Studio" : undefined} onClick={() => openExportDialog("fdx")}>
                          <span>Final Draft (FDX)</span>{!canUseProfessionalFormats && <span className="studio-feature-badge">Studio</span>}
                        </button>
                        <button type="button" role="menuitem" disabled={!canUseProfessionalFormats} title={!canUseProfessionalFormats ? "Disponible avec l’offre Studio" : undefined} onClick={() => openExportDialog("fountain")}>
                          <span>Fountain</span>{!canUseProfessionalFormats && <span className="studio-feature-badge">Studio</span>}
                        </button>
                        <button type="button" role="menuitem" disabled={!canUseProfessionalFormats} title={!canUseProfessionalFormats ? "Disponible avec l’offre Studio" : undefined} onClick={() => openExportDialog("docx")}>
                          <span>Word (DOCX)</span>{!canUseProfessionalFormats && <span className="studio-feature-badge">Studio</span>}
                        </button>
                      </>}
                    </div>
                  )}
                </div>}
                {!cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen && <div
                  className="file-menu-branch"
                  onMouseEnter={() => setFileSubmenu("import")}
                  onMouseLeave={() => setFileSubmenu(null)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setFileSubmenu(null);
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={fileSubmenu === "import"}
                    onFocus={() => setFileSubmenu("import")}
                    onClick={() => setFileSubmenu("import")}
                  >
                    <span>Importer</span><UiIcon name="chevron" />
                  </button>
                  {fileSubmenu === "import" && (
                    <div className="file-submenu" role="menu" aria-label="Formats d’import">
                      <button type="button" role="menuitem" onClick={() => runFileAction(openPdfDocument)}>PDF</button>
                      <button type="button" role="menuitem" onClick={() => runFileAction(() => importPortableDocument("fdx"))}>Final Draft (FDX)</button>
                      <button type="button" role="menuitem" onClick={() => runFileAction(() => importPortableDocument("fountain"))}>Fountain</button>
                      <button type="button" role="menuitem" onClick={() => runFileAction(() => importPortableDocument("docx"))}>Word (DOCX)</button>
                    </div>
                  )}
                </div>}
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
                {cloudReadOnly && <p role="status">Ce projet est en lecture seule.</p>}
                <fieldset disabled={cloudReadOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
                </fieldset>
                <footer>
                  <button type="button" onClick={() => setCoverMenuOpen(false)}>Fermer</button>
                  <button className="primary-button" type="submit" disabled={cloudReadOnly}>Appliquer</button>
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
          <div className="menu-version-control">
            <ProjectVersionControl
              versions={listedProjectVersions.length
                ? listedProjectVersions.filter(version => !version.deletedAt).map(version => ({ id: version.id, name: version.name }))
                : [{ id: 'initial', name: 'Version 1' }]}
              activeId={listedActiveVersionId ?? 'initial'}
              title={!canUseProjectVersions ? 'Versions — disponible avec l’offre Studio' : cloudVersionLocked ? 'Chargement des versions cloud…' : 'Choisir une version de ce projet'}
              disabled={(!canUseProjectVersions && !versionCloudState.project) || versionBusy || (cloudReadOnly && !versionCloudState.project) || cloudVersionLocked || aiBusy || pdfExportBusy || pdfImportBusy || Boolean(commentEditingRequestId)}
              canCreate={canUseProjectVersions && !cloudReadOnly}
              canRename={canUseProjectVersions && !cloudReadOnly}
              canDelete={canUseProjectVersions && !cloudReadOnly && (!versionCloudState.project || versionCloudState.project.role === 'owner') && listedProjectVersions.filter(version => !version.deletedAt).length >= 2}
              locked={!canUseProjectVersions && !versionCloudState.project}
              onSelect={id => changeProjectVersion(id)}
              onDuplicate={() => changeProjectVersion('duplicate', nextAvailableVersionName(), listedActiveVersionId ?? '')}
              onBlank={() => changeProjectVersion('blank', nextAvailableVersionName())}
              onRename={(id, name) => changeProjectVersion('rename', name, id)}
              onDelete={id => changeProjectVersion('delete', '', id)}
            />
          </div>
        </nav>
      </header>

      {!cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen ? (
      <div className="formatting-toolbar" role="toolbar" aria-label="Mise en forme">
        <button
          className={editor?.isActive("bold") ? "is-active" : ""}
          type="button"
          aria-label="Mettre en gras"
          title="Gras (Ctrl+B)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleBold}
        >
          <UiIcon name="bold"/>
        </button>
        <button className={editor?.isActive('italic') ? 'is-active' : ''} type="button"
          disabled={cloudReadOnly} aria-label="Mettre en italique" aria-pressed={editor?.isActive('italic') ?? false}
          title="Italique (Ctrl+I)" onMouseDown={event => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleItalic().run()}><UiIcon name="italic"/></button>
        <button
          className={editor?.isActive("underline") ? "is-active" : ""}
          type="button"
          aria-label="Souligner"
          title="Souligné (Ctrl+U)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleUnderline}
        >
          <UiIcon name="underline"/>
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <span className="document-title" title={documentState.title}>
          {documentState.title}{documentState.isDirty ? " *" : ""}
        </span>
        <UiSelect className="paragraph-type-control" aria-label="Type de paragraphe" value={currentType}
          disabled={cloudReadOnly} onChange={event => {
            if (editor?.isEditable) {
              editor.commands.setScenarioElementType(toScenarioElementType(event.target.value));
              editor.view.focus();
              refreshEditorState(editor);
            }
          }}>{SCENARIO_ELEMENT_TYPES.map(type => <option value={type} key={type}>{getScenarioElementLabel(type)}</option>)}</UiSelect>
        <div className="document-status">
          <CloudProjectStatus onOpen={openCloudView} />
          <span className="document-save-status" title={documentState.status}>{documentState.status}</span>
          <span>Page {currentPage + (coverPageVisible ? 1 : 0)}/{documentSheetCount}</span>
          <button className="zoom-reset" type="button" onClick={resetZoom} title="Taille réelle (Ctrl+0)" aria-label={`Zoom ${zoom} %, rétablir la taille réelle`}>{zoom} %</button>
        </div>
      </div>
      ) : whiteboardOpen ? (
        <div className="whiteboard-mode-toolbar" aria-label="Vue Whiteboard active">
          <UiIcon name="whiteboard" />
          <span className="document-title" title={documentState.title}>{documentState.title}{documentState.isDirty ? " *" : ""}</span>
          <button
            className="whiteboard-add-act"
            type="button"
            disabled={!editor?.isEditable || scenarioActCount >= MAX_SCENARIO_ACT_COUNT}
            onClick={addActFromWhiteboard}
          ><UiIcon name="plus" /> Ajouter un acte</button>
          <div className="whiteboard-mode-actions">
            <button type="button" disabled={!editor?.can().undo() || !editor?.isEditable} onClick={() => editor?.commands.undo()}>Annuler <kbd>Ctrl+Z</kbd></button>
            <button type="button" disabled={!editor?.can().redo() || !editor?.isEditable} onClick={() => editor?.commands.redo()}>Rétablir <kbd>Ctrl+Maj+Z</kbd></button>
          </div>
          <div className="document-status">
            <CloudProjectStatus onOpen={openCloudView} />
            <span className="document-save-status" title={documentState.status}>{documentState.status}</span>
          </div>
        </div>
      ) : null}

      {versionError && <div className="modal-backdrop"><section className="pdf-export-panel" role="alertdialog" aria-modal="true" aria-label="Version inchangée">
        <h2>Version inchangée</h2><p role="alert">{versionError}</p>
        <div className="panel-actions"><button autoFocus type="button" onClick={() => setVersionError('')}>Fermer</button></div>
      </section></div>}

      {commentActionTarget && !commentEditingRequestId && !cloudReadOnly && !cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen && (
        <button
          className="comment-inline-button"
          type="button"
          aria-label="Ajouter un commentaire"
          title="Ajouter un commentaire"
          style={{ left: commentActionTarget.left, top: commentActionTarget.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void openCommentComposer()}
        >
          <UiIcon name="message"/>
        </button>
      )}
      <div className="workspace-page-stack">
      <main
        className={`workspace has-scene-timeline${cloudProjectsOpen || whiteboardOpen || breakdownOpen || technicalBreakdownOpen ? ' is-workspace-page-hidden' : ''}`}
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
        onWheel={handleWorkspaceWheel}
        onContextMenu={openScenarioContextMenu}
      >
        {canUseSceneTimeline ? (
          <SceneTimeline
            scenes={timelineScenes}
            activeSceneId={activeSceneId}
            readOnly={!editor?.isEditable || versionBusy || versionTransition.current}
            onNavigate={navigateToScene}
            onMove={moveSceneFromTimeline}
            onDelete={scene => void deleteSceneFromTimeline(scene)}
          />
        ) : (
          <aside className="scene-timeline scene-timeline-locked" aria-label="Timeline des scènes — offre Studio">
            <header>
              <div>
                <h2>Timeline</h2>
              </div>
              <span className="studio-feature-badge">Studio</span>
            </header>
            <div className="scene-timeline-lock-message">
              <p>La timeline et la réorganisation des scènes sont disponibles avec l’offre Studio.</p>
              <button type="button" onClick={() => setAccountPanelOpen(true)}>Voir mon compte</button>
            </div>
          </aside>
        )}
        <div className={`editor-stage ${comments.length ? 'has-comment-margin' : ''}`}>
        {editor && <CommentMargin editor={editor} threads={comments} readOnly={cloudReadOnly}
          activeId={activeCommentId} onActivate={(thread) => navigateToComment(thread, true)} onDeactivate={() => setActiveCommentId(null)} zoom={zoom}
          startEditingId={commentEditingRequestId} onStartEditingHandled={() => setCommentEditingRequestId(null)}
          onUpdate={updateCommentThread} onDelete={id => void deleteCommentThread(id)} />}
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
        </div>
      </main>
      {cloudProjectsOpen && <CloudProjectsPanel
        embedded
        apiFactory={() => createRuntimeCommercialApi(async () => {
          await cloudProjectRuntime.close();
          authenticatedOperations.stop();
          await sessions.invalidate();
          setCloudProjectsOpen(false);
          setAccountPanelOpen(true);
        })}
        editor={cloudEditor}
        onClose={() => setCloudProjectsOpen(false)}
        onSignIn={() => {
          setCloudProjectsOpen(false);
          setAccountPanelOpen(true);
        }}
      />}
      {whiteboardOpen && canUseSceneTimeline && (
        <SceneWhiteboard
          scenes={timelineScenes}
          actCount={scenarioActCount}
          actDescriptions={scenarioActDescriptions}
          readOnly={!editor?.isEditable || versionBusy || versionTransition.current}
          canUndo={Boolean(editor?.can().undo())}
          canRedo={Boolean(editor?.can().redo())}
          onOpen={openSceneFromWhiteboard}
          onMove={moveScenesFromWhiteboard}
          onUpdate={updateSceneFromWhiteboard}
          onDuplicate={duplicateSceneFromWhiteboard}
          onAddScene={addSceneFromWhiteboard}
          onDelete={scene => void deleteSceneFromTimeline(scene)}
          onDeleteAct={act => void deleteActFromWhiteboard(act)}
          onUpdateActDescription={updateActDescriptionFromWhiteboard}
          onUndo={() => { editor?.commands.undo(); }}
          onRedo={() => { editor?.commands.redo(); }}
        />
      )}
      {breakdownOpen && (
        <SceneBreakdown
          scenes={timelineScenes}
          document={editor.state.doc}
          breakdowns={projectBreakdowns}
          activeSceneId={activeSceneId}
          readOnly={!editor?.isEditable || versionBusy || versionTransition.current}
          onOpenScene={openSceneFromBreakdown}
          onChange={updateSceneBreakdown}
          onChangeMany={updateSceneBreakdowns}
        />
      )}
      {technicalBreakdownOpen && (
        <TechnicalBreakdown
          scenes={timelineScenes}
          document={editor.state.doc}
          breakdown={projectTechnicalBreakdown}
          characters={scenarioCharacters}
          activeSceneId={activeSceneId}
          readOnly={!editor?.isEditable || versionBusy || versionTransition.current}
          canUndo={Boolean(editor?.can().undo())}
          canRedo={Boolean(editor?.can().redo())}
          onChange={updateProjectTechnicalBreakdown}
          onUndo={() => { editor?.commands.undo(); }}
          onRedo={() => { editor?.commands.redo(); }}
        />
      )}
      </div>
      <footer className="application-bottom-bar">
        <div className="bottom-license-status"><OfflineLicenseStatus /></div>
        <nav className="workspace-page-navigation" aria-label="Pages de l’application">
          <button
            className={cloudProjectsOpen ? 'is-active' : ''}
            type="button"
            aria-current={cloudProjectsOpen ? 'page' : undefined}
            onClick={openCloudView}
          >
            <UiIcon name="folder" />
            <span>Cloud</span>
          </button>
          <button
            className={whiteboardOpen ? 'is-active' : ''}
            type="button"
            aria-current={whiteboardOpen ? 'page' : undefined}
            onClick={openWhiteboardView}
          >
            <UiIcon name="whiteboard" />
            <span>Whiteboard</span>
          </button>
          <button
            className={!cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen ? 'is-active' : ''}
            type="button"
            aria-current={!cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen ? 'page' : undefined}
            onClick={() => { setCloudProjectsOpen(false); setWhiteboardOpen(false); setBreakdownOpen(false); setTechnicalBreakdownOpen(false); }}
          >
            <UiIcon name="screenplay" />
            <span>Scénario</span>
          </button>
          <button
            className={breakdownOpen ? 'is-active' : ''}
            type="button"
            aria-current={breakdownOpen ? 'page' : undefined}
            onClick={openBreakdownView}
          >
            <UiIcon name="breakdown" />
            <span>Dépouillement</span>
          </button>
          <button
            className={technicalBreakdownOpen ? 'is-active' : ''}
            type="button"
            aria-current={technicalBreakdownOpen ? 'page' : undefined}
            onClick={openTechnicalBreakdownView}
          >
            <UiIcon name="list" />
            <span>Découpage technique</span>
          </button>
        </nav>
        <div className="editor-statistics" aria-label="Statistiques du scénario">
          <div id="workspace-bottom-actions" className="workspace-bottom-actions" />
          <span><strong>{statistics.words}</strong> mots</span>
          <span title="Estimation indicative : une page de scénario correspond à environ une minute à l’écran.">Temps : <strong>≈ {statistics.words ? pageCount : 0} min</strong></span>
          <span><strong>{documentSheetCount}</strong> pages</span>
          <span><strong>{statistics.scenes}</strong> scènes</span>
          <span><strong>{statistics.locations}</strong> décors</span>
        </div>
      </footer>

      {!cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen && smartType && (
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

      {!cloudProjectsOpen && !whiteboardOpen && !breakdownOpen && !technicalBreakdownOpen && aiTarget && (
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
          <div
            className={`paragraph-action-cluster ai-action-cluster ${aiPromptMenuOpen ? "is-open" : ""}`}
            style={{
              left: aiTarget.left,
              top: aiTarget.top - 16,
              "--ai-scale": zoom / 100,
            } as CSSProperties}
            onMouseLeave={() => setAiPromptMenuOpen(false)}
          >
            <button
              className={`ai-inline-button ${aiBusy ? "is-busy" : ""}`}
              type="button"
              aria-label="Actions IA"
              title="Actions IA"
              aria-expanded={aiPromptMenuOpen}
              disabled={aiBusy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setTransitionMenuOpen(false);
                setCustomTransitionOpen(false);
                setCustomTransitionText("");
                setAiPromptMenuOpen((isOpen) => !isOpen);
              }}
            >
              <UiIcon name="star"/>
            </button>
            {aiPromptMenuOpen && (
              <div
                className="ai-popover"
                role="menu"
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
          </div>
          <div
            className={`paragraph-action-cluster transition-action-cluster ${transitionMenuOpen ? "is-open" : ""}`}
            style={{
              left: aiTarget.transitionLeft,
              top: aiTarget.top - 16,
              "--ai-scale": zoom / 100,
            } as CSSProperties}
            onMouseLeave={() => {
              setTransitionMenuOpen(false);
              setCustomTransitionOpen(false);
              setCustomTransitionText("");
            }}
          >
            <button
              className="transition-inline-button"
              type="button"
              aria-label="Ajouter une transition"
              title="Ajouter une transition"
              aria-expanded={transitionMenuOpen}
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
          </div>
        </>
      )}

      {helpOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setHelpOpen(false)}>
          <section className="help-panel" role="dialog" aria-modal="true" aria-label="Aide" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Bien démarrer avec senario</h2>
                <p>Les gestes essentiels pour écrire ton scénario.</p>
              </div>
              <button className="panel-close-button" type="button" aria-label="Fermer" onClick={() => setHelpOpen(false)}><UiIcon name="x"/></button>
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
              <p>Sélectionne un passage, puis clique sur le bouton de commentaire. Le passage est surligné en jaune et la note apparaît dans la marge gauche. Clique sur la note pour la modifier ou la supprimer.</p>
            </section>

            <section>
              <h3>Page de garde et PDF</h3>
              <p>Le bouton <strong>Page de garde</strong> sert à remplir le titre, les crédits, la production et les contacts. Ces données sont enregistrées dans ton projet et apparaissent aussi à l’export PDF.</p>
            </section>

            <section>
              <h3>Activer l’IA</h3>
              <p>Connecte-toi dans <strong>Compte et licence</strong>, puis active cet appareil. Les modèles, droits et quotas sont vérifiés par le serveur avant chaque demande.</p>
              <p>Aucune clé de fournisseur IA n’est demandée ni conservée par l’application.</p>
            </section>
            <ReleaseInfo />
          </section>
        </div>
      )}

      {accountPanelOpen && (
        <AccountLicensePanel
          onClose={() => setAccountPanelOpen(false)}
          onOpenCloud={() => { setAccountPanelOpen(false); openCloudView(); }}
        />
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
              <button className="panel-close-button" type="button" aria-label="Fermer" onClick={() => setFindReplaceOpen(false)}><UiIcon name="x"/></button>
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

      {workspacePdfExportKind && (
        <WorkspacePdfExportDialog
          key={workspacePdfExportKind}
          kind={workspacePdfExportKind}
          scenes={timelineScenes}
          breakdowns={projectBreakdowns}
          technicalBreakdown={projectTechnicalBreakdown}
          busy={workspacePdfExportBusy}
          onClose={() => { if (!workspacePdfExportBusy) setWorkspacePdfExportKind(null); }}
          onExport={request => { void exportWorkspacePdf(request); }}
        />
      )}

      {pdfExportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !pdfExportBusy && setPdfExportOpen(false)}>
          <section className="pdf-export-panel" role="dialog" aria-modal="true" aria-label={`Options d’export ${getExportFormatLabel(exportFormat)}`} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Exporter en {getExportFormatLabel(exportFormat)}</h2>
                <p>Choisis ce qui doit apparaître dans le document final.</p>
              </div>
              <button className="panel-close-button" type="button" aria-label="Fermer" disabled={pdfExportBusy} onClick={() => setPdfExportOpen(false)}><UiIcon name="x"/></button>
            </header>
            <fieldset>
              <legend>Contenu du fichier {getExportFormatLabel(exportFormat)}</legend>
              <label><input type="checkbox" checked={pdfExportDraft.includeCoverPage} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, includeCoverPage: event.target.checked }))} /> Page de garde</label>
              {exportFormat !== "docx" && (
                <label><input type="checkbox" checked={pdfExportDraft.includeSceneNumbers} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, includeSceneNumbers: event.target.checked }))} /> Numérotation de scène</label>
              )}
              {exportFormat === "pdf" && (
                <label><input type="checkbox" checked={pdfExportDraft.includePageNumbers} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, includePageNumbers: event.target.checked }))} /> Pagination</label>
              )}
            </fieldset>
            <label className="pdf-translation-field">
              Traduction du scénario
              <UiSelect aria-label="Langue de traduction" value={pdfExportDraft.translationLanguage} onChange={(event) => setPdfExportDraft((draft) => ({ ...draft, translationLanguage: event.target.value }))}>
                <option value="">Aucune traduction</option>
                {[...PDF_TRANSLATION_LANGUAGES, ...customPdfLanguages].map((language) => <option key={language} value={language}>{displayPdfLanguage(language)}</option>)}
                <option value="__custom__">Autre langue…</option>
              </UiSelect>
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
                        <button type="button" aria-label={`Retirer ${language}`} title={`Retirer ${language}`} onClick={() => removeCustomPdfLanguage(language)}><UiIcon name="x"/></button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <small>La traduction est utilisée uniquement pour cet export ; ton fichier .scenario n’est pas modifié.</small>
            </label>
            <footer>
              <button type="button" disabled={pdfExportBusy} onClick={() => setPdfExportOpen(false)}>Annuler</button>
              <button className="primary-button" type="button" disabled={pdfExportBusy} onClick={() => void exportCurrentFormat()}>
                {pdfExportBusy ? "Préparation de l’export…" : "Exporter"}
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
              <button className="panel-close-button" type="button" aria-label="Fermer" disabled={pdfImportBusy} onClick={() => setPdfImportOpen(false)}><UiIcon name="x"/></button>
            </header>
            <div
              className={`pdf-import-dropzone${pdfImportPath ? " has-file" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0] as (File & { path?: string }) | undefined;
                try {
                  if (!isTauri() && file) setPdfImportPath(registerBrowserPdf(file));
                  else if (file?.path?.toLocaleLowerCase().endsWith(".pdf")) setPdfImportPath(file.path);
                  else throw new Error('Dépose un fichier PDF ou utilise « Rechercher dans les fichiers ».');
                  setPdfImportError('');
                } catch (error) { setPdfImportError(error instanceof Error ? error.message : 'PDF indisponible.'); }
              }}
            >
              <strong>{pdfImportPath ? getFileTitle(pdfImportPath) : "Dépose ton PDF ici"}</strong>
              <span>ou</span>
              <button type="button" onClick={() => void selectPdfForImport()}>Rechercher dans les fichiers</button>
            </div>
            <div className="pdf-import-manual-help">
              <strong>Compte et appareil requis</strong>
              <p>L’import passe par l’API senario. Le serveur vérifie la session, la version, l’appareil et le quota PDF.</p>
            </div>
            {pdfImportError && <p className="form-error" role="alert">{pdfImportError}</p>}
            <footer>
              <button type="button" disabled={pdfImportBusy} onClick={() => setPdfImportOpen(false)}>Annuler</button>
              <button className="primary-button" type="button" disabled={pdfImportBusy || !pdfImportPath} onClick={() => void importSelectedPdf()}>
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
                <p>Les modèles et l’accès sont gérés par le serveur senario.</p>
              </div>
              <button
                className="panel-close-button"
                type="button"
                aria-label="Fermer"
                onClick={() => setAiSettingsOpen(false)}
              ><UiIcon name="x"/></button>
            </header>

            <AiBudgetUsage />
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
                        <UiTextarea
                          className="prompt-instruction-input"
                          aria-label="Instruction du prompt"
                          value={prompt.instruction}
                          onChange={(event) => updateAiPrompt(prompt.id, "instruction", event.target.value)}
                        />
                          {prompt.responseOnly && (
                            <span className="response-only-ghost">
                              {RESPONSE_ONLY_INSTRUCTION}
                            </span>
                          )}
                      </label>
                      <button
                        className={`response-only-toggle${prompt.responseOnly ? " is-active" : ""}`}
                        type="button"
                        aria-pressed={prompt.responseOnly}
                        onClick={() =>
                          setAiPromptResponseOnly(prompt.id, !prompt.responseOnly)
                        }
                      >
                        <span className="response-only-toggle-track" aria-hidden="true"><span className="response-only-toggle-thumb" /></span>
                        Réponse uniquement
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
                aria-label="Activer les raccourcis"
                aria-pressed={textReplacementsEnabled}
                onClick={() => setTextReplacementsEnabled((enabled) => !enabled)}
              >
                <span>Activer</span>
                <span className="shortcut-toggle-track" aria-hidden="true"><span className="shortcut-toggle-thumb" /></span>
              </button>
              <button
                className="panel-close-button"
                type="button"
                aria-label="Fermer"
                onClick={() => setTextReplacementsOpen(false)}
              ><UiIcon name="x"/></button>
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
                      <button type="button" aria-label={`Supprimer ${item.shortcut || "ce raccourci"}`} title="Supprimer" onClick={() => removeTextReplacement(item.id)}><UiIcon name="x"/></button>
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
    throw new Error("La traduction est incomplète. Le fichier n’a pas été exporté.");
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

function getExportFormatLabel(format: ExportFormat): string {
  return format === "pdf" ? "PDF" : INTERCHANGE_FORMATS[format].label;
}

function applyPortableExportOptions(document: ScenarioFile, draft: PdfExportDraft): ScenarioFile {
  const content = draft.includeSceneNumbers
    ? document.content
    : {
        ...document.content,
        content: (document.content.content ?? []).map((node) => {
          if (node.type !== "paragraph" || !node.attrs?.sceneNumber) return node;
          const attrs = { ...node.attrs };
          delete attrs.sceneNumber;
          return { ...node, attrs };
        }),
      };
  return {
    ...document,
    content,
    coverPageHidden: !draft.includeCoverPage,
  };
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
  _zoom = 100,
): HTMLElement | null {
  const paragraphs = editor.view.dom.querySelectorAll<HTMLElement>(
    'p[data-scenario-type="ACTION"]:not([data-scenario-ending]), p[data-scenario-type="DIALOGUE"]',
  );

  for (const paragraph of paragraphs) {
    const canvas = paragraph.closest(".document-canvas");
    const canvasRect = canvas?.getBoundingClientRect();
    const paragraphRect = paragraph.getBoundingClientRect();
    if (
      canvasRect &&
      clientX >= canvasRect.left &&
      clientX <= canvasRect.right &&
      clientY >= paragraphRect.top &&
      clientY <= paragraphRect.bottom
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
