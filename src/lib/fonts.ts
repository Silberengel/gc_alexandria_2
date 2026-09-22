/** Curated stacks for Settings font dropdowns. */

export type FontChoice = {
  label: string;
  stack: string;
};

export const UI_FONT_CHOICES: FontChoice[] = [
  { label: 'Source Sans 3', stack: '"Source Sans 3", system-ui, sans-serif' },
  { label: 'System default', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'IBM Plex Sans', stack: '"IBM Plex Sans", system-ui, sans-serif' },
  { label: 'Nunito Sans', stack: '"Nunito Sans", system-ui, sans-serif' },
  { label: 'Libre Franklin', stack: '"Libre Franklin", system-ui, sans-serif' }
];

export const READING_FONT_CHOICES: FontChoice[] = [
  { label: 'Literata', stack: 'Literata, Georgia, serif' },
  { label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { label: 'Source Serif 4', stack: '"Source Serif 4", Georgia, serif' },
  { label: 'EB Garamond', stack: '"EB Garamond", Georgia, serif' },
  { label: 'Libre Baskerville', stack: '"Libre Baskerville", Georgia, serif' },
  { label: 'Merriweather', stack: 'Merriweather, Georgia, serif' }
];

export function fontSelectValue(current: string, choices: readonly FontChoice[]): string {
  const exact = choices.find((c) => c.stack === current);
  if (exact) return exact.stack;
  return current;
}

export function isKnownFont(current: string, choices: readonly FontChoice[]): boolean {
  return choices.some((c) => c.stack === current);
}
