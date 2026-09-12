import { describe, expect, it } from "vitest";
import { clientPointToOverlay, clientRectToOverlay } from "./overlayCoordinates";

describe("overlay coordinates", () => {
  it.each([60, 70, 80, 100, 120, 160])(
    "keeps client coordinates in the app-shell space at %i%% zoom",
    (zoom) => {
      const point = clientPointToOverlay(400, 250, zoom, { left: 40, top: 30 });
      expect(point).toEqual({ left: 360, top: 220 });
    },
  );

  it("does not scale an already zoomed paragraph rectangle twice", () => {
    expect(clientRectToOverlay(
      { left: 120, top: 220, width: 640, height: 36 },
      70,
      { left: 20, top: 30 },
    )).toEqual({ left: 100, top: 190, width: 640, height: 36 });
  });
});
