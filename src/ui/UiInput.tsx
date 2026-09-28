import { forwardRef, type InputHTMLAttributes } from 'react';

/** Shared single-line input for compact or externally-labelled editing contexts. */
export const UiInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function UiInput(
  { className = '', ...props },
  ref,
) {
  return <input {...props} ref={ref} className={`ui-input ${className}`.trim()} />;
});
