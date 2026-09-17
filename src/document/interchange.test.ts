import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { importDocx, exportDocx } from './docx';
import { importFdx, exportFdx } from './fdx';
import { importFountain, exportFountain } from './fountain';
import { scenarioBlocks } from './interchangeCommon';
import { createEmptyCoverPage, type ScenarioFile } from './scenarioFile';

function fixture(): ScenarioFile {
  return {
    formatVersion: 1,
    title: 'Échappée & retour',
    savedAt: '2026-09-14T10:00:00.000Z',
    characters: ['LÉA'], locations: ['CAFÉ'], times: ['JOUR'], comments: [], coverPageHidden: false,
    coverPage: {
      ...createEmptyCoverPage(), projectName: 'Échappée & retour', screenwriter: 'Anaïs Martin',
      director: 'Noé', production: 'Studio <Nord>', version: 'V2', date: '14 septembre 2026',
      rights: '© 2026', contactName: 'Anaïs', contactEmail: 'anaïs@example.test',
    },
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { scenarioType: 'SCENE_HEADING', blockId: 'scene-1', sceneNumber: 'A1' }, content: [{ type: 'text', text: 'INT. CAFÉ - JOUR' }] },
        { type: 'paragraph', attrs: { scenarioType: 'ACTION', blockId: 'action-1' }, content: [
          { type: 'text', text: 'Un ', marks: [{ type: 'italic' }] },
          { type: 'text', text: 'verre & une étoile', marks: [{ type: 'bold' }, { type: 'underline' }] },
          { type: 'hardBreak' }, { type: 'text', text: 'restent sur la table.' },
        ] },
        { type: 'paragraph', attrs: { scenarioType: 'CHARACTER', blockId: 'character-1' }, content: [{ type: 'text', text: 'LÉA' }] },
        { type: 'paragraph', attrs: { scenarioType: 'PARENTHETICAL', blockId: 'parenthetical-1' }, content: [{ type: 'text', text: '(bas)' }] },
        { type: 'paragraph', attrs: { scenarioType: 'DIALOGUE', blockId: 'dialogue-1' }, content: [{ type: 'text', text: 'On y va.' }] },
        { type: 'paragraph', attrs: { scenarioType: 'TRANSITION', blockId: 'transition-1' }, content: [{ type: 'text', text: 'FONDU AU NOIR :' }] },
      ],
    },
  };
}

function types(document: ScenarioFile): string[] {
  return scenarioBlocks(document).map(block => block.type);
}

function text(document: ScenarioFile): string[] {
  return scenarioBlocks(document).map(block => block.runs.map(run => run.text).join(''));
}

describe('échanges FDX', () => {
  it('exporte puis réimporte structure, styles, numéros et page de garde', () => {
    const bytes = exportFdx(fixture());
    expect(new TextDecoder().decode(bytes)).toContain('<FinalDraft');
    const restored = importFdx(bytes, 'autre.fdx');
    expect(types(restored)).toEqual(types(fixture()));
    expect(text(restored)).toEqual(text(fixture()));
    expect(scenarioBlocks(restored)[0].sceneNumber).toBe('A1');
    expect(scenarioBlocks(restored)[1].runs.some(run => run.bold && run.underline)).toBe(true);
    expect(restored.coverPage.projectName).toBe('Échappée & retour');
    expect(restored.coverPage.contactEmail).toBe('anaïs@example.test');
  });

  it('refuse les entités externes et un faux fichier Final Draft', () => {
    expect(() => importFdx(strToU8('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><FinalDraft><Content/></FinalDraft>'))).toThrow('interdite');
    expect(() => importFdx(strToU8('<document/>'))).toThrow('Final Draft');
  });

  it('n’ajoute pas une page de garde absente ou masquée', () => {
    const document = fixture();
    document.coverPage = createEmptyCoverPage();
    expect(new TextDecoder().decode(exportFdx(document))).not.toContain('<TitlePage>');
    document.coverPage.projectName = 'Masquée'; document.coverPageHidden = true;
    expect(new TextDecoder().decode(exportFdx(document))).not.toContain('<TitlePage>');
  });
});

describe('échanges Fountain', () => {
  it('exporte puis réimporte les six types, les styles et les métadonnées', () => {
    const bytes = exportFountain(fixture());
    const source = new TextDecoder().decode(bytes);
    expect(source).toContain('Title: Échappée & retour');
    expect(source).toContain('#A1#');
    const restored = importFountain(bytes, 'autre.fountain');
    expect(types(restored)).toEqual(types(fixture()));
    expect(text(restored)).toEqual(text(fixture()));
    expect(scenarioBlocks(restored)[1].runs.some(run => run.bold && run.underline)).toBe(true);
    expect(restored.coverPage.screenwriter).toBe('Anaïs Martin');
  });

  it('comprend les éléments forcés et ignore sections, notes et boneyards', () => {
    const source = `Title: Test\n\n# Section\n/* rien ici */\n.INTÉRIEUR MYSTÈRE #7#\n\n!UNE ACTION\n[[note cachée]]\n\n@LÉA\n(ému)\nBonjour.\n\n>COUPE À :\n`;
    const imported = importFountain(strToU8(source), 'test.fountain');
    expect(types(imported)).toEqual(['SCENE_HEADING', 'ACTION', 'CHARACTER', 'PARENTHETICAL', 'DIALOGUE', 'TRANSITION']);
    expect(scenarioBlocks(imported)[0].sceneNumber).toBe('7');
    expect(text(imported).join(' ')).not.toContain('note cachée');
  });

  it('accepte un ancien Fountain Windows-1252 sans perdre les accents', () => {
    const prefix = new TextEncoder().encode('INT. CAF');
    const suffix = new TextEncoder().encode(' - JOUR\n');
    const bytes = Uint8Array.from([...prefix, 0xc9, ...suffix]);
    expect(text(importFountain(bytes, 'ancien.fountain'))[0]).toBe('INT. CAFÉ - JOUR');
  });
});

describe('échanges DOCX', () => {
  it('produit un paquet Open XML valide et réimporte structure, styles et couverture', () => {
    const bytes = exportDocx(fixture());
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const archive = unzipSync(bytes);
    expect(archive['word/document.xml']).toBeDefined();
    expect(archive['word/styles.xml']).toBeDefined();
    const restored = importDocx(bytes, 'autre.docx');
    expect(types(restored)).toEqual(types(fixture()));
    expect(text(restored)).toEqual(text(fixture()));
    expect(scenarioBlocks(restored)[1].runs.some(run => run.bold && run.underline)).toBe(true);
    expect(restored.coverPage.projectName).toBe('Échappée & retour');
  });

  it('refuse les archives aux chemins suspects et les XML à entité externe', () => {
    const traversal = zipSync({ '../hors-dossier.txt': strToU8('x'), 'word/document.xml': strToU8('<w:document/>') });
    expect(() => importDocx(traversal)).toThrow('chemin interne interdit');
    const hostile = zipSync({
      'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>'),
    });
    expect(() => importDocx(hostile)).toThrow('interdite');
  });

  it('refuse un faux DOCX avant de modifier le document ouvert', () => {
    expect(() => importDocx(strToU8('pas une archive'), 'faux.docx')).toThrow('Open XML');
    expect(() => importDocx(zipSync({ 'word/styles.xml': strToU8('<w:styles/>') }), 'incomplet.docx')).toThrow('document.xml');
  });

  it('reconnaît les styles de scénario nommés par un document Word externe', () => {
    const styles = `<?xml version="1.0"?><w:styles xmlns:w="x">
      <w:style w:type="paragraph" w:styleId="Scene"><w:name w:val="Titre de scène"/></w:style>
      <w:style w:type="paragraph" w:styleId="Cast"><w:name w:val="Personnage"/></w:style>
      <w:style w:type="paragraph" w:styleId="Speech"><w:name w:val="Dialogue"/></w:style>
    </w:styles>`;
    const document = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Scene"/></w:pPr><w:r><w:t>EXT. PORT - NUIT</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Cast"/></w:pPr><w:r><w:t>NOÉ</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Speech"/></w:pPr><w:r><w:t>Le bateau part.</w:t></w:r></w:p>
    </w:body></w:document>`;
    const imported = importDocx(zipSync({ 'word/document.xml': strToU8(document), 'word/styles.xml': strToU8(styles) }), 'externe.docx');
    expect(types(imported)).toEqual(['SCENE_HEADING', 'CHARACTER', 'DIALOGUE']);
  });
});
