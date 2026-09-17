import { useEffect, useRef, type RefObject } from 'react';

/**
 * Standard behavior for transient application popovers: clicking outside
 * dismisses them without committing their draft values.
 */
export function useDismissOnOutsidePointer<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): RefObject<T | null> {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const dismissIfOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) onDismiss();
    };
    window.addEventListener('pointerdown', dismissIfOutside);
    return () => window.removeEventListener('pointerdown', dismissIfOutside);
  }, [onDismiss, open]);

  return containerRef;
}
