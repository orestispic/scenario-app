import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type TooltipChildProps = { 'aria-describedby'?: string };

type UiTooltipProps = {
  content: ReactNode;
  children: ReactElement<TooltipChildProps>;
  placement?: 'top' | 'bottom';
  delay?: number;
};

export function UiTooltip({ content, children, placement = 'top', delay = 350 }: UiTooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });

  const cancelTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (immediate = false) => {
    cancelTimer();
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => { cancelTimer(); setOpen(false); };

  useEffect(() => () => cancelTimer(), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchorRect = anchor.current?.getBoundingClientRect();
      const tooltipRect = tooltip.current?.getBoundingClientRect();
      if (!anchorRect || !tooltipRect) return;
      const inset = 8;
      const gap = 7;
      const left = Math.max(inset, Math.min(anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2, window.innerWidth - tooltipRect.width - inset));
      const preferredTop = placement === 'top' ? anchorRect.top - tooltipRect.height - gap : anchorRect.bottom + gap;
      const canUsePreferred = preferredTop >= inset && preferredTop + tooltipRect.height <= window.innerHeight - inset;
      const top = canUsePreferred
        ? preferredTop
        : placement === 'top'
          ? Math.min(window.innerHeight - tooltipRect.height - inset, anchorRect.bottom + gap)
          : Math.max(inset, anchorRect.top - tooltipRect.height - gap);
      setPosition({ visibility: 'visible', left, top });
    };
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, placement]);

  const describedBy = [children.props['aria-describedby'], id].filter(Boolean).join(' ') || undefined;
  return <span
    ref={anchor}
    className="ui-tooltip-anchor"
    onPointerEnter={() => show(false)}
    onPointerLeave={hide}
    onFocusCapture={() => show(true)}
    onBlurCapture={hide}
    onKeyDown={event => {
      if (!open || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    }}
  >
    {cloneElement(children, { 'aria-describedby': describedBy })}
    <span id={id} className="ui-visually-hidden">{content}</span>
    {open && createPortal(<div ref={tooltip} className="ui-tooltip" role="tooltip" aria-hidden="true" style={position}>{content}</div>, document.body)}
  </span>;
}
