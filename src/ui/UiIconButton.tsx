import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { UiTooltip } from './UiTooltip';

type UiIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  loading?: boolean;
  tooltip?: ReactNode;
  tooltipPlacement?: 'top' | 'bottom';
  children: ReactNode;
};

export const UiIconButton = forwardRef<HTMLButtonElement, UiIconButtonProps>(function UiIconButton({ label, loading = false, tooltip, tooltipPlacement, className = '', disabled, children, ...props }, ref) {
  const button = <button {...props} ref={ref} type={props.type ?? 'button'} className={`ui-icon-button ${className}`.trim()} aria-label={label} disabled={disabled || loading} aria-busy={loading || undefined}>
    {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : children}
  </button>;
  return tooltip ? <UiTooltip content={tooltip} placement={tooltipPlacement}>{button}</UiTooltip> : button;
});
