import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  loading?: boolean;
  children: ReactNode;
};

export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(function UiButton(
  { variant = 'secondary', loading = false, className = '', disabled, children, ...props },
  ref,
) {
  return <button {...props} ref={ref} type={props.type ?? 'button'} className={`ui-button ui-button--${variant} ${className}`.trim()} disabled={disabled || loading} aria-busy={loading || undefined}>
    {loading && <span className="ui-button__spinner" aria-hidden="true" />}
    {children}
  </button>;
});
