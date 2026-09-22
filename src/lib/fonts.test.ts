import { describe, expect, it } from 'vitest';
import {
  UI_FONT_CHOICES,
  READING_FONT_CHOICES,
  fontSelectValue,
  isKnownFont
} from './fonts';

describe('font choices', () => {
  it('matches known stacks for the dropdown value', () => {
    expect(fontSelectValue(UI_FONT_CHOICES[0].stack, UI_FONT_CHOICES)).toBe(UI_FONT_CHOICES[0].stack);
    expect(isKnownFont(READING_FONT_CHOICES[1].stack, READING_FONT_CHOICES)).toBe(true);
    expect(isKnownFont('Comic Sans MS', UI_FONT_CHOICES)).toBe(false);
  });
});
