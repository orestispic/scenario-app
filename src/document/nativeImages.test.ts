import { afterEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { cacheNativeImage, isNativeImageUrl, nativeImageStoreAvailable, portableScenarioChunks } from './nativeImages';
import { normalizeTechnicalImageAssets } from '../editor/technicalImageAssets';
import { writeScenario, readScenario } from './persistence';

afterEach(() => { vi.unstubAllGlobals(); invoke.mockReset(); });
describe('native image transport', () => {
  it('keeps cache URLs bounded and expands every image in portable exports', async () => {
    const url = `http://senario-image.localhost/${'a'.repeat(64)}`;
    expect(isNativeImageUrl(`${url}/../salt`)).toBe(false);
    expect(isNativeImageUrl(`https://senario-image.localhost/${'a'.repeat(64)}`)).toBe(false);
    const image = { id: 'b'.repeat(64), dataUrl: url, contentType: 'image/png', sizeBytes: 3, width: 1, height: 1 };
    expect(normalizeTechnicalImageAssets({ [image.id]: image })[image.id]).toEqual(image);
    invoke.mockResolvedValue('data:image/png;base64,AQID');
    let output = '';
    for await (const chunk of portableScenarioChunks({ technicalImageAssets: { [image.id]: image } })) output += chunk;
    expect(JSON.parse(output).technicalImageAssets[image.id].dataUrl).toBe('data:image/png;base64,AQID');
    expect(output).not.toContain(url);
    invoke.mockRejectedValue(new Error('Image manquante'));
    await expect((async () => { for await (const _chunk of portableScenarioChunks({ dataUrl: url })) { /* consume */ } })()).rejects.toThrow('manquante');
  });
  it('uses streaming native commands only inside the actual native webview', async () => {
    const data = 'data:image/png;base64,AQID';
    expect(await cacheNativeImage(data)).toBe(data);
    expect(invoke).not.toHaveBeenCalled();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: vi.fn() } });
    vi.stubGlobal('navigator', { platform: 'Win32' });
    invoke.mockResolvedValue('cached');
    expect(await cacheNativeImage(data)).toBe('cached');
    await writeScenario('large.scenario', '{}');
    expect(invoke).toHaveBeenCalledWith('write_scenario_streamed', { kind: 'write_scenario', path: 'large.scenario', contents: '{}' });
    await readScenario('large.scenario');
    expect(invoke).toHaveBeenCalledWith('read_scenario_streamed', { path: 'large.scenario' });
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(nativeImageStoreAvailable()).toBe(false);
    expect(await cacheNativeImage(data)).toBe(data);
  });
});
