import { describe, expect, it } from 'vitest';
import { scenarioPreviewZoomAfterWheel } from './ScenarioScenePreview';

describe('scenario preview wheel zoom', () => {
  it('zooms in and out in ten percent steps', () => {
    expect(scenarioPreviewZoomAfterWheel(100, -1)).toBe(110);
    expect(scenarioPreviewZoomAfterWheel(100, 1)).toBe(90);
    expect(scenarioPreviewZoomAfterWheel(100, 0)).toBe(100);
  });

  it('never exceeds the display-only bounds', () => {
    expect(scenarioPreviewZoomAfterWheel(160, -100)).toBe(160);
    expect(scenarioPreviewZoomAfterWheel(60, 100)).toBe(60);
  });
});
