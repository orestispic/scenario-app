import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const archive = readFileSync('outputs/audio-build/onnxruntime.zip');
assert.equal(hash(archive), '174c616efc0271194488642a72f1a514e01487da4dfe84c49296d66e40ebe0da');
const files = unzipSync(archive);
for (const [origin, target] of [
  ['lib/onnxruntime.dll', 'onnxruntime.dll'],
  ['lib/onnxruntime_providers_shared.dll', 'onnxruntime_providers_shared.dll'],
  ['LICENSE', 'ONNX-RUNTIME-LICENSE.txt'], ['ThirdPartyNotices.txt', 'ThirdPartyNotices.txt'],
]) {
  assert.equal(hash(readFileSync(`src-tauri/audio-runtime/${target}`)), hash(files[`onnxruntime-win-x64-1.22.0/${origin}`]), `Cached ONNX resource differs from verified archive: ${target}`);
}
assert.equal(hash(readFileSync('src-tauri/audio-runtime/espeak-ng-1.52.0-source.zip')), 'b4517592e3cbc43703bb1c782702eafb98097659e0b7e96e69c32ee32ae5003a');
assert.equal(hash(readFileSync('outputs/audio-build/espeak-ng.msi')), '7f673c709ea5dd579d3b5ebb98688cc575328a6ab7438d2bc405b88cedaeafb9');
assert.equal(hash(readFileSync('src-tauri/audio-runtime/espeak/COPYING.txt')), hash(readFileSync('licenses/audio/GPL-3.0.txt')));
for (const path of ['src-tauri/audio-runtime/espeak/espeak-ng.exe', 'src-tauri/audio-runtime/espeak/espeak-ng-data',
  'THIRD_PARTY_NOTICES', 'THIRD_PARTY_NOTICES_AUDIO.txt', 'licenses/audio', 'src-tauri/icons/scenario-file-icon.ico']) assert.ok(existsSync(path), `Missing resource: ${path}`);
console.log('PASS native resources: ONNX bytes match pinned archive; eSpeak MSI/source hashes, GPL copy, notices and resource presence checked. eSpeak extracted executable provenance requires clean extraction in CI.');
