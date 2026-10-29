import { describe, expect, it } from 'vitest';
import { parseSno } from './parse';
import { defaultView, meshScreenSpan } from './render';

describe('defaultView', () => {
  it('frames a small mesh inside a large advisory extent', () => {
    const sno = parseSno({
      v: 2,
      name: 'speck',
      unit: 0,
      extent: 8,
      mode: 'lines',
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      ],
      colors: [1, 2, 3],
      faces: [[0, 1, 2]]
    });
    const view = defaultView(sno);
    const span = meshScreenSpan(sno, view, 320);
    expect(span).toBeGreaterThan(100);
    expect(span).toBeLessThan(280);
    expect(view.distance).toBeLessThan(sno.extent * 2);
  });

  it('frames a flat wide mesh across most of the square', () => {
    const sno = parseSno({
      v: 2,
      name: 'flat',
      unit: 0,
      extent: 8,
      mode: 'lines',
      vertices: [
        [-3, 0, 2],
        [4, 0, -2],
        [4, 1, 2],
        [-3, 1, -2]
      ],
      colors: [1, 2, 3, 4],
      faces: [
        [0, 1, 2],
        [0, 2, 3]
      ]
    });
    const view = defaultView(sno);
    const span = meshScreenSpan(sno, view, 320);
    expect(span).toBeGreaterThan(140);
    // Extent 8 used to park the camera at 19.2 and leave this mesh a speck.
    expect(view.distance).toBeLessThan(12);
  });
});
