import { forwardRef, type InputHTMLAttributes } from 'react';
import { UiIcon } from './UiIcon';
import { UiIconButton } from './UiIconButton';
import { UiInput } from './UiInput';

type UiSearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  clearLabel?: string;
  onClear?: () => void;
};

/** Compact labelled search field with a consistent, keyboard-accessible clear action. */
export const UiSearchField = forwardRef<HTMLInputElement, UiSearchFieldProps>(function UiSearchField(
  { label, clearLabel = 'Effacer la recherche', onClear, className = '', value, defaultValue, ...props },
  ref,
) {
  const hasValue = value !== undefined ? String(value).length > 0 : String(defaultValue ?? '').length > 0;
  return <label className={`ui-search-field ${className}`.trim()}>
    <span className="ui-visually-hidden">{label}</span>
    <UiInput {...props} ref={ref} type="search" value={value} defaultValue={defaultValue}
      className="ui-field__input ui-search-field__input" aria-label={label} />
    {hasValue && onClear && <UiIconButton className="ui-search-field__clear" label={clearLabel}
      onClick={onClear}><UiIcon name="x" /></UiIconButton>}
  </label>;
});
