import { jsPDF } from 'jspdf';
import type { SceneBreakdown } from '../editor/breakdownModel';
import type { ScenarioScene } from '../editor/sceneTimelineModel';
import type { TechnicalBreakdown, TechnicalColumn, TechnicalShot } from '../editor/technicalBreakdownModel';
import { installUnicodeFonts, normalizePdfText, PDF_UNICODE_FONT } from './pdfExport';

export type WorkspacePdfPageFormat = 'a4' | 'a3' | 'letter';
export type WorkspacePdfOrientation = 'auto' | 'portrait' | 'landscape';
export type WorkspacePdfContentSize = 'compact' | 'normal' | 'large';

export interface WorkspacePdfBaseOptions {
  pageFormat: WorkspacePdfPageFormat;
  orientation: WorkspacePdfOrientation;
  contentSize: WorkspacePdfContentSize;
  includePageNumbers: boolean;
}

export interface BreakdownPdfOptions extends WorkspacePdfBaseOptions {
  categoryNames: string[];
  includeEmptyCategories: boolean;
}

export interface TechnicalBreakdownPdfOptions extends WorkspacePdfBaseOptions {
  columnIds: string[];
  includeImages: boolean;
}

interface TextMetrics {
  fontSize: number;
  lineHeight: number;
  cellPadding: number;
}

interface PageSize {
  width: number;
  height: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

const PAGE_SIZES: Record<WorkspacePdfPageFormat, PageSize> = {
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 },
  letter: { width: 215.9, height: 279.4 },
};

const MARGIN_X = 12;
const HEADER_BOTTOM = 18;
const FOOTER_HEIGHT = 10;
const COLOR_TEXT: [number, number, number] = [30, 38, 44];
const COLOR_MUTED: [number, number, number] = [98, 111, 120];
const COLOR_ACCENT: [number, number, number] = [39, 103, 148];
const COLOR_HEADER: [number, number, number] = [226, 236, 243];
const COLOR_SUBTLE: [number, number, number] = [246, 248, 249];
const COLOR_BORDER: [number, number, number] = [190, 201, 208];

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

function metrics(size: WorkspacePdfContentSize): TextMetrics {
  if (size === 'compact') return { fontSize: 7.2, lineHeight: 3.05, cellPadding: 1.4 };
  if (size === 'large') return { fontSize: 10, lineHeight: 4.25, cellPadding: 1.9 };
  return { fontSize: 8.4, lineHeight: 3.6, cellPadding: 1.6 };
}

function resolveOrientation(
  option: WorkspacePdfOrientation,
  format: WorkspacePdfPageFormat,
  preferLandscape: boolean,
): 'portrait' | 'landscape' {
  if (option !== 'auto') return option;
  const page = PAGE_SIZES[format];
  return preferLandscape || page.width > page.height ? 'landscape' : 'portrait';
}

function orientedSize(format: WorkspacePdfPageFormat, orientation: 'portrait' | 'landscape'): PageSize {
  const page = PAGE_SIZES[format];
  const portrait = page.width <= page.height ? page : { width: page.height, height: page.width };
  return orientation === 'portrait' ? portrait : { width: portrait.height, height: portrait.width };
}

class WorkspacePdfCanvas {
  readonly pdf: jsPDF;
  readonly page: PageSize;
  readonly contentWidth: number;
  readonly contentBottom: number;
  y = HEADER_BOTTOM;

  constructor(
    readonly title: string,
    readonly section: string,
    readonly options: WorkspacePdfBaseOptions,
    orientation: 'portrait' | 'landscape',
  ) {
    this.page = orientedSize(options.pageFormat, orientation);
    this.contentWidth = this.page.width - MARGIN_X * 2;
    this.contentBottom = this.page.height - FOOTER_HEIGHT;
    this.pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: options.pageFormat,
      compress: true,
      putOnlyUsedFonts: true,
    });
  }

  async initialize(): Promise<void> {
    await installUnicodeFonts(this.pdf);
    this.pdf.setProperties({ title: `${this.title} - ${this.section}`, subject: this.section, creator: 'Senario' });
    this.beginPage();
  }

  beginPage(context?: string): void {
    this.pdf.setTextColor(...COLOR_TEXT);
    this.pdf.setFont(PDF_UNICODE_FONT, 'bold');
    this.pdf.setFontSize(10.5);
    this.pdf.text(normalizePdfText(this.title || 'Sans titre'), MARGIN_X, 9.5, { maxWidth: this.contentWidth * .62 });
    this.pdf.setFont(PDF_UNICODE_FONT, 'normal');
    this.pdf.setFontSize(7.2);
    this.pdf.setTextColor(...COLOR_MUTED);
    const label = context ? `${this.section} - ${context}` : this.section;
    this.pdf.text(normalizePdfText(label).toLocaleUpperCase('fr-FR'), this.page.width - MARGIN_X, 9.5, { align: 'right', maxWidth: this.contentWidth * .36 });
    this.pdf.setDrawColor(...COLOR_BORDER);
    this.pdf.setLineWidth(.25);
    this.pdf.line(MARGIN_X, 13.5, this.page.width - MARGIN_X, 13.5);
    this.y = HEADER_BOTTOM;
  }

  addPage(context?: string): void {
    this.pdf.addPage();
    this.beginPage(context);
  }

  finish(): Uint8Array {
    if (this.options.includePageNumbers) {
      const count = this.pdf.getNumberOfPages();
      this.pdf.setFont(PDF_UNICODE_FONT, 'normal');
      this.pdf.setFontSize(7);
      this.pdf.setTextColor(...COLOR_MUTED);
      for (let page = 1; page <= count; page += 1) {
        this.pdf.setPage(page);
        this.pdf.text(`${page} / ${count}`, this.page.width - MARGIN_X, this.page.height - 4.5, { align: 'right' });
      }
    }
    return new Uint8Array(this.pdf.output('arraybuffer'));
  }
}

function wrap(pdf: jsPDF, value: string, width: number): string[] {
  const clean = normalizePdfText(value).trim();
  if (!clean) return [];
  return pdf.splitTextToSize(clean, Math.max(3, width)) as string[];
}

function sceneBreakdownRows(
  scene: ScenarioScene,
  breakdowns: Record<string, SceneBreakdown>,
  options: BreakdownPdfOptions,
): Array<{ category: string; elements: string }> {
  const selected = new Set(options.categoryNames.map(normalized));
  return (breakdowns[scene.id]?.categories ?? []).flatMap(category => {
    if (!selected.has(normalized(category.name))) return [];
    if (!options.includeEmptyCategories && !category.items.length) return [];
    return [{
      category: category.name,
      elements: category.items.map(item => `- ${item.name}`).join('\n'),
    }];
  });
}

function estimateBreakdownSceneHeight(
  pdf: jsPDF,
  rows: Array<{ category: string; elements: string }>,
  text: TextMetrics,
  categoryWidth: number,
  elementsWidth: number,
): number {
  return 15 + rows.reduce((height, row) => height + Math.max(
    6.2,
    wrap(pdf, row.category, categoryWidth - text.cellPadding * 2).length * text.lineHeight + text.cellPadding * 2,
    wrap(pdf, row.elements, elementsWidth - text.cellPadding * 2).length * text.lineHeight + text.cellPadding * 2,
  ), 0);
}

export async function createBreakdownPdf(
  title: string,
  scenes: ScenarioScene[],
  breakdowns: Record<string, SceneBreakdown>,
  options: BreakdownPdfOptions,
): Promise<Uint8Array> {
  const orientation = resolveOrientation(options.orientation, options.pageFormat, false);
  const canvas = new WorkspacePdfCanvas(title, 'Dépouillement', options, orientation);
  await canvas.initialize();
  const pdf = canvas.pdf;
  const text = metrics(options.contentSize);
  const categoryWidth = canvas.contentWidth * .32;
  const elementsWidth = canvas.contentWidth - categoryWidth;

  const drawSceneHeading = (scene: ScenarioScene, continued = false) => {
    pdf.setFillColor(...COLOR_ACCENT);
    pdf.roundedRect(MARGIN_X, canvas.y, canvas.contentWidth, 8, 1.4, 1.4, 'F');
    pdf.setFont(PDF_UNICODE_FONT, 'bold');
    pdf.setFontSize(9.2);
    pdf.setTextColor(255, 255, 255);
    const label = `SCÈNE ${scene.index + 1}  ${scene.title}${continued ? '  (SUITE)' : ''}`;
    pdf.text(normalizePdfText(label), MARGIN_X + 3, canvas.y + 5.3, { maxWidth: canvas.contentWidth - 6 });
    canvas.y += 10;
  };

  const drawTableHeader = () => {
    pdf.setFillColor(...COLOR_HEADER);
    pdf.rect(MARGIN_X, canvas.y, canvas.contentWidth, 6.5, 'F');
    pdf.setDrawColor(...COLOR_BORDER);
    pdf.rect(MARGIN_X, canvas.y, categoryWidth, 6.5);
    pdf.rect(MARGIN_X + categoryWidth, canvas.y, elementsWidth, 6.5);
    pdf.setFont(PDF_UNICODE_FONT, 'bold');
    pdf.setFontSize(7.6);
    pdf.setTextColor(...COLOR_TEXT);
    pdf.text('CATÉGORIE', MARGIN_X + 2, canvas.y + 4.3);
    pdf.text('ÉLÉMENTS', MARGIN_X + categoryWidth + 2, canvas.y + 4.3);
    canvas.y += 6.5;
  };

  const startContinuationPage = (scene: ScenarioScene) => {
    canvas.addPage();
    drawSceneHeading(scene, true);
    drawTableHeader();
  };

  for (const scene of scenes) {
    const rows = sceneBreakdownRows(scene, breakdowns, options);
    const estimated = estimateBreakdownSceneHeight(pdf, rows, text, categoryWidth, elementsWidth);
    const pageCapacity = canvas.contentBottom - HEADER_BOTTOM;
    if (canvas.y > HEADER_BOTTOM && estimated <= pageCapacity && canvas.y + estimated > canvas.contentBottom) canvas.addPage();
    else if (canvas.y + 14 > canvas.contentBottom) canvas.addPage();
    drawSceneHeading(scene);
    drawTableHeader();

    if (!rows.length) {
      pdf.setFont(PDF_UNICODE_FONT, 'normal');
      pdf.setFontSize(text.fontSize);
      pdf.setTextColor(...COLOR_MUTED);
      pdf.text('Aucune catégorie renseignée pour cette scène.', MARGIN_X + 2, canvas.y + 5);
      canvas.y += 9;
      continue;
    }

    for (const row of rows) {
      pdf.setFont(PDF_UNICODE_FONT, 'normal');
      pdf.setFontSize(text.fontSize);
      const categoryLines = wrap(pdf, row.category, categoryWidth - text.cellPadding * 2);
      const elementLines = wrap(pdf, row.elements, elementsWidth - text.cellPadding * 2);
      const totalLines = Math.max(1, categoryLines.length, elementLines.length);
      let lineOffset = 0;
      let continued = false;
      while (lineOffset < totalLines) {
        const remainingHeight = canvas.contentBottom - canvas.y;
        const maxLines = Math.max(1, Math.floor((remainingHeight - text.cellPadding * 2) / text.lineHeight));
        if (remainingHeight < 6.2) {
          startContinuationPage(scene);
          continue;
        }
        const lineCount = Math.min(maxLines, totalLines - lineOffset);
        const rowHeight = Math.max(6.2, lineCount * text.lineHeight + text.cellPadding * 2);
        pdf.setFillColor(...(continued ? COLOR_SUBTLE : [255, 255, 255] as [number, number, number]));
        pdf.rect(MARGIN_X, canvas.y, canvas.contentWidth, rowHeight, 'F');
        pdf.setDrawColor(...COLOR_BORDER);
        pdf.setLineWidth(.18);
        pdf.rect(MARGIN_X, canvas.y, categoryWidth, rowHeight);
        pdf.rect(MARGIN_X + categoryWidth, canvas.y, elementsWidth, rowHeight);
        pdf.setTextColor(...COLOR_TEXT);
        pdf.setFont(PDF_UNICODE_FONT, 'bold');
        const leftLines = categoryLines.slice(lineOffset, lineOffset + lineCount);
        if (continued && !leftLines.length) leftLines.push('(suite)');
        if (leftLines.length) pdf.text(leftLines, MARGIN_X + text.cellPadding, canvas.y + text.cellPadding + text.lineHeight * .78, { lineHeightFactor: 1 });
        pdf.setFont(PDF_UNICODE_FONT, 'normal');
        const rightLines = elementLines.slice(lineOffset, lineOffset + lineCount);
        if (rightLines.length) pdf.text(rightLines, MARGIN_X + categoryWidth + text.cellPadding, canvas.y + text.cellPadding + text.lineHeight * .78, { lineHeightFactor: 1 });
        canvas.y += rowHeight;
        lineOffset += lineCount;
        continued = lineOffset < totalLines;
        if (continued) startContinuationPage(scene);
      }
    }
    canvas.y += 5;
  }

  return canvas.finish();
}

function technicalCellValue(
  shot: TechnicalShot,
  column: TechnicalColumn,
  scenes: ScenarioScene[],
  sceneShotIndex: number,
): string {
  if (column.kind === 'scene') return scenes.find(scene => scene.id === shot.sceneId)?.title ?? '';
  if (column.kind === 'plan') {
    const scene = scenes.find(candidate => candidate.id === shot.sceneId);
    return `${(scene?.index ?? 0) + 1}.${sceneShotIndex + 1}`;
  }
  if (column.kind === 'image') return '';
  return shot.values[column.id] ?? '';
}

function desiredColumnWidth(column: TechnicalColumn, size: WorkspacePdfContentSize): number {
  const scale = size === 'compact' ? .095 : size === 'large' ? .135 : .115;
  const minimum = column.kind === 'plan' ? 14 : column.kind === 'scene' ? 28 : column.kind === 'image' ? 24 : 19;
  return Math.max(minimum, column.width * scale);
}

function partitionTechnicalColumns(
  columns: TechnicalColumn[],
  availableWidth: number,
  size: WorkspacePdfContentSize,
): TechnicalColumn[][] {
  const sticky = columns.filter(column => column.kind === 'scene' || column.kind === 'plan');
  const flowing = columns.filter(column => column.kind !== 'scene' && column.kind !== 'plan');
  if (!flowing.length) return [sticky];
  const groups: TechnicalColumn[][] = [];
  let current: TechnicalColumn[] = [];
  const widthOf = (values: TechnicalColumn[]) => values.reduce((sum, column) => sum + desiredColumnWidth(column, size), 0);
  for (const column of flowing) {
    const candidate = [...sticky, ...current, column];
    if (current.length && widthOf(candidate) > availableWidth) {
      groups.push([...sticky, ...current]);
      current = [column];
    } else current.push(column);
  }
  if (current.length) groups.push([...sticky, ...current]);
  return groups.length ? groups : [columns];
}

function fittedWidths(columns: TechnicalColumn[], availableWidth: number, size: WorkspacePdfContentSize): number[] {
  const desired = columns.map(column => desiredColumnWidth(column, size));
  const total = desired.reduce((sum, value) => sum + value, 0) || 1;
  return desired.map(value => value * availableWidth / total);
}

async function imageDimensions(src: string): Promise<ImageDimensions> {
  if (typeof Image === 'undefined') return { width: 4, height: 3 };
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 4, height: image.naturalHeight || 3 });
    image.onerror = () => resolve({ width: 4, height: 3 });
    image.src = src;
  });
}

function imageFormat(src: string): string {
  if (/^data:image\/(?:jpe?g)/iu.test(src)) return 'JPEG';
  if (/^data:image\/webp/iu.test(src)) return 'WEBP';
  return 'PNG';
}

export async function createTechnicalBreakdownPdf(
  title: string,
  scenes: ScenarioScene[],
  breakdown: TechnicalBreakdown,
  options: TechnicalBreakdownPdfOptions,
): Promise<Uint8Array> {
  const selected = new Set(options.columnIds);
  const columns = breakdown.columns.filter(column => selected.has(column.id)
    && (options.includeImages || column.kind !== 'image'));
  const portraitWidth = orientedSize(options.pageFormat, 'portrait').width - MARGIN_X * 2;
  const totalDesired = columns.reduce((sum, column) => sum + desiredColumnWidth(column, options.contentSize), 0);
  const orientation = resolveOrientation(options.orientation, options.pageFormat, totalDesired > portraitWidth || columns.length > 6);
  const canvas = new WorkspacePdfCanvas(title, 'Découpage technique', options, orientation);
  await canvas.initialize();
  const pdf = canvas.pdf;
  const text = metrics(options.contentSize);
  const groups = partitionTechnicalColumns(columns, canvas.contentWidth, options.contentSize);
  const imageSources = [...new Set(breakdown.shots.flatMap(shot => columns.flatMap(column =>
    column.kind === 'image' && shot.values[column.id] ? [shot.values[column.id]] : [])))];
  const imageSizeEntries = await Promise.all(imageSources.map(async src => [src, await imageDimensions(src)] as const));
  const imageSizes = new Map(imageSizeEntries);

  if (!columns.length) {
    pdf.setFont(PDF_UNICODE_FONT, 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...COLOR_MUTED);
    pdf.text('Aucune colonne sélectionnée pour cet export.', MARGIN_X, canvas.y + 8);
    return canvas.finish();
  }

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    if (groupIndex > 0) canvas.addPage(`colonnes ${groupIndex + 1}/${groups.length}`);
    const group = groups[groupIndex];
    const widths = fittedWidths(group, canvas.contentWidth, options.contentSize);
    const context = groups.length > 1 ? `colonnes ${groupIndex + 1}/${groups.length}` : undefined;

    const drawTableHeader = () => {
      pdf.setFont(PDF_UNICODE_FONT, 'bold');
      pdf.setFontSize(Math.max(7, text.fontSize - .3));
      const headerLines = group.map((column, index) => wrap(pdf, column.name.toLocaleUpperCase('fr-FR'), widths[index] - text.cellPadding * 2));
      const headerHeight = Math.max(7, ...headerLines.map(lines => lines.length * text.lineHeight + text.cellPadding * 2));
      let x = MARGIN_X;
      for (let index = 0; index < group.length; index += 1) {
        // jsPDF shares the non-stroking colour used by text and filled shapes.
        // Restore the header fill for every cell after drawing the previous label.
        pdf.setFillColor(...COLOR_HEADER);
        pdf.rect(x, canvas.y, widths[index], headerHeight, 'F');
        pdf.setDrawColor(...COLOR_BORDER);
        pdf.rect(x, canvas.y, widths[index], headerHeight);
        pdf.setTextColor(...COLOR_TEXT);
        if (headerLines[index].length) pdf.text(headerLines[index], x + text.cellPadding, canvas.y + text.cellPadding + text.lineHeight * .78, { lineHeightFactor: 1 });
        x += widths[index];
      }
      canvas.y += headerHeight;
    };

    const startContinuationPage = () => {
      canvas.addPage(context);
      drawTableHeader();
    };

    drawTableHeader();
    const sceneShotIndexes = new Map<string, number>();
    for (let shotIndex = 0; shotIndex < breakdown.shots.length; shotIndex += 1) {
      const shot = breakdown.shots[shotIndex];
      const indexInScene = sceneShotIndexes.get(shot.sceneId) ?? 0;
      sceneShotIndexes.set(shot.sceneId, indexInScene + 1);
      pdf.setFont(PDF_UNICODE_FONT, 'normal');
      pdf.setFontSize(text.fontSize);
      const values = group.map(column => technicalCellValue(shot, column, scenes, indexInScene));
      const cellLines = values.map((value, index) => wrap(pdf, value, widths[index] - text.cellPadding * 2));
      const maxLineCount = Math.max(1, ...cellLines.map(lines => lines.length));
      const imageIndex = group.findIndex(column => column.kind === 'image');
      const imageSource = imageIndex >= 0 ? shot.values[group[imageIndex].id] : '';
      const desiredImageHeight = imageSource ? Math.min(26, Math.max(15, widths[imageIndex] * .58)) : 0;
      const fullRowHeight = Math.max(6.2, maxLineCount * text.lineHeight + text.cellPadding * 2, desiredImageHeight + text.cellPadding * 2);
      if (fullRowHeight <= canvas.contentBottom - HEADER_BOTTOM && canvas.y + fullRowHeight > canvas.contentBottom) startContinuationPage();
      let lineOffset = 0;
      let firstChunk = true;
      while (lineOffset < maxLineCount) {
        const remainingHeight = canvas.contentBottom - canvas.y;
        if (remainingHeight < 6.2) {
          startContinuationPage();
          continue;
        }
        if (firstChunk && desiredImageHeight > 0 && remainingHeight < desiredImageHeight + text.cellPadding * 2) {
          startContinuationPage();
          continue;
        }
        const maxLines = Math.max(1, Math.floor((remainingHeight - text.cellPadding * 2) / text.lineHeight));
        const lineCount = Math.min(maxLines, maxLineCount - lineOffset);
        const chunkImageHeight = firstChunk ? desiredImageHeight : 0;
        const rowHeight = Math.max(6.2, lineCount * text.lineHeight + text.cellPadding * 2, chunkImageHeight + text.cellPadding * 2);
        const scene = scenes.find(candidate => candidate.id === shot.sceneId);
        const tinted = (scene?.index ?? 0) % 2 === 0;
        let x = MARGIN_X;
        for (let columnIndex = 0; columnIndex < group.length; columnIndex += 1) {
          pdf.setFillColor(...(tinted ? COLOR_SUBTLE : [255, 255, 255] as [number, number, number]));
          pdf.rect(x, canvas.y, widths[columnIndex], rowHeight, 'F');
          pdf.setDrawColor(...COLOR_BORDER);
          pdf.setLineWidth(.16);
          pdf.rect(x, canvas.y, widths[columnIndex], rowHeight);
          if (firstChunk && columnIndex === imageIndex && imageSource) {
            const dimensions = imageSizes.get(imageSource) ?? { width: 4, height: 3 };
            const availableWidth = widths[columnIndex] - text.cellPadding * 2;
            const availableHeight = rowHeight - text.cellPadding * 2;
            const ratio = dimensions.width / Math.max(1, dimensions.height);
            let imageWidth = availableWidth;
            let imageHeight = imageWidth / ratio;
            if (imageHeight > availableHeight) { imageHeight = availableHeight; imageWidth = imageHeight * ratio; }
            try {
              pdf.addImage(imageSource, imageFormat(imageSource), x + (widths[columnIndex] - imageWidth) / 2, canvas.y + (rowHeight - imageHeight) / 2, imageWidth, imageHeight, undefined, 'FAST');
            } catch {
              pdf.setFont(PDF_UNICODE_FONT, 'normal');
              pdf.setFontSize(Math.max(6.5, text.fontSize - 1));
              pdf.setTextColor(...COLOR_MUTED);
              pdf.text('Image', x + widths[columnIndex] / 2, canvas.y + rowHeight / 2, { align: 'center' });
            }
          } else {
            const lines = cellLines[columnIndex].slice(lineOffset, lineOffset + lineCount);
            pdf.setFont(PDF_UNICODE_FONT, group[columnIndex].kind === 'plan' ? 'bold' : 'normal');
            pdf.setFontSize(text.fontSize);
            pdf.setTextColor(...COLOR_TEXT);
            if (lines.length) pdf.text(lines, x + text.cellPadding, canvas.y + text.cellPadding + text.lineHeight * .78, { lineHeightFactor: 1 });
          }
          x += widths[columnIndex];
        }
        canvas.y += rowHeight;
        lineOffset += lineCount;
        firstChunk = false;
        if (lineOffset < maxLineCount) startContinuationPage();
      }
    }
  }

  return canvas.finish();
}
