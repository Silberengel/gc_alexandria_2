import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  buildShortNoteEditState,
  getEditTargetId,
  getReplyEditId,
  isAuthorEdit,
  isShortNoteEdited,
  mergeEditedShortNote,
  mergeShortNoteEditEvents
} from './short-note-edits';

const kind1Author = 'aa'.repeat(32);
const otherPubkey = 'bb'.repeat(32);
const noteId = 'cc'.repeat(32);

const kind1: Event = {
  id: noteId,
  pubkey: kind1Author,
  created_at: 100,
  kind: KIND.TEXT_NOTE,
  content: 'original',
  tags: [],
  sig: 'sig'
};

function editEvent(
  id: string,
  pubkey: string,
  content: string,
  createdAt: number,
  extraTags: string[][] = []
): Event {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: KIND.SHORT_NOTE_EDIT,
    content,
    tags: [['e', noteId], ...extraTags],
    sig: 'sig'
  };
}

describe('short-note-edits', () => {
  it('reads edit target from e tag with relay and author', () => {
    const edit: Event = {
      id: '72d2b33825f88eba916a262354360a93160c26f1cc2e76aaae9265b480650f06',
      pubkey: kind1Author,
      created_at: 200,
      kind: KIND.SHORT_NOTE_EDIT,
      content: 'revised body',
      tags: [['e', noteId, 'https://mercury-relay.imwald.eu', kind1Author]],
      sig: 'sig'
    };
    expect(getEditTargetId(edit)).toBe(noteId);
    expect(isAuthorEdit(edit, kind1)).toBe(true);
  });

  it('picks latest author edit by created_at', () => {
    const e1 = editEvent('11'.repeat(32), kind1Author, 'v1', 200);
    const e2 = editEvent('22'.repeat(32), kind1Author, 'v2', 300);
    const state = buildShortNoteEditState([e1, e2], kind1);
    expect(state.latestAuthorEdit?.content).toBe('v2');
  });

  it('ignores third-party proposals for latest author edit', () => {
    const author = editEvent('11'.repeat(32), kind1Author, 'fixed', 200);
    const thirdParty = editEvent('22'.repeat(32), otherPubkey, 'suggested', 250, [
      ['p', kind1Author],
      ['summary', 'please fix typo']
    ]);
    const state = buildShortNoteEditState([author, thirdParty], kind1);
    expect(state.latestAuthorEdit?.id).toBe(author.id);
    expect(state.authorEdits).toHaveLength(1);
    expect(state.editProposals).toHaveLength(1);
    expect(isAuthorEdit(thirdParty, kind1)).toBe(false);
  });

  it('merges edited content onto kind 1', () => {
    const edit = editEvent('11'.repeat(32), kind1Author, 'revised', 200);
    const merged = mergeEditedShortNote(kind1, edit);
    expect(merged.content).toBe('revised');
    expect(merged.id).toBe(kind1.id);
    expect(merged.created_at).toBe(kind1.created_at);
    expect(isShortNoteEdited(kind1, edit)).toBe(true);
  });

  it('mergeEditEvents dedupes and keeps latest', () => {
    const e1 = editEvent('11'.repeat(32), kind1Author, 'v1', 200);
    const e2 = editEvent('22'.repeat(32), kind1Author, 'v2', 300);
    const merged = mergeShortNoteEditEvents([e1], [e1, e2], kind1);
    expect(merged.authorEdits.map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(merged.latestAuthorEdit?.content).toBe('v2');
  });

  it('reads edit marker on kind 1111 replies', () => {
    const editId = 'ee'.repeat(32);
    const reply: Event = {
      id: 'ff'.repeat(32),
      pubkey: otherPubkey,
      created_at: 400,
      kind: KIND.COMMENT,
      content: 'thanks',
      tags: [
        ['E', noteId, '', kind1Author],
        ['e', noteId, '', 'reply', kind1Author],
        ['e', editId, '', 'edit', kind1Author]
      ],
      sig: 'sig'
    };
    expect(getReplyEditId(reply)).toBe(editId);
  });
});
