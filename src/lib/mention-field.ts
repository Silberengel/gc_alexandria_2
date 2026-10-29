import {
  activeMention,
  insertMention,
  type MentionCandidate,
  type MentionInsertMode
} from './mention';
import { localMentionCandidates, searchMentions } from './mention-search';

export type MentionUiState = {
  open: boolean;
  query: string;
  hits: MentionCandidate[];
  busy: boolean;
  index: number;
};

export const MENTION_UI_IDLE: MentionUiState = {
  open: false,
  query: '',
  hits: [],
  busy: false,
  index: 0
};

export type MentionFieldBinding = {
  destroy: () => void;
  choose: (index: number) => void;
  setIndex: (index: number) => void;
};

/**
 * `@handle` suggestions on a text field.
 * Prose fields insert `nostr:npub…`; npub fields insert the bech32 alone.
 */
export function attachMentionField(
  node: HTMLInputElement | HTMLTextAreaElement,
  opts: {
    mode: MentionInsertMode | (() => MentionInsertMode);
    onState: (state: MentionUiState) => void;
  }
): MentionFieldBinding {
  let mention = activeMention('', 0);
  let hits: MentionCandidate[] = [];
  let busy = false;
  let index = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const mode = () => (typeof opts.mode === 'function' ? opts.mode() : opts.mode);

  function emit(): void {
    opts.onState({
      open: mention !== null,
      query: mention?.query ?? '',
      hits,
      busy,
      index
    });
  }

  function clearTimer(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function close(): void {
    clearTimer();
    if (!mention) return;
    generation += 1;
    mention = null;
    hits = [];
    busy = false;
    index = 0;
    emit();
  }

  function sync(): void {
    if (node.disabled || node.readOnly) {
      close();
      return;
    }
    if (node.selectionStart !== node.selectionEnd) {
      close();
      return;
    }
    const active = activeMention(node.value, node.selectionStart ?? 0);
    if (!active) {
      close();
      return;
    }
    if (mention && mention.start === active.start && mention.query === active.query) return;
    mention = active;
    index = 0;
    generation += 1;
    const gen = generation;
    const q = active.query;
    hits = localMentionCandidates(q);
    const network = q.trim().length >= 2;
    busy = network;
    emit();
    clearTimer();
    if (!network) {
      busy = false;
      emit();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void searchMentions(q)
        .then((next) => {
          if (gen !== generation) return;
          hits = next;
          busy = false;
          if (index >= hits.length) index = 0;
          emit();
        })
        .catch(() => {
          if (gen !== generation) return;
          busy = false;
          emit();
        });
    }, 180);
  }

  function choose(at: number): void {
    const hit = hits[at];
    const current = mention;
    if (!hit || !current) return;
    const end = node.selectionStart ?? current.start + 1 + current.query.length;
    const edit = insertMention(node.value, current.start, end, hit.npub, mode());
    close();
    if (!edit) return;
    node.value = edit.value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    const place = () => {
      node.focus();
      node.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    };
    place();
    setTimeout(place, 0);
  }

  function setIndex(next: number): void {
    if (!hits.length || !mention) return;
    index = (next + hits.length) % hits.length;
    emit();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing || !mention) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!hits.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(index - 1);
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      choose(index);
    }
  }

  function onBlur(): void {
    setTimeout(() => {
      if (document.activeElement === node) return;
      close();
    }, 140);
  }

  node.addEventListener('input', sync);
  node.addEventListener('keyup', sync);
  node.addEventListener('click', sync);
  node.addEventListener('select', sync);
  node.addEventListener('keydown', onKeydown as EventListener);
  node.addEventListener('blur', onBlur);

  return {
    choose,
    setIndex,
    destroy() {
      clearTimer();
      generation += 1;
      node.removeEventListener('input', sync);
      node.removeEventListener('keyup', sync);
      node.removeEventListener('click', sync);
      node.removeEventListener('select', sync);
      node.removeEventListener('keydown', onKeydown as EventListener);
      node.removeEventListener('blur', onBlur);
    }
  };
}
