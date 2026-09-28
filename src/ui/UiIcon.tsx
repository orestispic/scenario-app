export type UiIconName = 'check'|'chevron'|'down'|'more'|'search'|'plus'|'x'|'settings'|'filter'|'star'|'message'|'list'|'file'|'user'|'eye'|'bell'|'trash'|'bold'|'italic'|'error'|'folder'|'panel'|'underline'|'edit'|'duplicate'|'screenplay'|'whiteboard'|'breakdown';

/** Original sprite from the supplied ZIP; underline is the user-approved addition. */
export function UiIcon({name, className=''}:{name:UiIconName; className?:string}) {
  return <svg className={`ui-icon ${className}`} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {name==='underline' ? <path d="M6 4v7a6 6 0 0 0 12 0V4M4 21h16"/> : name==='edit' ? <path d="m14.5 5.5 4 4M4 20l4.2-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z"/> : name==='duplicate' ? <><rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></> : <use href={`/senario-ui-icons.svg#i-${name}`}/>}
  </svg>;
}
