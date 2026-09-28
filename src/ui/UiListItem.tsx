import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type UiListItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export const UiListItem = forwardRef<HTMLButtonElement, UiListItemProps>(function UiListItem(
  { selected = false, leading, trailing, className = '', children, ...props },
  ref,
) {
  return <button
    {...props}
    ref={ref}
    type={props.type ?? 'button'}
    className={`ui-list-item${selected ? ' is-selected' : ''} ${className}`.trim()}
    aria-selected={props['aria-selected'] ?? (props.role === 'option' ? selected : undefined)}
  >
    {leading && <span className="ui-list-item__leading" aria-hidden="true">{leading}</span>}
    <span className="ui-list-item__content">{children}</span>
    {trailing && <span className="ui-list-item__trailing">{trailing}</span>}
  </button>;
});
