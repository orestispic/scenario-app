import type { ReadingSettings, SpeechSegment } from './text';
export interface VoiceStatus { installed: boolean; bytes: number; downloadBytes: number; supported: boolean }
export interface AudioBackend {
  status(): Promise<VoiceStatus>;
  begin(): Promise<number>;
  synthesize(text: string, settings: ReadingSettings, generation: number): Promise<ArrayBuffer>;
}
export interface AudioSnapshot { phase: 'idle'|'checking'|'missing'|'loading'|'playing'|'paused'|'error'; segments: SpeechSegment[]; index: number; progress: number; error: string }
const initial = (): AudioSnapshot => ({ phase:'idle', segments:[], index:0, progress:0, error:'' });
/** A single player owns cancellation, buffering and prefetch across all workspaces. */
export class ReadingController {
  private snapshot = initial(); private listeners = new Set<() => void>();
  private ticket = 0; private navigation = 0; private generation = 0;
  private audio: HTMLAudioElement | null = null; private timer: ReturnType<typeof setTimeout> | null = null;
  private objectUrl = ''; private prepared = new Map<number, Promise<ArrayBuffer>>();
  private settings!: ReadingSettings; private paused = false;
  private control: Promise<number> = Promise.resolve(0);
  constructor(private backend: AudioBackend, private createAudio = () => new Audio()) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<AudioSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  private nextGeneration() { this.control = this.control.catch(() => 0).then(() => this.backend.begin()); return this.control; }
  private release() {
    if (this.timer) {clearTimeout(this.timer);this.timer=null;}
    if (this.audio) {this.audio.pause();this.audio.onended=null;this.audio.ontimeupdate=null;this.audio.onerror=null;this.audio.removeAttribute('src');this.audio.load();this.audio=null;}
    if (this.objectUrl) {URL.revokeObjectURL(this.objectUrl);this.objectUrl='';}
  }
  stop = () => { ++this.ticket; ++this.navigation; this.release();this.prepared.clear();this.paused=false;this.update(initial());void this.nextGeneration().catch(() => {}); };
  async start(segments: SpeechSegment[], settings: ReadingSettings) {
    this.stop(); if (!segments.length) return;
    const ticket=this.ticket; this.settings={...settings}; this.update({phase:'checking',segments,index:0});
    try {
      const status=await this.backend.status();if(ticket!==this.ticket)return;
      if(!status.supported)throw new Error('La lecture hors ligne est disponible dans l’application Windows installée.');
      if(!status.installed){this.update({phase:'missing'});return;}
      this.generation=await this.nextGeneration();if(ticket!==this.ticket)return;
      await this.load(0,ticket);
    } catch(e) {if(ticket===this.ticket)this.update({phase:'error',error:String(e instanceof Error?e.message:e)});}
  }
  private prepare(index:number) {
    if(!this.prepared.has(index)) {
      const promise=this.backend.synthesize(this.snapshot.segments[index].text,this.settings,this.generation);
      void promise.catch(() => {}); this.prepared.set(index,promise);
    }
    return this.prepared.get(index)!;
  }
  private async load(index:number,ticket:number) {
    if(ticket!==this.ticket)return;
    if(index>=this.snapshot.segments.length){this.stop();return;}
    const navigation=++this.navigation; this.release();this.update({phase:this.paused?'paused':'loading',index,progress:0});
    try {
      const bytes=await this.prepare(index);
      if(ticket!==this.ticket || navigation!==this.navigation)return;
      for(const key of this.prepared.keys())if(key<index-1 || key>index+1)this.prepared.delete(key);
      this.objectUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
      const audio=this.createAudio();this.audio=audio;audio.src=this.objectUrl;
      audio.ontimeupdate=()=>{if(ticket===this.ticket && audio===this.audio)this.update({progress:audio.duration?audio.currentTime/audio.duration:0});};
      audio.onerror=()=>{if(audio===this.audio)this.update({phase:'error',error:'Le fichier audio ne peut pas être lu. Relancez la lecture.'});};
      audio.onended=()=>{this.timer=setTimeout(()=>{this.timer=null;if(!this.paused)void this.load(index+1,ticket);},this.snapshot.segments[index].pauseAfter);};
      if(index+1<this.snapshot.segments.length)void this.prepare(index+1).catch(()=>{});
      const play=async()=>{if(ticket!==this.ticket || navigation!==this.navigation || this.paused)return;try{await audio.play();if(audio===this.audio&&!this.paused)this.update({phase:'playing'});}catch(e){if(audio===this.audio&&!this.paused)this.update({phase:'error',error:String(e)});}};
      if(!this.paused) {this.timer=setTimeout(()=>{this.timer=null;void play();},this.snapshot.segments[index].pauseBefore);}
    } catch(e){if(ticket===this.ticket && navigation===this.navigation)this.update({phase:'error',error:String(e)});}
  }
  toggle = async () => {
    if(['idle','missing','checking','error'].includes(this.snapshot.phase))return;
    this.paused=!this.paused;
    if(this.paused){this.audio?.pause();this.update({phase:'paused'});}
    else if(this.audio){const audio=this.audio;try{if(audio.ended)await this.load(this.snapshot.index+1,this.ticket);else{await audio.play();if(audio===this.audio&&!this.paused)this.update({phase:'playing'});}}catch(e){if(audio===this.audio&&!this.paused)this.update({phase:'error',error:String(e)});}}
    else this.update({phase:'loading'});
  };
  skip = (offset:number) => {if(['playing','paused','loading'].includes(this.snapshot.phase))void this.load(Math.max(0,this.snapshot.index+offset),this.ticket);};
  seek = (fraction:number) => {if(this.audio && Number.isFinite(this.audio.duration))this.audio.currentTime=Math.max(0,Math.min(1,fraction))*this.audio.duration;};
}
