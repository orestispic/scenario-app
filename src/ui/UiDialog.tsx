import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type UiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  headerAction?: ReactNode;
  className?: string;
  backdropClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  destructive?: boolean;
  dismissible?: boolean;
  initialFocus?: 'first' | 'dialog';
};

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function UiDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerAction,
  className = '',
  backdropClassName = '',
  headerClassName = '',
  bodyClassName = '',
  footerClassName = '',
  destructive = false,
  dismissible = true,
  initialFocus = 'first',
}: UiDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const activeBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const isTopmost = () => {
      const modalDialogs = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')]
        .filter(element => element.offsetParent !== null);
      return modalDialogs[modalDialogs.length - 1] === dialog.current;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (event.key === 'Escape' && dismissible) onOpenChangeRef.current(false);
      if (event.key !== 'Tab') return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === dialog.current) {
        event.preventDefault();
        first.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    body.current?.scrollTo({ top: 0, left: 0 });
    const firstFocusable = dialog.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (initialFocus === 'dialog' ? dialog.current : firstFocusable ?? dialog.current)?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      activeBeforeOpen?.focus();
    };
  }, [dismissible, initialFocus, open]);

  if (!open) return null;
  return createPortal(
    <div className={`ui-dialog-backdrop ${backdropClassName}`.trim()} role="presentation" onMouseDown={event => {
      if (dismissible && event.target === event.currentTarget) onOpenChangeRef.current(false);
    }}>
      <section ref={dialog} tabIndex={-1} className={`ui-dialog ${className}`.trim()} role={destructive ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onMouseDown={event => event.stopPropagation()}>
        <header className={`ui-dialog__header ${headerClassName}`.trim()}>
          <div><h2 id={titleId} className="ui-dialog__title">{title}</h2>{description && <p id={descriptionId} className="ui-dialog__description">{description}</p>}</div>
          {headerAction}
        </header>
        {children !== undefined && children !== null && <div ref={body} className={`ui-dialog__body ${bodyClassName}`.trim()}>{children}</div>}
        {footer && <footer className={`ui-dialog__footer ${footerClassName}`.trim()}>{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
