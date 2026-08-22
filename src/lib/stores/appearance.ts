import { writable } from 'svelte/store';

export type Scheme = 'light' | 'ocean' | 'forrest';

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
  scheme: 'light',
  dark: false,
  uiFont: 'system-ui, sans-serif',
  readingFont: 'Georgia, serif',
  readingSize: 18
};

function load(): AppearanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...defaults };
}

function apply(state: AppearanceState): void {
  const root = document.documentElement;
  root.dataset.theme = state.scheme === 'light' ? '' : state.scheme;
  root.classList.toggle('dark', state.dark);
  root.style.setProperty('--ui-font', state.uiFont);
  root.style.setProperty('--reading-font', state.readingFont);
  root.style.setProperty('--reading-size', `${state.readingSize}px`);
  if (state.customPrimary) root.style.setProperty('--brand-primary-500', state.customPrimary);
}

function createAppearanceStore() {
  const initial = load();
  apply(initial);
  const { subscribe, set, update } = writable<AppearanceState>(initial);

  function persist(state: AppearanceState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
        const next = { ...s, uiFont, readingFont, readingSize };
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
