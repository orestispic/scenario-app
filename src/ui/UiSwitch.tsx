import type { ButtonHTMLAttributes } from 'react';

type UiSwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & { checked: boolean; onCheckedChange: (checked: boolean) => void };

export function UiSwitch({ checked, onCheckedChange, children, ...props }: UiSwitchProps) {
  return <button {...props} type={props.type ?? 'button'} className={`ui-switch ${props.className ?? ''}`.trim()} role="switch" aria-checked={checked} onClick={event => { props.onClick?.(event); if (!event.defaultPrevented) onCheckedChange(!checked); }}>
    <span className="ui-switch__track" aria-hidden="true"><span className="ui-switch__thumb" /></span>
    {children}
  </button>;
}
