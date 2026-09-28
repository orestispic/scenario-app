import { useId, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';

export type UiTabItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  controls?: string;
  accessibleLabel?: string;
  title?: string;
  locked?: boolean;
};

type UiTabsProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value: string;
  tabs: UiTabItem[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  orientation?: 'horizontal' | 'vertical';
  activationMode?: 'automatic' | 'manual';
};

export function nextTabIndex(current: number, enabledIndexes: number[], direction: 1 | -1): number {
  if (!enabledIndexes.length) return -1;
  const position = enabledIndexes.indexOf(current);
  if (position < 0) return direction > 0 ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1];
  return enabledIndexes[(position + direction + enabledIndexes.length) % enabledIndexes.length];
}

export function UiTabs({ value, tabs, onValueChange, ariaLabel, orientation = 'horizontal', activationMode = 'automatic', className = '', ...props }: UiTabsProps) {
  const id = useId();

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const previousKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    if (![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = tabs.flatMap((tab, tabIndex) => tab.disabled ? [] : [tabIndex]);
    const targetIndex = event.key === 'Home'
      ? enabled[0]
      : event.key === 'End'
        ? enabled[enabled.length - 1]
        : nextTabIndex(index, enabled, event.key === nextKey ? 1 : -1);
    const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[targetIndex];
    if (targetIndex >= 0 && target) {
      target.focus();
      if (activationMode === 'automatic') onValueChange(tabs[targetIndex].value);
    }
  }

  return <div {...props} className={`ui-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel} aria-orientation={orientation}>
    {tabs.map((tab, index) => {
      const selected = tab.value === value;
      return <button
        key={tab.value}
        id={`${id}-tab-${index}`}
        className={`ui-tab${selected ? ' is-selected is-active' : ''}`}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls={tab.controls}
        aria-label={tab.accessibleLabel}
        tabIndex={selected ? 0 : -1}
        disabled={tab.disabled}
        data-ui-locked={tab.locked || undefined}
        title={tab.title}
        onKeyDown={event => move(event, index)}
        onClick={() => onValueChange(tab.value)}
      >{tab.label}</button>;
    })}
  </div>;
}

type UiTabPanelProps = HTMLAttributes<HTMLElement> & {
  active: boolean;
  labelledBy?: string;
};

export function UiTabPanel({ active, labelledBy, className = '', ...props }: UiTabPanelProps) {
  return <section {...props} className={`ui-tab-panel ${className}`.trim()} role="tabpanel" aria-labelledby={labelledBy} hidden={!active} tabIndex={active ? 0 : -1} />;
}
