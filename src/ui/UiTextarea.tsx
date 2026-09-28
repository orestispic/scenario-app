import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ForwardedRef,
  type MutableRefObject,
  type TextareaHTMLAttributes,
} from 'react';

type UiTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Grow with the content until maxAutoGrowHeight, then keep an internal scrollbar. */
  autoGrow?: boolean;
  maxAutoGrowHeight?: number;
};

export function resolveTextareaAutoGrow(contentHeight: number, maximumHeight: number) {
  const height = Math.min(Math.max(0, contentHeight), Math.max(0, maximumHeight));
  return { height, overflowY: contentHeight > maximumHeight ? 'auto' : 'hidden' } as const;
}

function assignRef(ref: ForwardedRef<HTMLTextAreaElement>, node: HTMLTextAreaElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as MutableRefObject<HTMLTextAreaElement | null>).current = node;
}

/** Approved multiline extension of the supplied .field; native semantics retained. */
export const UiTextarea=forwardRef<HTMLTextAreaElement,UiTextareaProps>(function UiTextarea({
  autoGrow = false,
  className = '',
  maxAutoGrowHeight = 260,
  onInput,
  rows = 4,
  value,
  ...props
}, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const element = textarea.current;
    if (!autoGrow || !element) return;
    element.style.height = 'auto';
    element.style.maxHeight = `${maxAutoGrowHeight}px`;
    const next = resolveTextareaAutoGrow(element.scrollHeight, maxAutoGrowHeight);
    element.style.height = `${next.height}px`;
    element.style.overflowY = next.overflowY;
  };

  useLayoutEffect(resize, [autoGrow, maxAutoGrowHeight, value]);

  return <textarea
    {...props}
    value={value}
    rows={rows}
    data-auto-grow={autoGrow || undefined}
    className={`ui-textarea${autoGrow ? ' ui-textarea--auto-grow' : ''} ${className}`.trim()}
    ref={node => { textarea.current = node; assignRef(ref, node); }}
    onInput={event => { resize(); onInput?.(event); }}
  />;
});
