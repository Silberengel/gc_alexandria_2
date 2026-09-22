import { writable } from 'svelte/store';

export type Scheme = 'antique' | 'ocean' | 'forrest';

export type AppearanceState = {
  scheme: Scheme;
  dark: boolean;
  uiFont: string;
  readingFont: string;
  readingSize: number;
  customPrimary?: string;
};

const STORAGE_KEY = 'alexandria-appearance';

const defaults: AppearanceState = {
  scheme: 'antique',
  dark: false,
  uiFont: '"Source Sans 3", system-ui, sans-serif',
  readingFont: 'Literata, Georgia, serif',
  readingSize: 18
};

function load(): AppearanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = { ...defaults, ...JSON.parse(raw) } as AppearanceState;
      parsed.readingSize = clampReadingSize(parsed.readingSize);
      // Lift stock fonts from the previous defaults to the current library faces.
      if (parsed.uiFont === 'system-ui, sans-serif') parsed.uiFont = defaults.uiFont;
      if (parsed.readingFont === 'Georgia, serif') parsed.readingFont = defaults.readingFont;
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { ...defaults };
}

/** Clamp to Settings control range; keeps rem scaling predictable. */
export function clampReadingSize(n: number): number {
  if (!Number.isFinite(n)) return defaults.readingSize;
  return Math.min(28, Math.max(14, Math.round(n)));
}

function apply(state: AppearanceState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const readingSize = clampReadingSize(state.readingSize);
  root.dataset.theme = state.scheme === 'antique' ? '' : state.scheme;
  root.classList.toggle('dark', state.dark);
  root.style.setProperty('--ui-font', state.uiFont);
  root.style.setProperty('--reading-font', state.readingFont);
  root.style.setProperty('--reading-size', `${readingSize}px`);
  // Design baseline: 16px rem when reading size is 18 — all rem UI scales with it.
  root.style.setProperty('--ui-size', `${(readingSize * 16) / 18}px`);
  if (state.customPrimary) root.style.setProperty('--brand-primary-500', state.customPrimary);
}

function createAppearanceStore() {
  const initial = typeof localStorage !== 'undefined' ? load() : { ...defaults };
  apply(initial);
  const { subscribe, set, update } = writable<AppearanceState>(initial);

  function persist(state: AppearanceState): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    apply(state);
  }

  return {
    subscribe,
    setScheme(scheme: Scheme) {
      update((s) => {
        const next = { ...s, scheme };
        persist(next);
        return next;
      });
    },
    setDark(dark: boolean) {
      update((s) => {
        const next = { ...s, dark };
        persist(next);
        return next;
      });
    },
    setFonts(uiFont: string, readingFont: string, readingSize: number) {
      update((s) => {
        const next = { ...s, uiFont, readingFont, readingSize: clampReadingSize(readingSize) };
        persist(next);
        return next;
      });
    },
    resetColors() {
      update((s) => {
        const next = { ...s, customPrimary: undefined };
        document.documentElement.style.removeProperty('--brand-primary-500');
        persist(next);
        return next;
      });
    }
  };
}

export const appearance = createAppearanceStore();
