import { jsPDF } from "jspdf";
import type { JSONContent } from "@tiptap/core";
import { toScenarioElementType, type ScenarioElementType } from "../editor/scenarioTypes";
import { getCoverCredits, hasCoverPageContent, type CoverPageData, type ScenarioFile } from "./scenarioFile";
import dejavuMonoRegularUrl from "./fonts/DejaVuSansMono.ttf?inline";
import dejavuMonoBoldUrl from "./fonts/DejaVuSansMono-Bold.ttf?inline";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_TOP = 25.4;
const MARGIN_RIGHT = 25.4;
const MARGIN_BOTTOM = 25.4;
const MARGIN_LEFT = 38.1;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const LINE_HEIGHT = 16 * (25.4 / 96);
const FOOTER_Y = PAGE_HEIGHT - 10;
const SCREENPLAY_FONT = "DejaVuSansMono";
const SCREENPLAY_FONT_REGULAR_FILE = "DejaVuSansMono.ttf";
const SCREENPLAY_FONT_BOLD_FILE = "DejaVuSansMono-Bold.ttf";

let embeddedFontData: Promise<{ regular: string; bold: string }> | null = null;

interface ParagraphStyle {
  x: number;
  width: number;
  topSpacing: number;
  bottomSpacing: number;
  bold: boolean;
  align?: "left" | "center" | "right";
  uppercase?: boolean;
  underline?: boolean;
}

interface PdfParagraph {
  type: ScenarioElementType;
  text: string;
  isEnding?: boolean;
  sceneNumber?: number;
}

export interface PdfExportOptions {
  includeCoverPage: boolean;
  includeSceneNumbers: boolean;
  includePageNumbers: boolean;
}

const endingStyle: ParagraphStyle = {
  x: MARGIN_LEFT,
  width: CONTENT_WIDTH,
  topSpacing: LINE_HEIGHT * 1.5,
  bottomSpacing: LINE_HEIGHT,
  bold: true,
  align: "center",
  uppercase: true,
  underline: true,
};

const paragraphStyles: Record<ScenarioElementType, ParagraphStyle> = {
  SCENE_HEADING: {
    x: MARGIN_LEFT,
    width: CONTENT_WIDTH,
    topSpacing: LINE_HEIGHT,
    bottomSpacing: LINE_HEIGHT,
    bold: true,
    uppercase: true,
  },
  ACTION: {
    x: MARGIN_LEFT,
    width: CONTENT_WIDTH,
    topSpacing: 0,
    bottomSpacing: LINE_HEIGHT,
    bold: false,
  },
  CHARACTER: {
    x: MARGIN_LEFT + 55,
    width: 76,
    topSpacing: 0,
    bottomSpacing: 0,
    bold: true,
    uppercase: true,
  },
  DIALOGUE: {
    x: MARGIN_LEFT + 25,
    width: 86,
    topSpacing: 0,
    bottomSpacing: LINE_HEIGHT,
    bold: false,
  },
  PARENTHETICAL: {
    x: MARGIN_LEFT + 40,
    width: 60,
    topSpacing: 0,
    bottomSpacing: 0,
    bold: false,
  },
  TRANSITION: {
    x: MARGIN_LEFT + CONTENT_WIDTH - 70,
    width: 70,
    topSpacing: 0,
    bottomSpacing: LINE_HEIGHT,
    bold: true,
    align: "right",
    uppercase: true,
  },
};

/**
 * Creates a true A4 PDF from the structured screenplay content. It never reads
 * the UI or its colours, so the output remains a white, printable screenplay.
 */
export async function createScenarioPdf(
  document: ScenarioFile,
  options: PdfExportOptions = {
    includeCoverPage: hasCoverPageContent(document.coverPage),
    includeSceneNumbers: true,
    includePageNumbers: true,
  },
): Promise<Uint8Array> {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  pdf.setProperties({
    title: document.title || "Sans titre",
    subject: "Scénario",
    creator: "Scenario",
  });
  await installUnicodeFonts(pdf);
  pdf.setFont(SCREENPLAY_FONT, "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(17, 17, 17);

  const writer = new ScreenplayPdfWriter(pdf, options.includeSceneNumbers);
  const paragraphs = toPdfParagraphs(document.content);
  const includesCoverPage = options.includeCoverPage && hasCoverPageContent(document.coverPage);

  if (includesCoverPage) {
    writeCoverPage(pdf, document.coverPage);
    pdf.addPage();
  }

  for (let index = 0; index < paragraphs.length; index += 1) {
    writer.writeParagraph(paragraphs[index], paragraphs[index + 1]);
  }

  if (options.includePageNumbers) {
    writer.writePageNumbers(includesCoverPage);
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}

async function installUnicodeFonts(pdf: jsPDF): Promise<void> {
  if (!embeddedFontData) {
    embeddedFontData = Promise.all([
      fetchFontAsBase64(dejavuMonoRegularUrl),
      fetchFontAsBase64(dejavuMonoBoldUrl),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }

  const fonts = await embeddedFontData;
  pdf.addFileToVFS(SCREENPLAY_FONT_REGULAR_FILE, fonts.regular);
  pdf.addFileToVFS(SCREENPLAY_FONT_BOLD_FILE, fonts.bold);
  pdf.addFont(SCREENPLAY_FONT_REGULAR_FILE, SCREENPLAY_FONT, "normal");
  pdf.addFont(SCREENPLAY_FONT_BOLD_FILE, SCREENPLAY_FONT, "bold");
}

async function fetchFontAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("La police Unicode du PDF n’a pas pu être chargée.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

class ScreenplayPdfWriter {
  private y = MARGIN_TOP;

  constructor(
    private readonly pdf: jsPDF,
    private readonly includeSceneNumbers: boolean,
  ) {}

  writeParagraph(paragraph: PdfParagraph, nextParagraph?: PdfParagraph): void {
    const style = paragraph.isEnding ? endingStyle : paragraphStyles[paragraph.type];
    const lines = this.wrapText(paragraph.text, style);
    const ownHeight = style.topSpacing + lines.length * LINE_HEIGHT + style.bottomSpacing;
    const protectedHeight = this.getProtectedHeight(paragraph, nextParagraph, ownHeight);

    this.ensureRoom(protectedHeight);
    this.y += style.topSpacing;

    for (const [lineIndex, line] of lines.entries()) {
      this.ensureRoom(LINE_HEIGHT);
      this.pdf.setFont(SCREENPLAY_FONT, style.bold ? "bold" : "normal");
      if (line) {
        const x = style.align === "right" ? style.x + style.width : style.x;
        this.pdf.text(
          line,
          x,
          this.y,
          { align: style.align ?? "left" },
        );
        if (style.underline) {
          const lineWidth = this.pdf.getTextWidth(line);
          const underlineStart =
            style.align === "center"
              ? x + (style.width - lineWidth) / 2
              : style.align === "right"
                ? x - lineWidth
                : x;
          this.pdf.line(underlineStart, this.y + 0.8, underlineStart + lineWidth, this.y + 0.8);
        }
        if (this.includeSceneNumbers && paragraph.sceneNumber && lineIndex === 0) {
          const number = String(paragraph.sceneNumber);
          this.pdf.text(number, MARGIN_LEFT - 8, this.y, { align: "right" });
          this.pdf.text(number, MARGIN_LEFT + CONTENT_WIDTH + 8, this.y);
        }
      }
      this.y += LINE_HEIGHT;
    }

    this.y += style.bottomSpacing;
  }

  writePageNumbers(hasCoverPage: boolean): void {
    const pageCount = this.pdf.getNumberOfPages();
    this.pdf.setFont(SCREENPLAY_FONT, "normal");
    this.pdf.setFontSize(10);
    this.pdf.setTextColor(85, 85, 85);

    for (let page = hasCoverPage ? 2 : 1; page <= pageCount; page += 1) {
      this.pdf.setPage(page);
      this.pdf.text(String(page - (hasCoverPage ? 1 : 0)), PAGE_WIDTH - MARGIN_RIGHT, FOOTER_Y, {
        align: "right",
      });
    }
  }

  private wrapText(text: string, style: ParagraphStyle): string[] {
    this.pdf.setFont(SCREENPLAY_FONT, style.bold ? "bold" : "normal");
    this.pdf.setFontSize(12);
    const formatted = style.uppercase ? text.toLocaleUpperCase("fr-FR") : text;
    const safeText = normalizePdfText(formatted);
    return safeText ? this.pdf.splitTextToSize(safeText, style.width) : [""];
  }

  private getProtectedHeight(
    paragraph: PdfParagraph,
    nextParagraph: PdfParagraph | undefined,
    ownHeight: number,
  ): number {
    if (!nextParagraph || !shouldKeepTogether(paragraph.type, nextParagraph.type)) {
      return ownHeight;
    }

    const nextStyle = nextParagraph.isEnding
      ? endingStyle
      : paragraphStyles[nextParagraph.type];
    const nextLines = this.wrapText(nextParagraph.text, nextStyle);
    const nextHeight =
      nextStyle.topSpacing + Math.min(nextLines.length, 2) * LINE_HEIGHT;
    return ownHeight + nextHeight;
  }

  private ensureRoom(height: number): void {
    const printableBottom = PAGE_HEIGHT - MARGIN_BOTTOM;
    if (this.y > MARGIN_TOP && this.y + height > printableBottom) {
      this.pdf.addPage();
      this.y = MARGIN_TOP;
    }
  }
}

function writeCoverPage(pdf: jsPDF, coverPage: CoverPageData): void {
  const title = coverPage.projectName || "Sans titre";
  const centerX = PAGE_WIDTH / 2;

  pdf.setTextColor(17, 17, 17);
  pdf.setFont(SCREENPLAY_FONT, "bold");
  pdf.setFontSize(18);
  pdf.text(normalizePdfText(title).toLocaleUpperCase("fr-FR"), centerX, 118, {
    align: "center",
    maxWidth: 150,
  });

  const credits = getCoverCredits(coverPage);
  if (credits.length > 0) {
    pdf.setFont(SCREENPLAY_FONT, "normal");
    pdf.setFontSize(11);
    pdf.text(credits, centerX, 143, { align: "center", lineHeightFactor: 1.45 });
  }

  const primaryDetails = [
    coverPage.production,
    coverPage.duration,
    coverPage.version && `Version ${coverPage.version}`,
    coverPage.date,
  ]
    .filter(Boolean)
    .map(normalizePdfText);
  if (primaryDetails.length > 0) {
    pdf.setFont(SCREENPLAY_FONT, "normal");
    pdf.setFontSize(10);
    pdf.text(primaryDetails, centerX, 160, {
      align: "center",
      lineHeightFactor: 1.45,
    });
  }

  if (coverPage.rights) {
    pdf.setFont(SCREENPLAY_FONT, "normal");
    pdf.setFontSize(10);
    pdf.text(normalizePdfText(coverPage.rights), MARGIN_LEFT, PAGE_HEIGHT - 38);
  }

  const contact = [
    coverPage.contactName,
    coverPage.contactEmail,
    coverPage.contactPhone,
    coverPage.contactWebsite,
  ]
    .filter(Boolean)
    .map(normalizePdfText);
  if (contact.length > 0) {
    pdf.setFont("courier", "normal");
    pdf.setFontSize(10);
    pdf.text(contact, PAGE_WIDTH - MARGIN_RIGHT, PAGE_HEIGHT - 38, {
      align: "right",
      lineHeightFactor: 1.45,
    });
  }
}


function toPdfParagraphs(content: JSONContent): PdfParagraph[] {
  const paragraphs: PdfParagraph[] = [];
  let sceneNumber = 0;

  for (const node of content.content ?? []) {
    if (node.type !== "paragraph") {
      continue;
    }

    const type = toScenarioElementType(node.attrs?.scenarioType);
    if (type === "SCENE_HEADING") {
      sceneNumber += 1;
    }

    paragraphs.push({
      type,
      text: getNodeText(node).trim().replace(/\s+/g, " "),
      isEnding: node.attrs?.ending === true,
      sceneNumber: type === "SCENE_HEADING" ? sceneNumber : undefined,
    });
  }

  return paragraphs.length > 0
    ? paragraphs
    : [{ type: "ACTION", text: "" }];
}

function shouldKeepTogether(
  current: ScenarioElementType,
  next: ScenarioElementType,
): boolean {
  return (
    (current === "SCENE_HEADING" && next === "ACTION") ||
    (current === "CHARACTER" &&
      (next === "DIALOGUE" || next === "PARENTHETICAL"))
  );
}

function getNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text ?? "";
  }

  return (node.content ?? []).map(getNodeText).join("");
}

function normalizePdfText(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-");
}
