import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { UiInput } from './UiInput';

type UiFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string };

export const UiField = forwardRef<HTMLInputElement, UiFieldProps>(function UiField({ label, hint, error, id, className = '', ...props }, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const message = error ?? hint;
  return <label className={`ui-field${error ? ' ui-field--error' : ''} ${className}`.trim()} htmlFor={inputId}>
    <span className="ui-field__label">{label}</span>
    <UiInput {...props} ref={ref} id={inputId} className="ui-field__input" aria-invalid={Boolean(error) || undefined} aria-describedby={message ? `${inputId}-message` : undefined} />
    {message && <p id={`${inputId}-message`} className={`ui-field__message${error ? ' ui-field__message--error' : ''}`} role={error ? 'alert' : undefined}>{message}</p>}
  </label>;
});
