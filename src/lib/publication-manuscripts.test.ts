import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clampManuscriptIndexDepth,
  deleteManuscript,
  deleteManuscriptsForPubkey,
  dropManuscriptBodyForTests,
  failNextManuscriptPutForTests,
  flushStagedManuscript,
  getManuscript,
  getManuscriptResult,
  installMemoryManuscriptStoreForTests,
  listManuscriptMetas,
  localDraftMatchesManuscript,
  newManuscriptId,
  onManuscriptFlushed,
  onManuscriptPersistError,
  putManuscript,
  resetManuscriptStoreForTests,
  scheduleManuscriptPersist,
  stageManuscript,
  type PublicationManuscript
} from './publication-manuscripts';

const PK = 'ab'.repeat(32);

function sample(over: Partial<PublicationManuscript> = {}): PublicationManuscript {
  return {
    id: over.id ?? newManuscriptId(),
    pubkey: PK,
    title: 'Monte Cristo',
    dTag: 'monte-cristo',
    source: '== Chapter\n\nBody\n',
    maxIndexLevel: 2,
    updatedAt: Date.now(),
    ...over
  };
}

describe('publication-manuscripts', () => {
  beforeEach(() => {
    installMemoryManuscriptStoreForTests();
  });

  afterEach(() => {
    resetManuscriptStoreForTests();
  });

  it('puts, lists metas without requiring full body loads for identity', async () => {
    const a = sample({ title: 'A', updatedAt: 10 });
    const b = sample({ title: 'B', updatedAt: 20, dTag: 'b' });
    await putManuscript(a);
    await putManuscript(b);
    await putManuscript(sample({ pubkey: 'cd'.repeat(32), title: 'Other' }));

    const listed = await listManuscriptMetas(PK);
    expect(listed.map((m) => m.title)).toEqual(['B', 'A']);
    expect(listed[0]).not.toHaveProperty('source');
    expect(await getManuscript(a.id)).toMatchObject({ title: 'A', source: a.source });
  });

  it('round-trips compose metadata on the manuscript meta row', async () => {
    const m = sample({
      id: 'with-meta',
      composeValues: { title: 'Castle', authors: 'Teresa of Avila', summary: 'Mansions' },
      composeHashtags: ['mystic'],
      composeContent: 'preface'
    });
    await putManuscript(m);
    const got = await getManuscript('with-meta');
    expect(got?.composeValues).toEqual({
      title: 'Castle',
      authors: 'Teresa of Avila',
      summary: 'Mansions'
    });
    expect(got?.composeHashtags).toEqual(['mystic']);
    expect(got?.composeContent).toBe('preface');
    const listed = await listManuscriptMetas(PK);
    expect(listed.find((row) => row.id === 'with-meta')?.composeValues?.authors).toBe(
      'Teresa of Avila'
    );
  });

  it('deletes one and all for pubkey', async () => {
    const a = sample({ id: 'a1' });
    const b = sample({ id: 'b1', dTag: 'b' });
    await putManuscript(a);
    await putManuscript(b);
    await deleteManuscript(a.id);
    expect(await getManuscript(a.id)).toBeNull();
    expect((await listManuscriptMetas(PK)).map((m) => m.id)).toEqual(['b1']);
    await deleteManuscriptsForPubkey(PK);
    expect(await listManuscriptMetas(PK)).toEqual([]);
  });

  it('flushes staged manuscript and notifies listeners', async () => {
    const m = sample({ id: 'staged-1', source: '== Hi\n\nx' });
    let flushed = 0;
    const stop = onManuscriptFlushed(() => {
      flushed += 1;
    });
    stageManuscript(m);
    await flushStagedManuscript();
    expect(await getManuscript('staged-1')).toMatchObject({ source: '== Hi\n\nx' });
    expect(flushed).toBe(1);
    stop();
  });

  it('flushes an empty source so clearing the editor persists', async () => {
    await putManuscript(sample({ id: 'clear-body', source: '== Keep\n\nx' }));
    stageManuscript(
      sample({
        id: 'clear-body',
        source: '',
        composeValues: { title: 'Keep title', authors: 'Ada' }
      })
    );
    await flushStagedManuscript();
    expect(await getManuscript('clear-body')).toMatchObject({
      source: '',
      composeValues: { title: 'Keep title', authors: 'Ada' }
    });
  });

  it('does not let a put after delete resurrect the manuscript', async () => {
    const m = sample({ id: 'race-del', source: '== A\n\nx' });
    await putManuscript(m);
    const putAfter = putManuscript(sample({ id: 'race-del', source: '== B\n\ny' }));
    const del = deleteManuscript('race-del');
    await Promise.all([putAfter, del]);
    expect(await getManuscript('race-del')).toBeNull();
  });

  it('scheduleManuscriptPersist writes after debounce', async () => {
    const m = sample({ id: 'debounced' });
    scheduleManuscriptPersist(m, 20);
    expect(await getManuscript('debounced')).toBeNull();
    await new Promise((r) => setTimeout(r, 40));
    expect(await getManuscript('debounced')).toMatchObject({ title: 'Monte Cristo' });
  });

  it('localDraftMatchesManuscript by id only (not bare d-tag)', () => {
    const m = sample({ id: 'ms-1', dTag: 'book-d' });
    expect(
      localDraftMatchesManuscript({ kind: 30040, publicationManuscriptId: 'ms-1' }, m)
    ).toBe(true);
    expect(localDraftMatchesManuscript({ kind: 30040 }, m)).toBe(false);
    expect(
      localDraftMatchesManuscript({ kind: 30041, publicationManuscriptId: 'ms-1' }, m)
    ).toBe(false);
  });

  it('getManuscriptResult reports orphan without treating it as missing', async () => {
    const m = sample({ id: 'orphan-meta' });
    await putManuscript(m);
    dropManuscriptBodyForTests(m.id);
    expect(await getManuscript(m.id)).toBeNull();
    const result = await getManuscriptResult(m.id);
    expect(result.status).toBe('orphan');
    if (result.status === 'orphan') {
      expect(result.meta.id).toBe(m.id);
    }
    expect((await listManuscriptMetas(PK)).some((row) => row.id === m.id)).toBe(true);
  });

  it('getManuscriptResult reports missing for unknown ids', async () => {
    expect(await getManuscriptResult('no-such-id')).toEqual({ status: 'missing' });
  });

  it('delete cancels a pending debounced flush for that id', async () => {
    const m = sample({ id: 'debounce-delete' });
    scheduleManuscriptPersist(m, 50);
    await deleteManuscript(m.id);
    await new Promise((r) => setTimeout(r, 80));
    expect(await getManuscript(m.id)).toBeNull();
  });

  it('clampManuscriptIndexDepth matches splitter bounds (high → 4)', () => {
    expect(clampManuscriptIndexDepth(1)).toBe(2);
    expect(clampManuscriptIndexDepth(2)).toBe(2);
    expect(clampManuscriptIndexDepth(3)).toBe(3);
    expect(clampManuscriptIndexDepth(4)).toBe(4);
    expect(clampManuscriptIndexDepth(5)).toBe(4);
    expect(clampManuscriptIndexDepth(99)).toBe(4);
    expect(clampManuscriptIndexDepth('4')).toBe(4);
    expect(clampManuscriptIndexDepth(undefined)).toBe(2);
  });

  it('notifies persist-error listeners when flush fails', async () => {
    const errors: string[] = [];
    const stop = onManuscriptPersistError((err) => {
      errors.push(err.message);
    });
    failNextManuscriptPutForTests(new Error('quota exceeded'));
    stageManuscript(sample({ id: 'fail-flush', source: '== X\n\ny' }));
    await flushStagedManuscript();
    expect(errors).toEqual(['quota exceeded']);
    expect(await getManuscript('fail-flush')).toBeNull();
    stop();
  });
});
