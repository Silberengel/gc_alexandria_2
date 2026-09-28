import type { Event } from 'nostr-tools';
import {
  convertAsciiDocViaServer,
  isAsciiDoctorServerConfigured
} from './asciidoctor-server-client';
import { KIND } from './constants';
import { fetchByAddresses, fetchByIds } from './nostr/fetch';
import { mercuryPublicationExport } from './nostr/mercury';
import {
  assemblePublicationAsciidoc,
  indexPublicationEvents,
  orderedPublicationRefsFromIndex,
  type AssembledPublicationAsciidoc
} from './publication-asciidoc-assembler';
import { eventAddress } from './nostr/verify';
import { naddrFor } from './publication-load';

export type PublicationDownloadFormat = 'adoc' | 'epub' | 'pdf';

export { isAsciiDoctorServerConfigured };

function safeFilename(title: string, extension: string): string {
  const safe = title.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[\W_]+|[\W_]+$/g, '');
  const base = (safe || 'publication').slice(0, 80);
  return `${base}.${extension}`;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function assembleFromEvents(rootIndex: Event, events: Event[]): AssembledPublicationAsciidoc {
  const fetched = new Map<string, Event>();
  indexPublicationEvents(fetched, [rootIndex, ...events]);
  const eventsByAddress = new Map<string, Event>();
  const seenIds = new Set<string>();
  for (const ev of fetched.values()) {
    if (seenIds.has(ev.id)) continue;
    seenIds.add(ev.id);
    const addr = eventAddress(ev);
    if (addr) eventsByAddress.set(addr, ev);
  }
  const assembled = assemblePublicationAsciidoc(rootIndex, fetched, eventsByAddress);
  if (!assembled.content.trim()) {
    throw new Error('Publication has no exportable content.');
  }
  return assembled;
}

/** Walk a/e tags when Mercury export is empty and the page has no corpus yet. */
async function fetchPublicationTreeByWalking(root: Event): Promise<Event[]> {
  const out: Event[] = [];
  const seen = new Set<string>([root.id, eventAddress(root)]);
  let frontier: Event[] = [root];

  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const addrs: string[] = [];
    const ids: string[] = [];
    for (const ev of frontier) {
      for (const ref of orderedPublicationRefsFromIndex(ev)) {
        if (ref.type === 'a') {
          if (seen.has(ref.coordinate)) continue;
          seen.add(ref.coordinate);
          addrs.push(ref.coordinate);
        } else {
          if (seen.has(ref.eventId)) continue;
          seen.add(ref.eventId);
          ids.push(ref.eventId);
        }
      }
    }
    if (!addrs.length && !ids.length) break;
    const [byAddr, byId] = await Promise.all([
      addrs.length ? fetchByAddresses(addrs, 4) : Promise.resolve([] as Event[]),
      ids.length ? fetchByIds(ids) : Promise.resolve([] as Event[])
    ]);
    const batch = [...byAddr, ...byId];
    out.push(...batch);
    frontier = batch.filter((e) => e.kind === KIND.PUBLICATION);
  }

  return out;
}

/**
 * Prefer Mercury `/export`, then already-loaded page events, then an a/e walk.
 */
export async function collectPublicationEventsForExport(
  root: Event,
  seedEvents: Event[] = []
): Promise<Event[]> {
  try {
    const naddr = naddrFor(root);
    const fromMercury = await mercuryPublicationExport(naddr);
    const nested = fromMercury.filter((e) => e.id !== root.id);
    if (nested.length > 0) return nested;
  } catch {
    // fall through
  }

  const seeded = seedEvents.filter((e) => e.id !== root.id);
  if (seeded.length > 0) return seeded;

  return fetchPublicationTreeByWalking(root);
}

async function downloadAssembled(
  assembled: AssembledPublicationAsciidoc,
  format: PublicationDownloadFormat
): Promise<{ filename: string }> {
  if (format === 'adoc') {
    const blob = new Blob([assembled.content], { type: 'text/plain;charset=utf-8' });
    const filename = safeFilename(assembled.title, 'adoc');
    downloadBlob(filename, blob);
    return { filename };
  }

  if (!isAsciiDoctorServerConfigured()) {
    throw new Error('Publication export server is not configured.');
  }

  const serverFormat = format === 'epub' ? 'epub3' : 'pdf';
  // Cover is already in the AsciiDoc (`:front-cover-image:` + title page). Passing
  // `image` again makes the AsciiDoctor sidecar inject a duplicate on the title page.
  const converted = await convertAsciiDocViaServer(
    serverFormat,
    assembled.content,
    assembled.title,
    assembled.author,
    null
  );
  const filename = safeFilename(assembled.title, converted.extension);
  downloadBlob(filename, converted.blob);
  return { filename };
}

export async function exportPublicationDownload(
  root: Event,
  format: PublicationDownloadFormat,
  seedEvents: Event[] = []
): Promise<{ filename: string }> {
  const nested = await collectPublicationEventsForExport(root, seedEvents);
  if (nested.length === 0 && !orderedPublicationRefsFromIndex(root).length) {
    throw new Error('Publication has no nested reading content.');
  }
  if (nested.length === 0) {
    throw new Error('Publication export unavailable — could not load sections.');
  }
  const assembled = assembleFromEvents(root, nested);
  return downloadAssembled(assembled, format);
}
