import { describe, expect, it } from 'vitest';
import { colorWithAlpha, mulberry32, paintDrawing, replaySteps, strokeWidthAt } from './paint';
import { paperById } from './papers';
import { canvasFontString, drawFontById, isShapeTool, isTextTool, type DrawStroke } from './types';

function stroke(partial: Partial<DrawStroke> & Pick<DrawStroke, 'points'>): DrawStroke {
  return {
    tool: 'brush',
    color: '#111',
    width: 4,
    seed: 1,
    ...partial
  };
}

describe('drawing paint helpers', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('strokeWidthAt grows with pressure for brush', () => {
    const s = stroke({ points: [], width: 4 });
    expect(strokeWidthAt(s, 1)).toBeGreaterThan(strokeWidthAt(s, 0.2));
  });

  it('strokeWidthAt keeps fine stylus tips under 1px floor', () => {
    const fine = stroke({ points: [], width: 0.25 });
    expect(strokeWidthAt(fine, 0.5)).toBeLessThan(0.8);
    expect(strokeWidthAt(fine, 0.5)).toBeGreaterThanOrEqual(0.2);
  });

  it('replaySteps advances through all points', () => {
    const strokes = [
      stroke({
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 1, y: 1, pressure: 0.5 },
          { x: 2, y: 2, pressure: 0.5 },
          { x: 3, y: 3, pressure: 0.5 }
        ]
      }),
      stroke({
        points: [
          { x: 4, y: 4, pressure: 0.5 },
          { x: 5, y: 5, pressure: 0.5 }
        ]
      })
    ];
    const steps = replaySteps(strokes, { pointsPerFrame: 2, maxFrames: 100 });
    expect(steps[0]).toEqual({ strokeIndex: 0, pointIndex: 1 });
    expect(steps.at(-1)).toEqual({ strokeIndex: 1, pointIndex: 1 });
  });

  it('replaySteps caps frame count', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({
      x: i,
      y: i,
      pressure: 0.5
    }));
    const steps = replaySteps([stroke({ points })], { pointsPerFrame: 1, maxFrames: 20 });
    expect(steps.length).toBe(20);
  });

  it('papers resolve by id', () => {
    expect(paperById('chalkboard').background).toMatch(/#2a3328/i);
    expect(paperById('transparent').background).toBe('transparent');
    expect(paperById('nope').id).toBe('parchment');
  });
});

describe('paintDrawing', () => {
  it('is exported for the canvas painter', () => {
    expect(typeof paintDrawing).toBe('function');
  });
});

describe('shape tools', () => {
  it('recognizes line/rect/ellipse', () => {
    expect(isShapeTool('line')).toBe(true);
    expect(isShapeTool('rect')).toBe(true);
    expect(isShapeTool('ellipse')).toBe(true);
    expect(isShapeTool('brush')).toBe(false);
  });

  it('replaySteps works for two-point shapes', () => {
    const steps = replaySteps(
      [
        stroke({
          tool: 'line',
          points: [
            { x: 0, y: 0, pressure: 0.5 },
            { x: 10, y: 10, pressure: 0.5 }
          ]
        })
      ],
      { pointsPerFrame: 1, maxFrames: 10 }
    );
    expect(steps.at(-1)).toEqual({ strokeIndex: 0, pointIndex: 1 });
  });
});

describe('text labels', () => {
  it('recognizes the text tool', () => {
    expect(isTextTool('text')).toBe(true);
    expect(isTextTool('brush')).toBe(false);
  });

  it('includes cursive, italic, and comic fonts', () => {
    expect(drawFontById('cursive').family.toLowerCase()).toContain('cursive');
    expect(drawFontById('italic').style).toBe('italic');
    expect(drawFontById('comic').family).toMatch(/Comic Sans/i);
  });

  it('canvasFontString includes italic style', () => {
    expect(canvasFontString(24, drawFontById('italic'))).toMatch(/^italic /);
    expect(canvasFontString(24, drawFontById('comic'))).toMatch(/Comic Sans/i);
  });
});

describe('highlighter', () => {
  it('is wider than brush at the same base width', () => {
    const brush = stroke({ tool: 'brush', width: 10, points: [] });
    const mark = stroke({ tool: 'highlighter', width: 10, points: [] });
    expect(strokeWidthAt(mark, 0.5)).toBeGreaterThan(strokeWidthAt(brush, 0.5));
  });

  it('colorWithAlpha builds rgba from hex', () => {
    expect(colorWithAlpha('#ffe566', 0.5)).toBe('rgba(255, 229, 102, 0.5)');
    expect(colorWithAlpha('#abc', 1)).toBe('rgba(170, 187, 204, 1)');
  });
});
