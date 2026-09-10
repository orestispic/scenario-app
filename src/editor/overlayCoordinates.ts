export interface OverlayRootRect {
  left: number;
  top: number;
}

export interface ClientRectangle extends OverlayRootRect {
  width: number;
  height: number;
}

/**
 * WebKit reports coordinates in the unzoomed CSS space when an ancestor uses
 * `zoom`. Convert them once, then express every HUD in the app-shell space.
 */
export function documentScaleForZoom(zoom: number): number {
  return zoom / 100;
}

export function clientPointToOverlay(
  clientLeft: number,
  clientTop: number,
  zoom: number,
  appShellRect: OverlayRootRect | null | undefined,
): OverlayRootRect {
  const scale = documentScaleForZoom(zoom);
  return {
    left: clientLeft * scale - (appShellRect?.left ?? 0),
    top: clientTop * scale - (appShellRect?.top ?? 0),
  };
}

export function clientRectToOverlay(
  rect: ClientRectangle,
  zoom: number,
  appShellRect: OverlayRootRect | null | undefined,
): ClientRectangle {
  const point = clientPointToOverlay(rect.left, rect.top, zoom, appShellRect);
  const scale = documentScaleForZoom(zoom);
  return {
    ...point,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}
