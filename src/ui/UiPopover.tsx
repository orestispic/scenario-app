import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingPanelGeometry } from './floatingGeometry';

type UiPopoverRole = 'dialog' | 'listbox' | 'menu';

export type UiPopoverDismissReason = 'escape' | 'outside' | 'pointer-leave' | 'trigger';

type UiPopoverProps = {
  trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean, reason?: UiPopoverDismissReason) => void;
  pointerSafe?: boolean;
  role?: UiPopoverRole;
  ariaLabel?: string;
};

/**
 * A content-sized, viewport-positioned non-modal popover. `pointerSafe` adds
 * pointer-leave dismissal while preserving a continuous trigger-to-panel path.
 */
export function UiPopover({
  trigger,
  children,
  className = '',
  align = 'start',
  contentClassName = '',
  open: controlledOpen,
  onOpenChange,
  pointerSafe = false,
  role = 'dialog',
  ariaLabel,
}: UiPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bridge = useRef<HTMLDivElement>(null);
  const pointerLeaveTimer = useRef<number | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const [bridgePosition, setBridgePosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const setOpen = (next: boolean, reason?: UiPopoverDismissReason) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next, reason);
  };

  const cancelPointerLeave = () => {
    if (pointerLeaveTimer.current === null) return;
    window.clearTimeout(pointerLeaveTimer.current);
    pointerLeaveTimer.current = null;
  };

  const schedulePointerLeave = () => {
    if (!pointerSafe) return;
    cancelPointerLeave();
    pointerLeaveTimer.current = window.setTimeout(() => {
      pointerLeaveTimer.current = null;
      setOpen(false, 'pointer-leave');
    }, 120);
  };

  useEffect(() => () => cancelPointerLeave(), []);

  useEffect(() => {
    if (!open) cancelPointerLeave();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const path = event.composedPath();
      const rootElement = root.current;
      const panelElement = panel.current;
      const bridgeElement = bridge.current;
      if ((rootElement === null || !path.includes(rootElement))
        && (panelElement === null || !path.includes(panelElement))
        && (bridgeElement === null || !path.includes(bridgeElement))) setOpen(false, 'outside');
    };
    document.addEventListener('pointerdown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const triggerButton = root.current?.querySelector<HTMLButtonElement>('button');
      const panelElement = panel.current;
      const panelRect = panelElement?.getBoundingClientRect();
      if (!triggerButton || !panelElement || !panelRect) return;
      const triggerRect = triggerButton.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(panelElement);
      const borders = Number.parseFloat(computedStyle.borderTopWidth) + Number.parseFloat(computedStyle.borderBottomWidth);
      const contentHeight = Math.max(panelRect.height, panelElement.scrollHeight + borders);
      const geometry = resolveFloatingPanelGeometry({
        align,
        contentHeight,
        panelWidth: panelRect.width,
        trigger: triggerRect,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      });
      setPosition({
        visibility: 'visible',
        position: 'fixed',
        zIndex: 'var(--ui-z-menu)',
        width: geometry.width,
        maxHeight: geometry.height,
        left: geometry.left,
        top: geometry.top,
      });
      setBridgePosition({
        visibility: 'visible',
        position: 'fixed',
        zIndex: 'var(--ui-z-menu)',
        ...geometry.bridge,
      });
    };
    const frame = requestAnimationFrame(place);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    const mutationObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(place);
    if (root.current) observer?.observe(root.current);
    if (panel.current) observer?.observe(panel.current);
    if (panel.current) mutationObserver?.observe(panel.current, { childList: true, characterData: true, subtree: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [align, open]);

  const triggerWithPopoverProps = isValidElement(trigger) ? cloneElement(trigger, {
    'aria-expanded': open,
    'aria-haspopup': role,
    'aria-controls': open ? id : undefined,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      trigger.props.onClick?.(event);
      if (!event.defaultPrevented) setOpen(!open, 'trigger');
    },
    onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => {
      trigger.props.onPointerEnter?.(event);
      cancelPointerLeave();
    },
    onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
      trigger.props.onPointerLeave?.(event);
      schedulePointerLeave();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      trigger.props.onKeyDown?.(event);
      if (event.defaultPrevented || !open || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, 'escape');
    },
  }) : trigger;

  return <div ref={root} className={`ui-popover ui-popover--${align} ${className}`.trim()}>
    {triggerWithPopoverProps}
    {open && createPortal(
      <>
        {pointerSafe && <div ref={bridge} className="ui-popover__pointer-bridge" data-ui-popover-bridge="true" aria-hidden="true"
          style={bridgePosition} onPointerEnter={cancelPointerLeave} onPointerLeave={schedulePointerLeave} />}
        <div ref={panel} id={id} className={`ui-popover__panel ${contentClassName}`.trim()} role={role} aria-label={ariaLabel}
          data-ui-pointer-safe={pointerSafe || undefined} style={position} onPointerEnter={cancelPointerLeave} onPointerLeave={schedulePointerLeave}
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false, 'escape');
            root.current?.querySelector<HTMLButtonElement>('button')?.focus();
          }}>
          {children}
        </div>
      </>,
      document.body,
    )}
  </div>;
}
