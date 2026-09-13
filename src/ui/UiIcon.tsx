export type UiIconName = 'check'|'chevron'|'down'|'more'|'search'|'plus'|'x'|'settings'|'star'|'message'|'list'|'file'|'user'|'eye'|'bell'|'trash'|'bold'|'italic'|'error'|'folder'|'panel'|'underline';

/** Original sprite from the supplied ZIP; underline is the user-approved addition. */
export function UiIcon({name, className=''}:{name:UiIconName; className?:string}) {
  return <svg className={`ui-icon ${className}`} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {name==='underline' ? <path d="M6 4v7a6 6 0 0 0 12 0V4M4 21h16"/> : <use href={`/senario-ui-icons.svg#i-${name}`}/>}
  </svg>;
}
