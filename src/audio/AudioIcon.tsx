export function AudioIcon({name}:{name:'audio'|'play'|'pause'|'stop'|'previous'|'next'}) {
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {name==='audio'?<><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>:
      name==='play'?<path d="m7 4 13 8-13 8V4Z"/>:name==='pause'?<><path d="M8 5v14M16 5v14"/></>:
      name==='stop'?<rect x="5" y="5" width="14" height="14" rx="1"/>:
      name==='previous'?<path d="M5 4v16m14-16L7 12l12 8V4Z"/>:<path d="M19 4v16M5 4l12 8L5 20V4Z"/>}
  </svg>;
}
