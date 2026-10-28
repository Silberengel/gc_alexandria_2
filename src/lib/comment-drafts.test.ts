import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearThreadDraftsForPubkey,
  deleteThreadDraft,
  isDrawingDraftEmpty,
  isThreadDraftEmpty,
  loadDrawingDraft,
  loadThreadDraft,
  quoteDraftScope,
  saveDrawingDraft,
  saveThreadDraft
} from './comment-drafts';

const mem = new Map<string, string>();

beforeAll(() => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, String(v));
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
      get length() {
        return mem.size;
      },
      key: (i: number) => [...mem.keys()][i] ?? null
    }
  });
});

beforeEach(() => {
  mem.clear();
});

describe('thread drafts', () => {
  it('round-trips text and imeta', () => {
    saveThreadDraft('pk', 'comment:abc', {
      text: 'hello\nhttps://cdn.example/draw.gif',
      imetaTags: [['imeta', 'url https://cdn.example/draw.gif', 'm image/gif']],
      asKind1Reply: true
    });
    const loaded = loadThreadDraft('pk', 'comment:abc');
    expect(loaded?.text).toContain('draw.gif');
    expect(loaded?.imetaTags[0]?.[0]).toBe('imeta');
    expect(loaded?.asKind1Reply).toBe(true);
  });

  it('deletes empty drafts instead of storing shells', () => {
    saveThreadDraft('pk', 'comment:abc', {
      text: 'x',
      imetaTags: [],
      asKind1Reply: false
    });
    saveThreadDraft('pk', 'comment:abc', {
      text: '  ',
      imetaTags: [],
      asKind1Reply: false
    });
    expect(loadThreadDraft('pk', 'comment:abc')).toBeNull();
    expect(isThreadDraftEmpty({ text: '', imetaTags: [] })).toBe(true);
  });

  it('deleteThreadDraft removes the key', () => {
    saveThreadDraft('pk', 'reply:1', {
      text: 'hi',
      imetaTags: [],
      asKind1Reply: false
    });
    deleteThreadDraft('pk', 'reply:1');
    expect(loadThreadDraft('pk', 'reply:1')).toBeNull();
  });
});

describe('drawing drafts', () => {
  it('round-trips strokes', () => {
    saveDrawingDraft('pk', 'ink:evt:q', {
      strokes: [{ tool: 'brush', color: '#111', width: 4, points: [], seed: 1 }],
      paperId: 'sticky',
      mirror: false
    });
    const loaded = loadDrawingDraft('pk', 'ink:evt:q');
    expect(loaded?.paperId).toBe('sticky');
    expect(loaded?.strokes).toHaveLength(1);
  });

  it('keeps a background-only draft', () => {
    saveDrawingDraft('pk', 'draw:1', {
      strokes: [],
      paperId: 'parchment',
      mirror: false,
      backgroundDataUrl: 'data:image/jpeg;base64,abc',
      backgroundName: 'photo.jpg'
    });
    const loaded = loadDrawingDraft('pk', 'draw:1');
    expect(loaded?.backgroundName).toBe('photo.jpg');
    expect(isDrawingDraftEmpty({ strokes: [], backgroundDataUrl: 'data:image/jpeg;base64,x' })).toBe(
      false
    );
  });
});

describe('quoteDraftScope', () => {
  it('is stable for the same quote', () => {
    expect(quoteDraftScope('Hello  world')).toBe(quoteDraftScope('Hello world'));
  });
});

describe('clearThreadDraftsForPubkey', () => {
  it('clears thread and drawing drafts for one pubkey', () => {
    saveThreadDraft('aaa', 'c1', { text: 'a', imetaTags: [], asKind1Reply: false });
    saveDrawingDraft('aaa', 'd1', { strokes: [1], paperId: 'grid', mirror: false });
    saveThreadDraft('bbb', 'c1', { text: 'b', imetaTags: [], asKind1Reply: false });
    clearThreadDraftsForPubkey('aaa');
    expect(loadThreadDraft('aaa', 'c1')).toBeNull();
    expect(loadDrawingDraft('aaa', 'd1')).toBeNull();
    expect(loadThreadDraft('bbb', 'c1')?.text).toBe('b');
  });
});
