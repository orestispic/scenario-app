import { useEffect, useId, useLayoutEffect, useRef, useState, type SelectHTMLAttributes, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { UiIcon } from './UiIcon';

/** Supplied dropdown/menu items, with native form submission and React change events. */
export function UiSelect({className='',children,onChange,...props}:SelectHTMLAttributes<HTMLSelectElement>) {
  const select=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  const id=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(0),[version,setVersion]=useState(0);
  const [position,setPosition]=useState<CSSProperties>({});
  const options=select.current ? Array.from(select.current.options) : [];
  const selected=options.findIndex(option=>option.selected);
  useLayoutEffect(()=>{setVersion(v=>v+1);},[children,props.value]);
  useEffect(()=>{
    if(!open)return;
    const place=()=>{const r=trigger.current?.getBoundingClientRect();if(!r)return;
      const width=Math.min(Math.max(r.width,220),window.innerWidth-16),height=Math.min(242,options.length*30+14);
      const below=window.innerHeight-r.bottom-8,above=r.top-8;
      const useAbove=below<height&&above>below,available=Math.max(40,useAbove?above:below);
      setPosition({position:'fixed',width,maxHeight:Math.min(height,available),left:Math.max(8,Math.min(r.left,window.innerWidth-width-8)),top:useAbove?Math.max(8,r.top-Math.min(height,available)-4):r.bottom+4});};
    const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!panel.current?.contains(event.target as Node))setOpen(false);};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);document.addEventListener('pointerdown',outside);
    return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',outside);};
  },[open,options.length]);
  useEffect(()=>{if(props.disabled)setOpen(false);},[props.disabled]);
  useEffect(()=>{panel.current?.querySelector('[data-active=true]')?.scrollIntoView({block:'nearest'});},[active,open]);
  function choose(index:number){const option=options[index];if(!select.current||!option||option.disabled)return;
    setOpen(false);trigger.current?.focus();select.current.value=option.value;
    select.current.dispatchEvent(new Event('change',{bubbles:true}));setVersion(version+1);
  }
  function move(direction:number){let next=active;for(let n=0;n<options.length;n++){next=(next+direction+options.length)%options.length;if(!options[next].disabled)break;}setActive(next);}
  return <span className={`ui-select ${className}`}>
    <select {...props} ref={select} aria-hidden="true" tabIndex={-1} className="ui-select-native" onChange={event=>{onChange?.(event);setVersion(v=>v+1);}}>{children}</select>
    <button ref={trigger} type="button" role="combobox" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']}
      aria-expanded={open} aria-controls={id} aria-haspopup="listbox" aria-activedescendant={open?`${id}-${active}`:undefined}
      disabled={props.disabled} className="ui-select-trigger" onMouseDown={event=>event.preventDefault()}
      onClick={()=>{setActive(Math.max(0,selected));setOpen(!open);}}
      onKeyDown={event=>{
        if(['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape'].includes(event.key))event.preventDefault();
        if(event.key==='Escape'||event.key==='Tab'){if(open&&event.key==='Escape')event.stopPropagation();setOpen(false);return;}
        if(event.key==='Enter'||event.key===' '){if(open)choose(active);else{setActive(Math.max(0,selected));setOpen(true);}return;}
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){if(!open){setActive(Math.max(0,selected));setOpen(true);}else move(event.key==='ArrowDown'?1:-1);}
        if(event.key==='Home')setActive(0);if(event.key==='End')setActive(options.length-1);
      }}><span>{options[selected]?.text ?? ''}</span><UiIcon name="down"/></button>
    {open&&createPortal(<div ref={panel} id={id} role="listbox" className="ui-select-panel" style={position} aria-label={props['aria-label']}>
      {options.map((option,index)=><button key={`${option.value}-${index}`} type="button" role="option" id={`${id}-${index}`} tabIndex={-1}
        aria-selected={index===selected} disabled={option.disabled} data-active={index===active} className="ui-select-option"
        onPointerMove={()=>setActive(index)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(index)}>{option.text}</button>)}
    </div>,document.querySelector('.app-shell')??document.body)}
  </span>;
}
