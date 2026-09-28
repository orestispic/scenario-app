import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Schema} from '@tiptap/pm/model';
import {EditorState, TextSelection} from '@tiptap/pm/state';
import {DecorationSet} from '@tiptap/pm/view';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildSpeech, DEFAULT_READING_SETTINGS as settings, normalizeSceneHeadingForSpeech, splitSpeech, type SpeechSegment} from './text';
import {ReadingController, type AudioBackend} from './controller';
import {SelectionAudioButton} from './SelectionAudioButton';
import notices from '../../THIRD_PARTY_NOTICES_AUDIO.txt?raw';
import apache from '../../licenses/audio/Apache-2.0.txt?raw';
import gpl from '../../licenses/audio/GPL-3.0.txt?raw';
import {createAudioHighlight,audioHighlightKey} from './highlight';

const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*',group:'block',attrs:{scenarioType:{default:'ACTION'},blockId:{default:''}}},text:{group:'inline'}},marks:{comment:{attrs:{threadId:{default:''}}},bold:{}}});
const paragraph=(text:string,type='ACTION',id=text)=>schema.node('paragraph',{scenarioType:type,blockId:id},text?schema.text(text):undefined);
const doc=schema.node('doc',null,[paragraph('INT. CUISINE — JOUR','SCENE_HEADING'),paragraph('Camille ouvre la fenêtre.'),paragraph('CAMILLE','CHARACTER'),paragraph('Bonjour Léon. Tu viens ?','DIALOGUE'),paragraph('EXT. RUE — NUIT','SCENE_HEADING'),paragraph('La rue est vide.')]);
const blockPos=(index:number)=>{let pos=1;for(let i=0;i<index;i++)pos+=doc.child(i).nodeSize;return pos;};
describe('audio text and selection',()=>{
  it('decorates the reading block without altering comments, text or selection',()=>{
    const plugin=createAudioHighlight();let state=EditorState.create({doc,plugins:[plugin],selection:TextSelection.create(doc,2,6)});
    const before=state.doc.toJSON();state=state.apply(state.tr.setMeta(audioHighlightKey,doc.child(1).attrs.blockId).setMeta('addToHistory',false));
    expect(state.doc.toJSON()).toEqual(before);expect(state.selection.from).toBe(2);expect(state.selection.to).toBe(6);
    const decorations=plugin.props.decorations?.call(plugin,state) as DecorationSet;expect(decorations.find()).toHaveLength(1);
    state=state.apply(state.tr.setMeta(audioHighlightKey,''));expect((plugin.props.decorations?.call(plugin,state) as DecorationSet).find()).toHaveLength(0);
  });
  it('disables the selection button without a selection and explains why',()=>{
    const html=renderToStaticMarkup(<SelectionAudioButton enabled={false} loading={false} playing={false} onRead={()=>{}}/>);
    expect(html).toContain('disabled=""');expect(html).toContain('Sélectionnez du texte à lire');
    expect(buildSpeech(doc,'selection',1,1,settings)).toEqual([]);
  });
  it('enables selection and prevents focus loss on pointer down',()=>{
    const props={enabled:true,loading:false,playing:false,onRead:vi.fn()};
    expect(renderToStaticMarkup(<SelectionAudioButton {...props}/>)).not.toContain('disabled=""');
    const button=SelectionAudioButton(props);const preventDefault=vi.fn();button.props.onMouseDown({preventDefault});
    expect(preventDefault).toHaveBeenCalledOnce();button.props.onClick();expect(props.onRead).toHaveBeenCalledOnce();
  });
  it('reads an exact partial, multi-word selection without neighbours',()=>{
    const from=blockPos(1)+8,to=blockPos(1)+23;
    expect(buildSpeech(doc,'selection',from,to,settings).map(x=>x.text).join('')).toBe(doc.textBetween(from,to));
  });
  it('keeps multi-paragraph boundaries, ignores preferences for explicit selections',()=>{
    const from=blockPos(2)+2,to=blockPos(3)+7;
    expect(buildSpeech(doc,'selection',from,to,{...settings,characters:false}).map(x=>x.text)).toEqual(['MILLE','Bonjour']);
  });
  it('does not mutate the document, comment marks or selection',()=>{
    const marked=schema.node('doc',null,[schema.node('paragraph',{blockId:'b'},schema.text('Bonjour Camille',[schema.mark('comment',{threadId:'private-note'})]))]);
    const state=EditorState.create({doc:marked,selection:TextSelection.create(marked,2,9)}),before=state.toJSON();
    const speech=buildSpeech(state.doc,'selection',state.selection.from,state.selection.to,settings);
    expect(speech[0].text).toBe('onjour ');expect(JSON.stringify(speech)).not.toContain('private-note');expect(state.toJSON()).toEqual(before);
  });
  it('limits current scene and cursor scopes correctly',()=>{
    const scene=buildSpeech(doc,'scene',blockPos(3)+3,blockPos(3)+3,settings);
    expect(scene).toHaveLength(4);expect(scene[0].pauseBefore).toBe(250);expect(scene[0].pauseAfter).toBe(450);
    expect(buildSpeech(doc,'cursor',blockPos(3)+8,blockPos(3)+8,settings)[0].text).toBe('Léon. Tu viens ?');
  });
  it('omits names and headings only when requested',()=>{
    expect(buildSpeech(doc,'all',1,1,{...settings,titles:false,characters:false})).toHaveLength(3);
  });
  it('preserves all text and splits at sentence boundaries',()=>{
    const text='Bonjour !  '+ 'Une longue phrase entière. '.repeat(30)+'Fin…';
    const chunks=splitSpeech(text,100);expect(chunks.join('')).toBe(text);expect(chunks.every(x=>/[.!?…]\s*$/u.test(x))).toBe(true);
  });
  it('sends every final letter and punctuation mark of the French regression phrase',()=>{
    const text='Je vais finir ce scénario avant midi. Cette fois, chaque mot comptera.';
    expect(splitSpeech(text).join('')).toBe(text);
    const exactDoc=schema.node('doc',null,[paragraph(text,'DIALOGUE','final-vowels')]);
    expect(buildSpeech(exactDoc,'all',1,1,settings).map(segment=>segment.text).join('')).toBe(text);
  });
  it.each([
    ['INT. CUISINE — JOUR','INTÉRIEUR CUISINE — JOUR'],
    ['int chambre - nuit','INTÉRIEUR chambre - nuit'],
    ['EXT RUE — SOIR','EXTÉRIEUR RUE — SOIR'],
    ['Int./Ext. VOITURE — JOUR','INTÉRIEUR / EXTÉRIEUR VOITURE — JOUR'],
    ['INT / EXT. VOITURE — JOUR','INTÉRIEUR / EXTÉRIEUR VOITURE — JOUR'],
    ['ext./int MAISON — NUIT','EXTÉRIEUR / INTÉRIEUR MAISON — NUIT'],
    ['EXT / INT. MAISON — NUIT','EXTÉRIEUR / INTÉRIEUR MAISON — NUIT'],
  ])('expands scene-heading abbreviation %s only for speech',(source,spoken)=>{
    expect(normalizeSceneHeadingForSpeech(source)).toBe(spoken);
    const headingDoc=schema.node('doc',null,[paragraph(source,'SCENE_HEADING','heading')]);
    expect(buildSpeech(headingDoc,'all',1,1,settings)[0].text).toBe(spoken);
    expect(headingDoc.textContent).toBe(source);
  });
  it('normalizes invalid settings and includes distribution notices',()=>{
    for(const name of ['Kokoro','SIWIS','ff_siwis','ONNX Runtime','eSpeak','source.zip'])expect(notices).toContain(name);
    expect(apache).toContain('Apache License');expect(gpl).toContain('GNU GENERAL PUBLIC LICENSE');
  });
});

const segment=(text:string):SpeechSegment=>({text,blockId:text,label:text,pauseBefore:0,pauseAfter:100});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
function harness(overrides:Partial<AudioBackend>={}) {
  const backend:AudioBackend={status:vi.fn(async()=>({installed:true,supported:true,bytes:1,downloadBytes:1})),begin:vi.fn(async()=>1),synthesize:vi.fn(async()=>new ArrayBuffer(8)),...overrides};
  const players:Array<HTMLAudioElement>=[];
  const create=vi.fn(()=>{const audio={src:'',currentTime:0,duration:10,ended:false,play:vi.fn(async()=>{}),pause:vi.fn(),removeAttribute:vi.fn(),load:vi.fn(),onended:null,ontimeupdate:null,onerror:null} as unknown as HTMLAudioElement;players.push(audio);return audio;});
  return {controller:new ReadingController(backend,create),backend,players,create};
}
describe('nonblocking local playback lifecycle',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
  afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
  it('reports missing model without starting any download or synthesis',async()=>{
    const h=harness({status:async()=>({installed:false,supported:true,bytes:0,downloadBytes:92883356})});
    await h.controller.start([segment('Bonjour')],settings);expect(h.controller.getSnapshot().phase).toBe('missing');expect(h.backend.synthesize).not.toHaveBeenCalled();
  });
  it('sends exactly the selected text and prefetches the next segment',async()=>{
    const h=harness();await h.controller.start([segment('Bonjour Léon'),segment('À demain !')],settings);await vi.advanceTimersByTimeAsync(0);
    expect(h.backend.synthesize).toHaveBeenNthCalledWith(1,'Bonjour Léon',settings,1);expect(h.backend.synthesize).toHaveBeenNthCalledWith(2,'À demain !',settings,1);expect(h.controller.getSnapshot().phase).toBe('playing');h.controller.stop();
  });
  it('stays responsive and cancels pending synthesis without stale playback',async()=>{
    const result=deferred<ArrayBuffer>();const h=harness({synthesize:()=>result.promise});
    const starting=h.controller.start([segment('Bonjour')],settings);await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getSnapshot().phase).toBe('loading');h.controller.stop();expect(h.controller.getSnapshot().phase).toBe('idle');result.resolve(new ArrayBuffer(8));await starting;await vi.advanceTimersByTimeAsync(0);expect(h.create).not.toHaveBeenCalled();
  });
  it('pause during synthesis stays paused when the result arrives',async()=>{
    const result=deferred<ArrayBuffer>();const h=harness({synthesize:()=>result.promise});const starting=h.controller.start([segment('Bonjour')],settings);await vi.advanceTimersByTimeAsync(0);await h.controller.toggle();result.resolve(new ArrayBuffer(8));await starting;await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getSnapshot().phase).toBe('paused');expect(h.players[0].play).not.toHaveBeenCalled();await h.controller.toggle();expect(h.controller.getSnapshot().phase).toBe('playing');h.controller.stop();
  });
  it('previous results cannot replace a newer reading request',async()=>{
    const first=deferred<ArrayBuffer>();const h=harness({synthesize:async(text)=>text==='old'?first.promise:new ArrayBuffer(8)});
    const old=h.controller.start([segment('old')],settings);await vi.advanceTimersByTimeAsync(0);await h.controller.start([segment('new')],settings);first.resolve(new ArrayBuffer(8));await old;await vi.advanceTimersByTimeAsync(0);
    expect(h.create).toHaveBeenCalledOnce();expect(h.controller.getSnapshot().segments[0].text).toBe('new');h.controller.stop();
  });
  it('next/previous and progress use the cached preparation',async()=>{
    const h=harness();await h.controller.start([segment('one'),segment('two')],settings);await vi.advanceTimersByTimeAsync(0);h.controller.skip(1);await vi.advanceTimersByTimeAsync(0);expect(h.controller.getSnapshot().index).toBe(1);h.controller.skip(-1);await vi.advanceTimersByTimeAsync(0);expect(h.controller.getSnapshot().index).toBe(0);expect(h.backend.synthesize).toHaveBeenCalledTimes(2);
    h.controller.seek(.4);expect(h.players[h.players.length-1]?.currentTime).toBe(4);h.controller.stop();expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('surfaces an error and can recover on a fresh start',async()=>{
    const synthesize=vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(new ArrayBuffer(8));const h=harness({synthesize});await h.controller.start([segment('Bonjour')],settings);expect(h.controller.getSnapshot().phase).toBe('error');expect(h.controller.getSnapshot().error).toContain('disk full');await h.controller.start([segment('Bonjour')],settings);await vi.advanceTimersByTimeAsync(0);expect(h.controller.getSnapshot().phase).toBe('playing');h.controller.stop();
  });
});
