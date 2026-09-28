import type { HTMLAttributes, ReactNode } from 'react';

export type UiFeedbackTone = 'info' | 'success' | 'warning' | 'danger';
export type UiFeedbackMessage = { text: string; tone: UiFeedbackTone };
type UiFeedbackProps = HTMLAttributes<HTMLDivElement> & { tone?: UiFeedbackTone; children: ReactNode };

export function UiFeedback({ tone = 'info', className = '', children, ...props }: UiFeedbackProps) {
  return <div {...props} className={`ui-feedback ui-feedback--${tone} ${className}`.trim()} role={tone === 'danger' ? 'alert' : props.role ?? 'status'}>{children}</div>;
}
