import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteComposeDraft,
  isComposeDraftEmpty,
  listComposeDrafts,
  loadComposeDraft,
  saveComposeDraft,
  type ComposeDraftState
} from './compose-drafts';

const PK = 'a'.repeat(64);

function blank(over: Partial<ComposeDraftState> = {}): ComposeDraftState {
  return {
    kind: 1,
    content: '',
    values: {},
    hashtags: [],
    imetaTags: [],
    freeformTags: [],
    updatedAt: 1,
    ...over
  };
}

function mockSessionStorage(): void {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    }
  };
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: store
  });
}

beforeEach(() => {
  mockSessionStorage();
});

afterEach(() => {
  deleteComposeDraft(PK, 1);
  deleteComposeDraft(PK, 30040);
});

describe('isComposeDraftEmpty', () => {
  it('treats blank shells as empty', () => {
    expect(isComposeDraftEmpty(blank())).toBe(true);
    expect(isComposeDraftEmpty(blank({ hashtags: [''], freeformTags: [['', '']] }))).toBe(true);
  });

  it('ignores catalog baseline defaults', () => {
    expect(
      isComposeDraftEmpty(blank({ kind: 30040, values: { publication_type: 'book' } }), {
        publication_type: 'book'
      })
    ).toBe(true);
  });

  it('detects real user input', () => {
    expect(isComposeDraftEmpty(blank({ content: 'hello' }))).toBe(false);
    expect(isComposeDraftEmpty(blank({ hashtags: ['poetry'] }))).toBe(false);
    expect(
      isComposeDraftEmpty(blank({ values: { title: 'Guide' } }), { title: '' })
    ).toBe(false);
  });
});

describe('compose draft persistence', () => {
  it('lists only non-empty drafts and purges empty shells', () => {
    saveComposeDraft(PK, blank({ content: '' }));
    saveComposeDraft(PK, blank({ kind: 30040, content: 'x', updatedAt: 9 }));
    expect(listComposeDrafts(PK).map((d) => d.kind)).toEqual([30040]);
    expect(loadComposeDraft(PK, 1)).toBeNull();
  });
});
