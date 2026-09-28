import type { HTMLAttributes, ReactNode } from 'react';

type UiEmptyStateProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function UiEmptyState({ title, description, action, className = '', ...props }: UiEmptyStateProps) {
  return <section {...props} className={`ui-empty-state ${className}`.trim()}>
    <h3 className="ui-empty-state__title">{title}</h3>
    {description && <p className="ui-empty-state__description">{description}</p>}
    {action}
  </section>;
}
