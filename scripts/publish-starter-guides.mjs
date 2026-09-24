#!/usr/bin/env node
/**
 * Build (and optionally publish) GitCitadel starter-guide bookshelves (kind 30045).
 *
 * Usage:
 *   node scripts/publish-starter-guides.mjs              # dry-run resolve + print drafts
 *   node scripts/publish-starter-guides.mjs --publish    # sign + publish (needs NSEC)
 *
 * Env:
 *   NSEC                 — curator secret (never commit). Required for --publish.
 *   STARTER_GUIDES_SEED  — path to seed JSON (default: scripts/starter-guides/seed.json)
 *   RELAYS               — comma-separated wss URLs (default: thecitadel + theforest; not Mercury)
 *
 * Seed entries must resolve to live curator 30040 events. Missing ids abort that shelf.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeEvent, getPublicKey, nip19, SimplePool } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CURATOR_NPUB =
  'npub18cddpua960qjy3wmw7y9gmzr4h3ajlrwq3k9jnmqzlxke4qkg6gqeyaztw';
const CURATOR_HEX = (() => {
  const d = nip19.decode(CURATOR_NPUB);
  if (d.type !== 'npub') throw new Error('bad curator npub');
  return d.data;
})();

const KIND_DIR = 30045;
const KIND_PUB = 30040;
const MAX_ITEMS = 500;

const ROOT_D = 'gc-starter-guides';
const GENRES = [
  'ancient-classics',
  'great-books',
  'catholic-classics',
  'classic-novels',
  'black-authors'
];

const doPublish = process.argv.includes('--publish');
const seedPath =
  process.env.STARTER_GUIDES_SEED || join(__dirname, 'starter-guides', 'seed.json');
// Writable document/social relays only — Mercury is read-only (REST ingest).
// Override with RELAYS=…
const relayUrls = (process.env.RELAYS || 'wss://thecitadel.nostr1.com,wss://theforest.nostr1.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function membershipATag(event) {
  return ['a', `${event.kind}:${event.pubkey}:${dTag(event)}`, '', event.id.toLowerCase()];
}

function folderATag(d, eventId = '') {
  const coord = `${KIND_DIR}:${CURATOR_HEX}:${d}`;
  return eventId ? ['a', coord, '', eventId.toLowerCase()] : ['a', coord, '', ''];
}

function dTag(event) {
  return event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
}

function titleOf(event) {
  return event.tags.find((t) => t[0] === 'title')?.[1] ?? dTag(event);
}

async function query(pool, filter, ms = 12000) {
  try {
    return await Promise.race([
      pool.querySync(relayUrls, filter),
      new Promise((r) => setTimeout(() => r([]), ms))
    ]);
  } catch {
    return [];
  }
}

async function resolvePublication(pool, { gutenberg, d }) {
  if (d) {
    const hits = await query(pool, {
      kinds: [KIND_PUB],
      authors: [CURATOR_HEX],
      '#d': [d],
      limit: 5
    });
    const best = hits.sort((a, b) => b.created_at - a.created_at)[0];
    if (best) return best;
  }
  if (gutenberg != null && gutenberg !== '') {
    const id = String(gutenberg).replace(/^gutenberg:/i, '');
    const hits = await query(pool, {
      kinds: [KIND_PUB],
      authors: [CURATOR_HEX],
      '#i': [`gutenberg:${id}`],
      limit: 10
    });
    // Prefer top-level (any hit with matching i-tag)
    const best = hits.sort((a, b) => b.created_at - a.created_at)[0];
    if (best) return best;
  }
  return null;
}

function draftDirectory(d, aTags) {
  if (aTags.length > MAX_ITEMS) {
    throw new Error(`${d}: ${aTags.length} children exceeds max ${MAX_ITEMS}`);
  }
  return {
    kind: KIND_DIR,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', d], ...aTags],
    content: ''
  };
}

function loadSeed() {
  const raw = JSON.parse(readFileSync(seedPath, 'utf8'));
  return raw.shelves || raw;
}

function quietClose(pool) {
  try {
    pool.close(relayUrls);
  } catch {
    // nostr-tools rejects open subscriptions when sockets close; ignore.
  }
}

async function main() {
  const seed = loadSeed();
  const pool = new SimplePool();
  const resolved = new Map(); // shelf d -> Event[]
  const misses = [];

  console.log(`Seed: ${seedPath}`);
  console.log(`Curator: ${CURATOR_HEX.slice(0, 12)}…`);
  console.log(`Relays: ${relayUrls.join(', ')}`);
  console.log(doPublish ? 'Mode: PUBLISH' : 'Mode: dry-run');

  for (const shelfD of GENRES) {
    const entry = seed[shelfD] || { gutenberg: [], d_tags: [] };
    const gids = entry.gutenberg || [];
    const dts = entry.d_tags || [];
    const pubs = [];
    for (const g of gids) {
      const hit = await resolvePublication(pool, { gutenberg: g });
      if (!hit) {
        misses.push(`${shelfD}: gutenberg:${g}`);
        continue;
      }
      pubs.push(hit);
      console.log(`  OK ${shelfD}  gutenberg:${g} → ${titleOf(hit)} (${dTag(hit)})`);
    }
    for (const d of dts) {
      const hit = await resolvePublication(pool, { d });
      if (!hit) {
        misses.push(`${shelfD}: d=${d}`);
        continue;
      }
      pubs.push(hit);
      console.log(`  OK ${shelfD}  d=${d} → ${titleOf(hit)}`);
    }
    resolved.set(shelfD, pubs);
  }

  if (misses.length) {
    console.error('\nUnresolved entries (fix seed; refusing to invent coordinates):');
    for (const m of misses) console.error(`  - ${m}`);
    quietClose(pool);
    process.exitCode = 1;
    return;
  }

  // Build drafts bottom-up: genre shelves → root
  const drafts = new Map();

  for (const genre of GENRES) {
    const pubs = resolved.get(genre) || [];
    drafts.set(
      genre,
      draftDirectory(
        genre,
        pubs.map((e) => membershipATag(e))
      )
    );
  }

  drafts.set(
    ROOT_D,
    draftDirectory(
      ROOT_D,
      GENRES.map((g) => folderATag(g))
    )
  );

  console.log('\nDrafts:');
  for (const [d, draft] of drafts) {
    const n = draft.tags.filter((t) => t[0] === 'a').length;
    console.log(`  30045 d=${d}  children=${n}`);
  }

  if (!doPublish) {
    console.log('\nDry-run complete. Re-run with --publish and NSEC=… to sign and send.');
    quietClose(pool);
    return;
  }

  const nsec = process.env.NSEC?.trim();
  if (!nsec) {
    console.error('NSEC env required for --publish');
    quietClose(pool);
    process.exitCode = 1;
    return;
  }
  let sk;
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('expected nsec');
    sk = decoded.data;
  } catch {
    // raw hex
    sk = hexToBytes(nsec.replace(/^0x/, ''));
  }
  const pk = getPublicKey(sk);
  if (pk.toLowerCase() !== CURATOR_HEX) {
    console.error(`NSEC pubkey ${pk} does not match curator ${CURATOR_HEX}`);
    quietClose(pool);
    process.exitCode = 1;
    return;
  }

  // Publish leaves first so root folder a-tags can include event ids.
  const order = [...GENRES, ROOT_D];
  const publishedIds = new Map();
  let failed = 0;

  for (const d of order) {
    let draft = drafts.get(d);
    if (!draft) continue;
    // Refresh root folder a-tags with published child ids when available
    if (d === ROOT_D) {
      draft = draftDirectory(
        d,
        GENRES.map((g) => folderATag(g, publishedIds.get(g) || ''))
      );
    }
    const signed = finalizeEvent({ ...draft }, sk);
    publishedIds.set(d, signed.id);

    // SimplePool.publish returns Promise[] (one per relay), not a single Promise.
    const perRelay = pool.publish(relayUrls, signed).map((p, i) =>
      Promise.race([
        Promise.resolve(p).then(() => relayUrls[i]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12_000))
      ]).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ${relayUrls[i]} rejected ${d}: ${msg}`);
        return null;
      })
    );
    const ok = (await Promise.all(perRelay)).filter(Boolean);
    if (!ok.length) {
      failed += 1;
      console.error(`FAILED ${d} id=${signed.id.slice(0, 12)}… (no relay accepted)`);
    } else {
      console.log(`Published ${d} id=${signed.id.slice(0, 12)}… → ${ok.join(', ')}`);
    }
  }

  if (failed) {
    console.error(`Done with ${failed} failure(s).`);
    quietClose(pool);
    process.exit(1);
  }
  console.log('Done.');
  quietClose(pool);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
