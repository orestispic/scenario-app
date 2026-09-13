import { it, expect } from 'vitest';
import { version } from '../../package.json';
import tauri from '../../src-tauri/tauri.conf.json';
import cargo from '../../src-tauri/Cargo.toml?raw';
import runtime from './runtime.ts?raw';
it('publishes matching versions and never depends on a local env for the API client version', () => {
  expect(tauri.version).toBe(version);
  expect(cargo).toContain(`version = "${version}"`);
  expect(runtime).toContain("import { version as clientVersion } from '../../package.json'");
  expect(runtime).not.toContain('VITE_SCENARIO_CLIENT_VERSION');
});
