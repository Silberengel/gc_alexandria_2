import { writable } from 'svelte/store';

export type ReadingFinishUi = {
  open: boolean;
  publicationId: string;
  title: string;
  shiftedTitle?: string;
};

const empty: ReadingFinishUi = {
  open: false,
  publicationId: '',
  title: ''
};

export const readingFinishUi = writable<ReadingFinishUi>({ ...empty });

export function openReadingFinish(opts: {
  publicationId: string;
  title: string;
  shiftedTitle?: string;
}): void {
  readingFinishUi.set({
    open: true,
    publicationId: opts.publicationId,
    title: opts.title,
    shiftedTitle: opts.shiftedTitle
  });
}

export function closeReadingFinish(): void {
  readingFinishUi.set({ ...empty });
}
