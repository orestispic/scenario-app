import type { HTMLAttributes, ReactNode } from 'react';

type UiPanelProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function UiPanel({ title, footer, children, className = '', ...props }: UiPanelProps) {
  return <section {...props} className={`ui-panel ${className}`.trim()}>
    {title && <header className="ui-panel__header">{title}</header>}
    <div className="ui-panel__body">{children}</div>
    {footer && <footer className="ui-panel__footer">{footer}</footer>}
  </section>;
}
