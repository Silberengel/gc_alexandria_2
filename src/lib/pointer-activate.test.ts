import { describe, expect, it, vi } from 'vitest';
import { createPointerArm, hasNonEmptySelection } from './pointer-activate';

function fakePointer(partial: Partial<PointerEvent> & { pointerId: number }): PointerEvent {
  return partial as PointerEvent;
}

function fakeClick(): MouseEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  } as unknown as MouseEvent;
}

describe('createPointerArm', () => {
  it('runs on pointerdown and absorbs the follow-up click', () => {
    const arm = createPointerArm();
    const fn = vi.fn();
    arm.run(fakePointer({ pointerId: 1, pointerType: 'pen', button: 0 }), fn);
    expect(fn).toHaveBeenCalledOnce();
    const click = fakeClick();
    arm.absorbClick(click, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(click.preventDefault).toHaveBeenCalled();
  });

  it('falls back to click when pointerdown never armed', () => {
    const arm = createPointerArm();
    const fn = vi.fn();
    arm.absorbClick(fakeClick(), fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('ignores non-primary mouse buttons', () => {
    const arm = createPointerArm();
    const fn = vi.fn();
    arm.run(fakePointer({ pointerId: 2, pointerType: 'mouse', button: 2 }), fn);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('hasNonEmptySelection', () => {
  it('is false without a window selection', () => {
    expect(hasNonEmptySelection()).toBe(false);
  });
});
