import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AudioBackend, VoiceStatus } from './controller';
export const nativeAudio: AudioBackend = {
  status: () => isTauri() ? invoke<VoiceStatus>('audio_status') : Promise.resolve({installed:false,bytes:0,downloadBytes:92_883_356,supported:false}),
  begin: () => isTauri() ? invoke<number>('audio_new_generation') : Promise.resolve(0),
  synthesize: (text,settings,generation) => invoke<ArrayBuffer>('audio_synthesize', {request:{text,settingsKey:JSON.stringify({titles:settings.titles,characters:settings.characters}),generation}}),
};
