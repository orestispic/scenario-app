import { it, expect } from 'vitest';
import { version } from '../../package.json';
import tauri from '../../src-tauri/tauri.conf.json';
import preproduction from '../../src-tauri/tauri.preproduction.conf.json';
import preproductionLocal from '../../src-tauri/tauri.preproduction-local.conf.json';
import cargo from '../../src-tauri/Cargo.toml?raw';
import runtime from './runtime.ts?raw';
import releaseWorkflow from '../../.github/workflows/release.yml?raw';
import preproductionWorkflow from '../../.github/workflows/validate-draft.yml?raw';
import updaterVerification from '../../scripts/verify-updater-release.mjs?raw';
import windowsLifecycle from '../../scripts/phase14-windows-lifecycle.ps1?raw';
import nativeLifecycle from '../../scripts/phase14-native-e2e.mjs?raw';
it('publishes matching versions and never depends on a local env for the API client version', () => {
  expect(tauri.version).toBe(version);
  expect(cargo).toContain(`version = "${version}"`);
  expect(runtime).toContain("import { version as clientVersion } from '../../package.json'");
  expect(runtime).not.toContain('VITE_SCENARIO_CLIENT_VERSION');
});

it('keeps HTML drag and drop enabled in every Windows build', () => {
  for (const config of [tauri, preproduction, preproductionLocal]) {
    expect(config.app.windows.every(window => window.dragDropEnabled === false)).toBe(true);
  }
});

it('builds tagged public releases only against production', () => {
  expect(releaseWorkflow).toContain('scenario-commercial-api-production.ore-picard.workers.dev');
  expect(releaseWorkflow).toContain('rtqlsnwfbtnscilfdirv.supabase.co');
  expect(releaseWorkflow).toContain('VITE_SCENARIO_ENVIRONMENT: production');
  expect(releaseWorkflow).toContain('VITE_SCENARIO_AUTH_MODE: supabase');
  expect(releaseWorkflow).toContain('${{ vars.VITE_SUPABASE_ANON_KEY_PRODUCTION }}');
  expect(releaseWorkflow).toContain('args: --bundles nsis');
  expect(releaseWorkflow).not.toContain('scenario-commercial-api-preproduction');
  expect(releaseWorkflow).not.toContain('zblnsdyaoljnezxdidtx');
  expect(releaseWorkflow).not.toContain('tauri.preproduction.conf.json');
  expect(releaseWorkflow).not.toMatch(/VITE_.*(?:SECRET|PRIVATE|SERVICE_ROLE|OPENAI|STRIPE|PEPPER)/i);
});

it('verifies and exercises production installer paths', () => {
  expect(updaterVerification).toContain('senario_${version}_x64-setup.exe');
  expect(updaterVerification).not.toContain('senario Beta_${version}_x64-setup.exe');
  expect(windowsLifecycle).toContain("Join-Path $env:LOCALAPPDATA 'senario'");
  expect(windowsLifecycle).not.toContain("Join-Path $env:LOCALAPPDATA 'senario Beta'");
  expect(nativeLifecycle).toContain('scenario-commercial-api-production.ore-picard.workers.dev');
  expect(nativeLifecycle).toContain('rtqlsnwfbtnscilfdirv.supabase.co');
  expect(nativeLifecycle).not.toContain('scenario-commercial-api-preproduction');
});

it('keeps preproduction manual, isolated and unpublished', () => {
  expect(preproductionWorkflow).toContain('workflow_dispatch:');
  expect(preproductionWorkflow).toContain('scenario-commercial-api-preproduction');
  expect(preproductionWorkflow).toContain('VITE_SCENARIO_ENVIRONMENT: staging');
  expect(preproductionWorkflow).toContain('npm run build:beta');
  expect(preproductionWorkflow).not.toMatch(/\bpush:/);
  expect(preproductionWorkflow).not.toContain('tauri-apps/tauri-action');
  expect(preproductionWorkflow).not.toContain('gh release');
  expect(preproductionWorkflow).not.toContain('scenario-commercial-api-production');
});
