#!/usr/bin/env node
/**
 * Export Douay-Rheims publication tree from Mercury (loopback on imwald-box)
 * into sharded JSONL under gc_alexandria_2/public/seeds/douay/.
 *
 * Usage (on imwald-box, or with MERCURY_URL pointing at loopback via SSH tunnel):
 *   MERCURY_URL=http://127.0.0.1:4000 node scripts/export-douay-seeds.mjs
 *   OUT=/path/to/gc_alexandria_2/public/seeds node scripts/export-douay-seeds.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MERCURY = (process.env.MERCURY_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const AUTHOR = '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690';
const ROOT_D = 'bible-the-bible-douay-rheims-version';
const OUT = process.env.OUT || join(ROOT, 'public', 'seeds');
const SHARD = Number(process.env.SHARD_SIZE) || 2000;

async function post(path, body) {
	const res = await fetch(`${MERCURY}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`${path} ${res.status}`);
	return res.json();
}

async function fetchByD(d, kinds = [30040, 30041]) {
	const j = await post('/api/events/filter', {
		authors: [AUTHOR],
		kinds,
		'#d': [d],
		limit: 5
	});
	const rows = j.data || [];
	return rows[0] || null;
}

function aAddrs(e) {
	const out = [];
	for (const t of e.tags || []) {
		if (t?.[0] === 'a' && t[1]) {
			const parts = String(t[1]).split(':');
			if (parts.length >= 3) {
				const kind = Number(parts[0]);
				if (Number.isFinite(kind)) out.push([kind, parts[2]]);
			}
		}
	}
	return out;
}

async function main() {
	const douayDir = join(OUT, 'douay');
	mkdirSync(douayDir, { recursive: true });
	mkdirSync(join(OUT, 'plans'), { recursive: true });

	const root = await fetchByD(ROOT_D, [30040]);
	if (!root) throw new Error(`root ${ROOT_D} missing on ${MERCURY}`);
	console.log('root', ROOT_D, root.id.slice(0, 16));

	const seenD = new Set();
	const seenId = new Set();
	const queue = [[30040, ROOT_D]];
	const events = [];
	const t0 = Date.now();

	while (queue.length) {
		const [kind, d] = queue.shift();
		if (seenD.has(d)) continue;
		seenD.add(d);
		let e = await fetchByD(d, [kind]);
		if (!e) e = await fetchByD(d, [30040, 30041]);
		if (!e || seenId.has(e.id)) continue;
		seenId.add(e.id);
		events.push(e);
		for (const [ck, cd] of aAddrs(e)) {
			if (!seenD.has(cd)) queue.push([ck, cd]);
		}
		if (events.length % 500 === 0) {
			console.log(`  ${events.length} queued=${queue.length} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
		}
	}

	console.log(`total ${events.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

	const shardNames = [];
	for (let i = 0; i < events.length; i += SHARD) {
		const chunk = events.slice(i, i + SHARD);
		const name = `shard-${String(Math.floor(i / SHARD)).padStart(3, '0')}.jsonl`;
		writeFileSync(join(douayDir, name), chunk.map((e) => JSON.stringify(e)).join('\n') + '\n');
		shardNames.push(`douay/${name}`);
		console.log('wrote', name, chunk.length);
	}

	const manifestPath = join(OUT, 'manifest.json');
	let manifest = {
		version: 1,
		generated_at: Math.floor(Date.now() / 1000),
		author: AUTHOR,
		editions: {},
		plans: {}
	};
	if (existsSync(manifestPath)) {
		try {
			manifest = { ...manifest, ...JSON.parse(readFileSync(manifestPath, 'utf8')) };
		} catch {
			/* keep defaults */
		}
	}
	manifest.generated_at = Math.floor(Date.now() / 1000);
	manifest.author = AUTHOR;
	manifest.editions = {
		...manifest.editions,
		[ROOT_D]: {
			address: `30040:${AUTHOR}:${ROOT_D}`,
			d: ROOT_D,
			shards: shardNames,
			event_count: events.length
		}
	};
	manifest.plans = {
		'biblestr-plan-bible-in-a-year': {
			address: `30040:${AUTHOR}:biblestr-plan-bible-in-a-year`,
			d: 'biblestr-plan-bible-in-a-year',
			shards: ['plans/bible-in-a-year.jsonl'],
			depends_on: [ROOT_D]
		},
		'biblestr-plan-chronological': {
			address: `30040:${AUTHOR}:biblestr-plan-chronological`,
			d: 'biblestr-plan-chronological',
			shards: ['plans/chronological.jsonl'],
			depends_on: [ROOT_D]
		},
		...manifest.plans
	};
	// Ensure plan depends_on and shards win for known keys
	manifest.plans['biblestr-plan-bible-in-a-year'] = {
		address: `30040:${AUTHOR}:biblestr-plan-bible-in-a-year`,
		d: 'biblestr-plan-bible-in-a-year',
		shards: ['plans/bible-in-a-year.jsonl'],
		depends_on: [ROOT_D]
	};
	manifest.plans['biblestr-plan-chronological'] = {
		address: `30040:${AUTHOR}:biblestr-plan-chronological`,
		d: 'biblestr-plan-chronological',
		shards: ['plans/chronological.jsonl'],
		depends_on: [ROOT_D]
	};

	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
	console.log('wrote', manifestPath);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
