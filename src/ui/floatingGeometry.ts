export type FloatingAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>;

export type FloatingPanelGeometry = {
  bridge: { height: number; left: number; top: number; width: number };
  height: number;
  left: number;
  placeAbove: boolean;
  top: number;
  width: number;
};

/**
 * Positions a content-sized floating panel inside the real viewport. The
 * returned height is the natural content height unless the viewport is the
 * limiting factor. The bridge overlaps both edges to avoid sub-pixel gaps.
 */
export function resolveFloatingPanelGeometry({
  align,
  contentHeight,
  panelWidth,
  trigger,
  viewportHeight,
  viewportWidth,
}: {
  align: 'start' | 'end';
  contentHeight: number;
  panelWidth: number;
  trigger: FloatingAnchorRect;
  viewportHeight: number;
  viewportWidth: number;
}): FloatingPanelGeometry {
  const inset = 8;
  const gap = 6;
  const overlap = 1;
  const width = Math.min(panelWidth, Math.max(0, viewportWidth - inset * 2));
  const below = Math.max(0, viewportHeight - trigger.bottom - inset - gap);
  const above = Math.max(0, trigger.top - inset - gap);
  const placeAbove = below < contentHeight && above > below;
  const availableHeight = placeAbove ? above : below;
  const height = Math.min(contentHeight, availableHeight);
  const idealLeft = align === 'end' ? trigger.right - width : trigger.left;
  const left = Math.max(inset, Math.min(idealLeft, viewportWidth - width - inset));
  const top = placeAbove ? trigger.top - gap - height : trigger.bottom + gap;
  const panelBottom = top + height;
  const bridgeTop = Math.min(placeAbove ? panelBottom : trigger.bottom, placeAbove ? trigger.top : top) - overlap;
  const bridgeBottom = Math.max(placeAbove ? panelBottom : trigger.bottom, placeAbove ? trigger.top : top) + overlap;
  const bridgeLeft = Math.min(trigger.left, left) - overlap;
  const bridgeRight = Math.max(trigger.right, left + width) + overlap;

  return {
    bridge: {
      height: Math.max(0, bridgeBottom - bridgeTop),
      left: bridgeLeft,
      top: bridgeTop,
      width: Math.max(0, bridgeRight - bridgeLeft),
    },
    height,
    left,
    placeAbove,
    top,
    width,
  };
}
