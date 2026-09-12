export interface OverlayRootRect {
  left: number;
  top: number;
}

export interface ClientRectangle extends OverlayRootRect {
  width: number;
  height: number;
}

/**
 * DOMRects, pointer events and coordsAtPos already use viewport CSS pixels,
 * including the document's CSS zoom. Only subtract the overlay root's origin.
 */
export function documentScaleForZoom(zoom: number): number {
  return zoom / 100;
}

export function clientPointToOverlay(
  clientLeft: number,
  clientTop: number,
  _zoom: number,
  appShellRect: OverlayRootRect | null | undefined,
): OverlayRootRect {
  return {
    left: clientLeft - (appShellRect?.left ?? 0),
    top: clientTop - (appShellRect?.top ?? 0),
  };
}

export function clientRectToOverlay(
  rect: ClientRectangle,
  zoom: number,
  appShellRect: OverlayRootRect | null | undefined,
): ClientRectangle {
  const point = clientPointToOverlay(rect.left, rect.top, zoom, appShellRect);
  return {
    ...point,
    width: rect.width,
    height: rect.height,
  };
}
