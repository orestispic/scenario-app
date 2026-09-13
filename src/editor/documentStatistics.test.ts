import { describe, expect, it } from 'vitest';
import { getDocumentStatistics, placeMarginNotes } from './documentStatistics';
import { createDefaultTextReplacements, removeRetiredDefaultTextReplacements } from './textReplacements';

describe('editor statistics and margin layout', () => {
  it('counts words across marks and treats the same location at night/day as one set', () => {
    const doc = {type:'doc', content:[
      {type:'paragraph',attrs:{scenarioType:'SCENE_HEADING'},content:[{type:'text',text:'INT. ATELIER – JOUR'}]},
      {type:'paragraph',attrs:{scenarioType:'SCENE_HEADING'},content:[{type:'text',text:'EXT. ATELIER - NUIT'}]},
      {type:'paragraph',attrs:{scenarioType:'ACTION'},content:[{type:'text',text:'L’aute'},{type:'text',text:'ur arrive.',marks:[{type:'italic'}]}]},
      {type:'paragraph',attrs:{scenarioType:'SCENE_HEADING'}},
    ]};
    expect(getDocumentStatistics(doc)).toEqual({words:8, scenes:2, locations:1});
    expect(getDocumentStatistics({type:'doc'})).toEqual({words:0,scenes:0,locations:0});
  });
  it('packs tall notes without overlap and retains the earliest available position', () => {
    expect(placeMarginNotes([{id:'b',anchor:100,height:150},{id:'a',anchor:100,height:50},{id:'c',anchor:130,height:60}]))
      .toEqual([{id:'a',top:100,bottom:158},{id:'b',top:158,bottom:316},{id:'c',top:316,bottom:384}]);
    expect(placeMarginNotes([{id:'a',anchor:100,height:20},{id:'b',anchor:400,height:20}])[1].top).toBe(400);
  });
  it('retires the shipped AS shortcut but preserves a custom shortcut', () => {
    expect(createDefaultTextReplacements().some(item => item.shortcut.toLowerCase() === 'as')).toBe(false);
    const custom = {id:'custom',shortcut:'AS',replacement:'mon texte'};
    expect(removeRetiredDefaultTextReplacements([{id:'default-shortcut-3',shortcut:'as',replacement:'après'},custom])).toEqual([custom]);
  });
});
