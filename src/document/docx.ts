import { strToU8, unzipSync, zipSync } from 'fflate';
import { hasCoverPageContent, type CoverPageData, type ScenarioFile } from './scenarioFile';
import {
  MAX_INTERCHANGE_FILE_BYTES,
  MAX_INTERCHANGE_PARAGRAPHS,
  MAX_INTERCHANGE_TEXT_BYTES,
  assertInterchangeSize,
  assertSafeXml,
  createInterchangeScenario,
  decodeTextFile,
  filenameTitle,
  mergeRuns,
  scenarioBlocks,
  xmlAttribute,
  xmlDecode,
  xmlEscape,
  type RichTextRun,
  type ScenarioInterchangeBlock,
} from './interchangeCommon';

const REQUIRED_PART = 'word/document.xml';
const EXTRACTED_PARTS = new Set([REQUIRED_PART, 'word/styles.xml', 'docprops/core.xml']);
const MAX_ZIP_ENTRIES = 5_000;

const STYLE_TO_TYPE = new Map<string, ScenarioInterchangeBlock['type']>([
  ['senariosceneheading', 'SCENE_HEADING'], ['sceneheading', 'SCENE_HEADING'], ['titredescene', 'SCENE_HEADING'], ['slugline', 'SCENE_HEADING'], ['slug', 'SCENE_HEADING'],
  ['senarioaction', 'ACTION'], ['action', 'ACTION'], ['bodytext', 'ACTION'],
  ['senariocharacter', 'CHARACTER'], ['character', 'CHARACTER'], ['charactername', 'CHARACTER'], ['personnage', 'CHARACTER'],
  ['senariodialogue', 'DIALOGUE'], ['dialogue', 'DIALOGUE'], ['dialog', 'DIALOGUE'],
  ['senarioparenthetical', 'PARENTHETICAL'], ['parenthetical', 'PARENTHETICAL'], ['parenthesis', 'PARENTHETICAL'], ['parenthese', 'PARENTHETICAL'], ['wryly', 'PARENTHETICAL'],
  ['senariotransition', 'TRANSITION'], ['transition', 'TRANSITION'],
]);

const EXPORTED_STYLES: Record<ScenarioInterchangeBlock['type'], string> = {
  SCENE_HEADING: 'SenarioSceneHeading', ACTION: 'SenarioAction', CHARACTER: 'SenarioCharacter',
  DIALOGUE: 'SenarioDialogue', PARENTHETICAL: 'SenarioParenthetical', TRANSITION: 'SenarioTransition',
};

function normalizeStyle(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
}

function safeZipPath(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  return !normalized.startsWith('/') && !/^[a-z]:\//i.test(normalized) && !normalized.split('/').includes('..');
}

function readDocxParts(bytes: Uint8Array): Record<string, Uint8Array> {
  assertInterchangeSize(bytes);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Ce fichier DOCX n’est pas une archive Open XML valide.');
  let entryCount = 0, expandedSize = 0;
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, {
      filter(file) {
        entryCount++;
        if (entryCount > MAX_ZIP_ENTRIES) throw new Error('Le fichier DOCX contient trop d’éléments.');
        if (!safeZipPath(file.name)) throw new Error('Le fichier DOCX contient un chemin interne interdit.');
        expandedSize += file.originalSize;
        if (file.originalSize > MAX_INTERCHANGE_TEXT_BYTES || expandedSize > MAX_INTERCHANGE_FILE_BYTES) {
          throw new Error('Le contenu décompressé du DOCX est trop volumineux.');
        }
        return EXTRACTED_PARTS.has(file.name.toLocaleLowerCase('en-US'));
      },
    });
  } catch (error) {
    if (error instanceof Error && /DOCX/.test(error.message)) throw error;
    throw new Error(`Impossible de décompresser ce fichier DOCX : ${error instanceof Error ? error.message : String(error)}`);
  }
  const normalizedArchive = Object.fromEntries(Object.entries(archive).map(([name, contents]) => [name.toLocaleLowerCase('en-US'), contents]));
  const actualExpandedSize = Object.values(normalizedArchive).reduce((total, contents) => total + contents.byteLength, 0);
  if (actualExpandedSize > MAX_INTERCHANGE_FILE_BYTES || Object.values(normalizedArchive).some(contents => contents.byteLength > MAX_INTERCHANGE_TEXT_BYTES)) {
    throw new Error('Le contenu réellement décompressé du DOCX est trop volumineux.');
  }
  if (!normalizedArchive[REQUIRED_PART]) throw new Error('Le fichier DOCX ne contient pas word/document.xml.');
  return normalizedArchive;
}

function parseStyles(xml: string): Map<string, string> {
  const styles = new Map<string, string>();
  for (const match of xml.matchAll(/<(?:[\w-]+:)?style\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?style\s*>/gi)) {
    const id = xmlAttribute(match[1] ?? '', 'styleId');
    const nameTag = (match[2] ?? '').match(/<(?:[\w-]+:)?name\b([^>]*)\/?\s*>/i);
    const name = nameTag ? xmlAttribute(nameTag[1] ?? '', 'val') : '';
    if (id) styles.set(id, name || id);
  }
  return styles;
}

function propertyValue(body: string, element: string, attribute = 'val'): string {
  const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = body.match(new RegExp(`<(?:[\\w-]+:)?${escaped}\\b([^>]*)\\/?\\s*>`, 'i'));
  return tag ? xmlAttribute(tag[1] ?? '', attribute) : '';
}

function enabledProperty(body: string, element: string): boolean {
  const escaped = element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = body.match(new RegExp(`<(?:[\\w-]+:)?${escaped}\\b([^>]*)\\/?\\s*>`, 'i'));
  if (!tag) return false;
  const value = xmlAttribute(tag[1] ?? '', 'val').toLowerCase();
  return !['0', 'false', 'off', 'none'].includes(value);
}

function readWordRun(body: string): RichTextRun {
  const properties = body.match(/<(?:[\w-]+:)?rPr\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?rPr\s*>/i)?.[1] ?? '';
  let text = '';
  const tokenPattern = /<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t\s*>|<(?:[\w-]+:)?(?:br|cr)\b[^>]*\/>|<(?:[\w-]+:)?tab\b[^>]*\/>/gi;
  for (const token of body.matchAll(tokenPattern)) {
    if (token[1] !== undefined) text += xmlDecode(token[1].replace(/<[^>]*>/g, ''));
    else if (/tab/i.test(token[0])) text += '\t';
    else text += '\n';
  }
  return {
    text,
    ...(enabledProperty(properties, 'b') ? { bold: true } : {}),
    ...(enabledProperty(properties, 'i') ? { italic: true } : {}),
    ...(enabledProperty(properties, 'u') ? { underline: true } : {}),
  };
}

interface WordParagraph {
  styleId: string;
  styleName: string;
  alignment: string;
  leftIndent: number;
  runs: RichTextRun[];
  text: string;
}

function parseParagraphs(xml: string, styles: Map<string, string>): WordParagraph[] {
  const cleanXml = xml.replace(/<(?:[\w-]+:)?del\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?del\s*>/gi, '');
  const paragraphs: WordParagraph[] = [];
  for (const match of cleanXml.matchAll(/<(?:[\w-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?p\s*>/gi)) {
    if (paragraphs.length >= MAX_INTERCHANGE_PARAGRAPHS) throw new Error('Le document Word contient trop de paragraphes.');
    const body = match[2] ?? '';
    const properties = body.match(/<(?:[\w-]+:)?pPr\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?pPr\s*>/i)?.[1] ?? '';
    const styleId = propertyValue(properties, 'pStyle');
    const runs: RichTextRun[] = [];
    for (const run of body.matchAll(/<(?:[\w-]+:)?r\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?r\s*>/gi)) {
      const parsed = readWordRun(run[1] ?? '');
      if (parsed.text) runs.push(parsed);
    }
    const merged = mergeRuns(runs);
    const text = merged.map(run => run.text).join('');
    const indentTag = properties.match(/<(?:[\w-]+:)?ind\b([^>]*)\/?\s*>/i);
    const leftIndent = Number.parseInt(indentTag ? xmlAttribute(indentTag[1] ?? '', 'left') : '', 10) || 0;
    paragraphs.push({
      styleId,
      styleName: styles.get(styleId) ?? styleId,
      alignment: propertyValue(properties, 'jc'),
      leftIndent,
      runs: merged,
      text,
    });
  }
  return paragraphs;
}

function explicitType(paragraph: WordParagraph): ScenarioInterchangeBlock['type'] | null {
  return STYLE_TO_TYPE.get(normalizeStyle(paragraph.styleId)) ?? STYLE_TO_TYPE.get(normalizeStyle(paragraph.styleName)) ?? null;
}

function inferredType(paragraph: WordParagraph, next: WordParagraph | undefined): ScenarioInterchangeBlock['type'] {
  const text = paragraph.text.trim();
  if (/^(?:INT\.?\/EXT\.?|INT\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.)(?:\s|$)/i.test(text)) return 'SCENE_HEADING';
  if (/^\([^\n]*\)$/.test(text)) return 'PARENTHETICAL';
  if (text === text.toLocaleUpperCase('fr-FR') && /[A-ZÀ-ÖØ-Þ]/.test(text) && text.endsWith('TO:')) return 'TRANSITION';
  if (text.length <= 80 && text === text.toLocaleUpperCase('fr-FR') && /[A-ZÀ-ÖØ-Þ]/.test(text)
      && (paragraph.alignment === 'center' || paragraph.leftIndent >= 2500)
      && Boolean(next?.text.trim())) return 'CHARACTER';
  if (paragraph.leftIndent >= 1000 && paragraph.leftIndent < 5000) return 'DIALOGUE';
  return 'ACTION';
}

function coreTitle(xml: string): string {
  return xmlDecode(xml.match(/<(?:[\w-]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?title\s*>/i)?.[1]?.replace(/<[^>]*>/g, '') ?? '').trim();
}

function titleField(style: string): keyof CoverPageData | null {
  const normalized = normalizeStyle(style);
  return ({
    senariotitle: 'projectName', senarioauthor: 'screenwriter', senariodirector: 'director',
    senarioproduction: 'production', senarioduration: 'duration', senarioversion: 'version',
    senariodate: 'date', senariorights: 'rights', senariocontactname: 'contactName',
    senariocontactemail: 'contactEmail', senariocontactphone: 'contactPhone',
    senariocontactwebsite: 'contactWebsite',
  } as Partial<Record<string, keyof CoverPageData>>)[normalized] ?? null;
}

export function importDocx(bytes: Uint8Array, filename = 'Sans titre.docx'): ScenarioFile {
  const archive = readDocxParts(bytes);
  const documentXml = decodeTextFile(archive[REQUIRED_PART]);
  const stylesXml = archive['word/styles.xml'] ? decodeTextFile(archive['word/styles.xml']) : '';
  const coreXml = archive['docProps/core.xml'] ? decodeTextFile(archive['docProps/core.xml']) : '';
  assertSafeXml(documentXml); assertSafeXml(stylesXml); assertSafeXml(coreXml);
  if (!/<(?:[\w-]+:)?document\b/i.test(documentXml)) throw new Error('Le document Word principal est invalide.');
  const paragraphs = parseParagraphs(documentXml, parseStyles(stylesXml));
  const cover: Partial<CoverPageData> = {};
  const blocks: ScenarioInterchangeBlock[] = [];
  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index];
    const field = titleField(paragraph.styleId) ?? titleField(paragraph.styleName);
    if (field && !blocks.length) {
      const value = paragraph.text.trim();
      if (value) cover[field] = cover[field] ? `${cover[field]}\n${value}` : value;
      continue;
    }
    if (!paragraph.text.trim() && !explicitType(paragraph)) continue;
    const type = explicitType(paragraph) ?? inferredType(paragraph, paragraphs[index + 1]);
    blocks.push({ type, runs: paragraph.runs });
  }
  if (!blocks.length) throw new Error('Le fichier DOCX ne contient aucun texte de scénario lisible.');
  const title = cover.projectName || coreTitle(coreXml) || filenameTitle(filename);
  return createInterchangeScenario(title, blocks, cover);
}

function wordRun(run: RichTextRun): string {
  const properties = [run.bold ? '<w:b/>' : '', run.italic ? '<w:i/>' : '', run.underline ? '<w:u w:val="single"/>' : ''].join('');
  const fragments = run.text.split('\n').flatMap((line, index) => [index ? '<w:br/>' : '', line ? `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>` : '']).join('');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${fragments}</w:r>`;
}

function wordParagraph(style: string, runs: RichTextRun[]): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.length ? runs.map(wordRun).join('') : '<w:r><w:t></w:t></w:r>'}</w:p>`;
}

function titleWordParagraph(style: string, value: string): string {
  return value.trim() ? wordParagraph(style, [{ text: value.trim() }]) : '';
}

function stylesXml(): string {
  const style = (id: string, name: string, paragraphProperties = '', runProperties = '') =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>${paragraphProperties ? `<w:pPr>${paragraphProperties}</w:pPr>` : ''}${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ''}</w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  ${style('Normal', 'Normal')}
  ${style('SenarioSceneHeading', 'Scene Heading', '<w:spacing w:before="240"/><w:keepNext/>', '<w:b/>')}
  ${style('SenarioAction', 'Action', '<w:spacing w:before="120"/>')}
  ${style('SenarioCharacter', 'Character', '<w:ind w:left="4752"/><w:spacing w:before="120"/><w:keepNext/>')}
  ${style('SenarioDialogue', 'Dialogue', '<w:ind w:left="2376" w:right="1800"/>')}
  ${style('SenarioParenthetical', 'Parenthetical', '<w:ind w:left="3168" w:right="2304"/>')}
  ${style('SenarioTransition', 'Transition', '<w:jc w:val="right"/><w:spacing w:before="120"/>')}
  ${style('SenarioTitle', 'Senario Title', '<w:jc w:val="center"/><w:spacing w:before="2400" w:after="480"/>', '<w:b/><w:sz w:val="36"/>')}
  ${style('SenarioAuthor', 'Senario Author', '<w:jc w:val="center"/><w:spacing w:after="240"/>')}
  ${style('SenarioDirector', 'Senario Director', '<w:jc w:val="center"/>')}
  ${style('SenarioProduction', 'Senario Production', '<w:jc w:val="center"/>')}
  ${style('SenarioDuration', 'Senario Duration', '<w:jc w:val="center"/>')}
  ${style('SenarioVersion', 'Senario Version', '<w:jc w:val="center"/>')}
  ${style('SenarioDate', 'Senario Date', '<w:jc w:val="center"/>')}
  ${style('SenarioRights', 'Senario Rights', '<w:spacing w:before="240"/>')}
  ${style('SenarioContactName', 'Senario Contact Name')}
  ${style('SenarioContactEmail', 'Senario Contact Email')}
  ${style('SenarioContactPhone', 'Senario Contact Phone')}
  ${style('SenarioContactWebsite', 'Senario Contact Website')}
</w:styles>`;
}

function documentXml(document: ScenarioFile): string {
  const cover = document.coverPage;
  const titlePage = document.coverPageHidden || !hasCoverPageContent(cover) ? '' : [
    titleWordParagraph('SenarioTitle', cover.projectName || document.title),
    titleWordParagraph('SenarioAuthor', cover.screenwriter),
    titleWordParagraph('SenarioDirector', cover.director),
    titleWordParagraph('SenarioProduction', cover.production),
    titleWordParagraph('SenarioDuration', cover.duration),
    titleWordParagraph('SenarioVersion', cover.version),
    titleWordParagraph('SenarioDate', cover.date),
    titleWordParagraph('SenarioRights', cover.rights),
    titleWordParagraph('SenarioContactName', cover.contactName),
    titleWordParagraph('SenarioContactEmail', cover.contactEmail),
    titleWordParagraph('SenarioContactPhone', cover.contactPhone),
    titleWordParagraph('SenarioContactWebsite', cover.contactWebsite),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
  ].filter(Boolean).join('');
  const body = scenarioBlocks(document).map(block => wordParagraph(EXPORTED_STYLES[block.type], block.runs)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${titlePage}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="2160" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function coreProperties(document: ScenarioFile): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(document.coverPage.projectName || document.title)}</dc:title><dc:creator>${xmlEscape(document.coverPage.screenwriter)}</dc:creator><cp:lastModifiedBy>Senario</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export function exportDocx(document: ScenarioFile): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    'word/document.xml': strToU8(documentXml(document)),
    'word/styles.xml': strToU8(stylesXml()),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(coreProperties(document)),
    'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Senario</Application><AppVersion>1.0</AppVersion></Properties>`),
  };
  return zipSync(files, { level: 6 });
}
