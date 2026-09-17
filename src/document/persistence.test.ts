import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open, save }));
import { chooseInterchangeToOpen, saveInterchangeFile, writeAutosave, writeBackup, writeScenario, clearRecovery, choosePdfToSave, chooseWorkspacePdfToSave, registerBrowserPdf, readPdf, writePdf } from './persistence';

describe('Écritures de projet ordonnées', () => {
  beforeEach(() => { invoke.mockReset(); open.mockReset(); save.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  it('exports every workspace PDF in a browser without native dialogs or IPC', async () => {
    const anchor = { click:vi.fn(), remove:vi.fn(), href:'', download:'', hidden:false };
    vi.stubGlobal('window', { setTimeout:vi.fn() });
    vi.stubGlobal('document', { createElement:()=>anchor, body:{append:vi.fn()} });
    expect(await choosePdfToSave('Film: essai')).toBe('Film- essai.pdf');
    expect(await chooseWorkspacePdfToSave('Film', 'depouillement')).toBe('Film-depouillement.pdf');
    expect(await chooseWorkspacePdfToSave('Film', 'decoupage-technique')).toBe('Film-decoupage-technique.pdf');
    await writePdf('Film.pdf', new TextEncoder().encode('%PDF-1.4'));
    expect(anchor.download).toBe('Film.pdf');expect(anchor.click).toHaveBeenCalledOnce();
    URL.revokeObjectURL(anchor.href);
    expect(invoke).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
  });
  it('reads only the explicitly selected browser PDF and rejects invalid or oversized files', async () => {
    vi.stubGlobal('window', {});
    const file = new File(['%PDF-1.4'], 'Scène.pdf', {type:'application/pdf'});
    const path = registerBrowserPdf(file);
    expect(new TextDecoder().decode(Uint8Array.from(await readPdf(path)))).toBe('%PDF-1.4');
    await expect(readPdf('some-other-file.pdf')).rejects.toThrow('Sélectionnez');
    expect(()=>registerBrowserPdf(new File(['text'],'file.txt'))).toThrow('PDF');
    expect(()=>registerBrowserPdf({name:'large.pdf',size:65*1024*1024} as File)).toThrow('64 Mo');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('une ancienne autosave ne peut pas dépasser la sauvegarde de changement de version', async () => {
    let finish!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const old = writeAutosave('ancienne');
    const backup = writeBackup('version sortante');
    const next = writeAutosave('toutes les versions');
    const file = writeScenario('test.scenario', 'toutes les versions');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    finish(); await Promise.all([old, backup, next, file]);
    expect(invoke.mock.calls).toEqual([
      ['write_autosave', { contents: 'ancienne' }], ['write_backup', { contents: 'version sortante' }],
      ['write_autosave', { contents: 'toutes les versions' }], ['write_scenario', { path: 'test.scenario', contents: 'toutes les versions' }],
    ]);
  });
  it('un échec est signalé sans bloquer les sauvegardes suivantes', async () => {
    invoke.mockRejectedValueOnce(new Error('Disque plein')).mockResolvedValue(undefined);
    await expect(writeBackup('sortante')).rejects.toThrow('Disque plein');
    await expect(writeAutosave('nouvelle')).resolves.toBeUndefined();
    await expect(clearRecovery()).resolves.toBeUndefined();
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['write_backup', 'write_autosave', 'clear_recovery']);
  });
  it('lit un format d’échange via la commande native bornée', async () => {
    open.mockResolvedValue('C:\\Films\\essai.fdx');
    invoke.mockResolvedValue([60, 70, 68, 88]);
    await expect(chooseInterchangeToOpen('fdx')).resolves.toEqual({ name: 'essai.fdx', bytes: Uint8Array.from([60, 70, 68, 88]) });
    expect(invoke).toHaveBeenCalledWith('read_interchange_file', { path: 'C:\\Films\\essai.fdx' });
  });
  it('ajoute l’extension et écrit un export binaire via la commande native', async () => {
    save.mockResolvedValue('C:\\Films\\essai');
    invoke.mockResolvedValue(undefined);
    await expect(saveInterchangeFile('docx', 'essai', Uint8Array.from([0x50, 0x4b]))).resolves.toBe('C:\\Films\\essai.docx');
    expect(invoke).toHaveBeenCalledWith('write_interchange_file', { path: 'C:\\Films\\essai.docx', contents: [0x50, 0x4b] });
  });
});
