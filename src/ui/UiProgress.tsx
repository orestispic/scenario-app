import type { HTMLAttributes } from 'react';

type UiProgressTone = 'info' | 'success' | 'warning' | 'danger';

type UiProgressProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value?: number;
  min?: number;
  max?: number;
  label?: string;
  valueText?: string;
  showValue?: boolean;
  indeterminate?: boolean;
  tone?: UiProgressTone;
};

export function UiProgress({ value = 0, min = 0, max = 100, label, valueText, showValue = false, indeterminate = false, tone = 'info', className = '', ...props }: UiProgressProps) {
  const safeMax = max > min ? max : min + 1;
  const safeValue = Math.min(safeMax, Math.max(min, value));
  const percentage = ((safeValue - min) / (safeMax - min)) * 100;
  const announcedValue = valueText ?? `${Math.round(percentage).toLocaleString('fr-FR')} %`;
  return <div className={`ui-progress-group ${className}`.trim()}>
    {(label || showValue) && <div className="ui-progress__label">
      {label && <span>{label}</span>}
      {showValue && <strong>{announcedValue}</strong>}
    </div>}
    <div
      {...props}
      className={`ui-progress ui-progress--${tone}${indeterminate ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-label={props['aria-label'] ?? label}
      aria-valuemin={indeterminate ? undefined : min}
      aria-valuemax={indeterminate ? undefined : safeMax}
      aria-valuenow={indeterminate ? undefined : safeValue}
      aria-valuetext={indeterminate ? (valueText ?? 'Chargement…') : announcedValue}
      aria-busy={indeterminate || undefined}
    >
      <span className="ui-progress__bar" style={indeterminate ? undefined : { width: `${percentage}%` }} />
    </div>
  </div>;
}
