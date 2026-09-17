import type { ScenarioFile } from './scenarioFile';

export type InterchangeFormat = 'fdx' | 'fountain' | 'docx';

export interface InterchangeFormatDefinition {
  extension: InterchangeFormat;
  label: string;
  mimeType: string;
}

export const INTERCHANGE_FORMATS: Record<InterchangeFormat, InterchangeFormatDefinition> = {
  fdx: { extension: 'fdx', label: 'Final Draft (FDX)', mimeType: 'application/xml' },
  fountain: { extension: 'fountain', label: 'Fountain', mimeType: 'text/plain;charset=utf-8' },
  docx: { extension: 'docx', label: 'Word (DOCX)', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
};

export async function importInterchange(format: InterchangeFormat, bytes: Uint8Array, filename: string): Promise<ScenarioFile> {
  if (format === 'fdx') return (await import('./fdx')).importFdx(bytes, filename);
  if (format === 'fountain') return (await import('./fountain')).importFountain(bytes, filename);
  return (await import('./docx')).importDocx(bytes, filename);
}

export async function exportInterchange(format: InterchangeFormat, document: ScenarioFile): Promise<Uint8Array> {
  if (format === 'fdx') return (await import('./fdx')).exportFdx(document);
  if (format === 'fountain') return (await import('./fountain')).exportFountain(document);
  return (await import('./docx')).exportDocx(document);
}
