import {Plugin, PluginKey} from '@tiptap/pm/state';
import {Decoration, DecorationSet} from '@tiptap/pm/view';

export const audioHighlightKey=new PluginKey<string>('senario-audio-highlight');
/** Decorations belong to the view, never to the screenplay or undo history. */
export function createAudioHighlight() {
  return new Plugin<string>({key:audioHighlightKey,
    state:{init:()=>'',apply:(transaction,previous)=>transaction.getMeta(audioHighlightKey)??previous},
    props:{decorations(state){
      const id=audioHighlightKey.getState(state);if(!id)return DecorationSet.empty;
      const decorations:Decoration[]=[];
      state.doc.descendants((node,pos)=>{if(node.isTextblock&&node.attrs.blockId===id)decorations.push(Decoration.node(pos,pos+node.nodeSize,{class:'is-audio-reading'}));});
      return DecorationSet.create(state.doc,decorations);
    }},
  });
}
