import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_MAX_EDGE,
  UPLOAD_GIF_MAX_BYTES,
  downscaleDimensions,
  gifEncodePreset
} from './compress';

describe('drawing compress helpers', () => {
  it('downscales only when over max edge', () => {
    expect(downscaleDimensions(400, 300, BACKGROUND_MAX_EDGE).scale).toBe(1);
    const big = downscaleDimensions(2000, 1000, BACKGROUND_MAX_EDGE);
    expect(big.width).toBe(BACKGROUND_MAX_EDGE);
    expect(big.height).toBe(360);
  });

  it('upload preset is leaner than preview', () => {
    const preview = gifEncodePreset('preview');
    const upload = gifEncodePreset('upload');
    expect(upload.maxFrames).toBeLessThanOrEqual(preview.maxFrames);
    expect(upload.colors).toBeLessThanOrEqual(preview.colors);
    expect(UPLOAD_GIF_MAX_BYTES).toBeGreaterThan(100_000);
  });
});
