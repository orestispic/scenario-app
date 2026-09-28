import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { resolveFloatingPanelGeometry } from './floatingGeometry';

export type UiMenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function nextMenuItemIndex(current: number, count: number, key: UiMenuNavigationKey): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (current < 0) return key === 'ArrowUp' ? count - 1 : 0;
  return key === 'ArrowDown' ? (current + 1) % count : (current - 1 + count) % count;
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(item =>
    !item.disabled && item.closest('[role="menu"]') === menu,
  );
}

function focusMenuItem(menu: HTMLElement | null, target: 'first' | 'last'): void {
  const items = menuItems(menu);
  items[target === 'first' ? 0 : items.length - 1]?.focus();
}

function handleMenuNavigation(event: ReactKeyboardEvent<HTMLElement>, menu: HTMLElement | null): boolean {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false;
  event.preventDefault();
  event.stopPropagation();
  const items = menuItems(menu);
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index = nextMenuItemIndex(current, items.length, event.key as UiMenuNavigationKey);
  items[index]?.focus();
  return true;
}

function focusOutsideMenu(trigger: HTMLButtonElement | null, menu: HTMLElement | null, backwards: boolean): void {
  if (!trigger) return;
  const focusable = Array.from(document.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter(element => !menu?.contains(element) && element.getAttribute('aria-hidden') !== 'true');
  const index = focusable.indexOf(trigger);
  focusable[index + (backwards ? -1 : 1)]?.focus();
}

type UiMenuProps = {
  trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  children: ReactNode;
  align?: 'start' | 'end';
  panelClassName?: string;
  ariaLabel?: string;
  withSubmenus?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function UiMenu({ trigger, children, align = 'start', panelClassName = '', ariaLabel, withSubmenus = false, open: controlledOpen, onOpenChange }: UiMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last' | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const setOpen = (next: boolean) => { if (controlledOpen === undefined) setUncontrolledOpen(next); onOpenChange?.(next); };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      // The panel is portaled to `document.body`. `composedPath` keeps its
      // descendants associated with the menu even when an embedded runtime
      // retargets pointer events, so an item can always receive its click.
      const path = event.composedPath();
      const rootElement = root.current;
      const panelElement = panel.current;
      if ((rootElement === null || !path.includes(rootElement)) && (panelElement === null || !path.includes(panelElement))) setOpen(false);
    };
    const dismissFocus = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && !root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('focusin', dismissFocus);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismissFocus); };
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
      const geometry = resolveFloatingPanelGeometry({
        align,
        contentHeight: Math.max(panelRect.height, panelElement.scrollHeight + borders),
        panelWidth: panelRect.width,
        trigger: triggerRect,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      });
      setPosition({
        visibility: 'visible',
        width: geometry.width,
        maxHeight: geometry.height,
        left: geometry.left,
        top: geometry.top,
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
  useEffect(() => {
    // A freshly portaled panel starts hidden while its desktop position is
    // measured. Focusing a visibility:hidden item is ignored by browsers, so
    // wait for the positioning pass before moving focus into the menu.
    if (!open || position.visibility !== 'visible' || !focusOnOpen.current) return;
    const target = focusOnOpen.current;
    const frame = requestAnimationFrame(() => {
      focusMenuItem(panel.current, target);
      focusOnOpen.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, position.visibility]);
  const triggerWithMenuProps = isValidElement(trigger) ? cloneElement(trigger, {
    'aria-expanded': open,
    'aria-haspopup': 'menu',
    'aria-controls': open ? id : undefined,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => { trigger.props.onClick?.(event); if (!event.defaultPrevented) setOpen(!open); },
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      trigger.props.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (!open && (event.key === 'Enter' || event.key === ' '))) {
        event.preventDefault();
        const target = event.key === 'ArrowUp' ? 'last' : 'first';
        if (open) focusMenuItem(panel.current, target);
        else {
          focusOnOpen.current = target;
          setOpen(true);
        }
      }
    },
  }) : trigger;
  return <div ref={root} className={`ui-menu ui-menu--${align}`}>{triggerWithMenuProps}{open && createPortal(<div
    ref={panel}
    id={id}
    className={`ui-menu__panel${withSubmenus ? ' ui-menu__panel--submenus' : ''} ${panelClassName}`.trim()}
    role="menu"
    aria-label={ariaLabel}
    style={position}
    onKeyDown={event => {
      if (handleMenuNavigation(event, panel.current)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const triggerButton = root.current?.querySelector<HTMLButtonElement>('button') ?? null;
        setOpen(false);
        requestAnimationFrame(() => focusOutsideMenu(triggerButton, panel.current, event.shiftKey));
      }
    }}
    onClick={event => {
      const item = (event.target as Element).closest<HTMLElement>('[role="menuitem"]');
      if (item && item.getAttribute('aria-haspopup') !== 'menu' && item.getAttribute('aria-disabled') !== 'true') setOpen(false);
    }}
  >{children}</div>, document.body)}</div>;
}

export function UiMenuItem({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={props.type ?? 'button'} tabIndex={props.tabIndex ?? -1} className={`ui-menu-item ${className}`.trim()} role="menuitem" />;
}

export function UiMenuSeparator() {
  return <div className="ui-menu__separator" role="separator" />;
}

type UiContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
};

/** A keyboard-accessible menu opened at pointer coordinates, typically by a context-menu action. */
export function UiContextMenu({ open, x, y, onOpenChange, children, ariaLabel, className = '' }: UiContextMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });

  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const activeBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dismiss = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onOpenChangeRef.current(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      activeBeforeOpen?.focus();
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    setPosition({ visibility: 'hidden' });
    const frame = requestAnimationFrame(() => {
      const rect = panel.current?.getBoundingClientRect();
      if (!rect) return;
      const inset = 8;
      const width = Math.min(rect.width, window.innerWidth - inset * 2);
      const height = Math.min(rect.height, window.innerHeight - inset * 2);
      setPosition({
        visibility: 'visible',
        width,
        maxHeight: height,
        left: Math.max(inset, Math.min(x, window.innerWidth - width - inset)),
        top: Math.max(inset, Math.min(y, window.innerHeight - height - inset)),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, x, y]);
  useEffect(() => {
    if (!open || position.visibility !== 'visible') return;
    const frame = requestAnimationFrame(() => focusMenuItem(panel.current, 'first'));
    return () => cancelAnimationFrame(frame);
  }, [open, position.visibility]);

  if (!open) return null;
  return createPortal(<div ref={panel} className={`ui-menu__panel ui-context-menu ${className}`.trim()}
    role="menu" aria-label={ariaLabel} style={position}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (handleMenuNavigation(event, panel.current)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key === 'Tab') { event.preventDefault(); onOpenChangeRef.current(false); }
    }}
    onClick={event => {
      const item = (event.target as Element).closest<HTMLElement>('[role="menuitem"]');
      if (item && item.getAttribute('aria-disabled') !== 'true') onOpenChangeRef.current(false);
    }}
  >{children}</div>, document.body);
}

type UiMenuSubmenuProps = {
  label: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  panelClassName?: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** A nested menu rendered inside its parent panel, preserving a continuous pointer path. */
export function UiMenuSubmenu({ label, children, ariaLabel, className = '', panelClassName = '', disabled = false, open: controlledOpen, onOpenChange }: UiMenuSubmenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const setOpen = (next: boolean) => {
    if (disabled) return;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const focusFirstItem = () => requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const branchRect = root.current?.getBoundingClientRect();
      const panelWidth = panel.current?.getBoundingClientRect().width;
      if (!branchRect || !panelWidth) return;
      const inset = 8;
      const opensLeft = branchRect.right + panelWidth + inset > window.innerWidth && branchRect.left - panelWidth - inset > 0;
      setPosition(opensLeft
        ? { visibility: 'visible', top: -6, right: 'calc(100% - 2px)', left: 'auto' }
        : { visibility: 'visible', top: -6, left: 'calc(100% - 2px)', right: 'auto' });
    };
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); };
  }, [open]);

  return <div ref={root} className={`ui-menu-submenu ${className}`.trim()} onPointerEnter={() => setOpen(true)}>
    <UiMenuItem
      className="ui-menu-submenu__trigger"
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onFocus={() => setOpen(true)}
      onClick={() => setOpen(true)}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          setOpen(true);
          focusFirstItem();
        } else if (event.key === 'ArrowLeft' && open) {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >{label}</UiMenuItem>
    {open && <div ref={panel} id={id} className={`ui-menu__submenu-panel ${panelClassName}`.trim()} role="menu" aria-label={ariaLabel} style={position} onKeyDown={event => {
      if (handleMenuNavigation(event, panel.current)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    }}>
      {children}
    </div>}
  </div>;
}
