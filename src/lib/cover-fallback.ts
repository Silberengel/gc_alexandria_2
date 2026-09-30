import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isRecipeArticle } from './recipe';
import { firstTag, tagValue } from './nostr/verify';

const GUTENBERG_PREFIX = /^pg\d+[-_.]*/i;

/** Signature oxblood (`--accent-strong` on antique) — medallion disc & cloth warmth. */
const OXBLOOD = '#713b32';
const OXBLOOD_DEEP = '#4a2420';

/**
 * Dark cloth + gold tooling — closer to classic fantasy covers than parchment panels.
 * ink = title/author light metal; gold = borders & knot stroke; oxblood in cloth mist.
 */
const BOOK_PALETTE = [
  { cloth: '#100c0b', clothLite: '#2a1814', ink: '#f0e6d8', gold: '#d4b88a', mist: OXBLOOD },
  { cloth: '#120c0a', clothLite: '#2c1a14', ink: '#f2e6d4', gold: '#d4b07a', mist: '#8a4a3c' },
  { cloth: '#0e1014', clothLite: '#1c2028', ink: '#e8eef4', gold: '#c4b090', mist: '#5a3838' },
  { cloth: '#140a10', clothLite: '#2a141c', ink: '#f0e4ea', gold: '#d0a898', mist: OXBLOOD },
  { cloth: '#100e0a', clothLite: '#241c14', ink: '#f0eadc', gold: '#c9b07a', mist: '#6a4034' },
  { cloth: '#12100c', clothLite: '#28241c', ink: '#f3ece1', gold: '#c9a874', mist: '#704438' }
] as const;

/** Cool parchment tones — bland document cards, distinct from tooled book covers. */
const WIKI_PALETTE = [
  { cloth: '#2a3a48', panel: '#e8eef3', ink: '#1a2830', gold: '#7a9eb0' },
  { cloth: '#243642', panel: '#e4ece8', ink: '#152028', gold: '#6a9a8c' },
  { cloth: '#2e3440', panel: '#eceaf2', ink: '#1c1e28', gold: '#8a8eb0' },
  { cloth: '#1f3a3a', panel: '#e6f0ee', ink: '#143028', gold: '#6aa89a' }
] as const;

/** Cool slate / blueprint plate — specs, not wiki parchment. */
const SPEC_PALETTE = [
  { cloth: '#0e1620', panel: '#1a2838', ink: '#e8f0f8', gold: '#6eb0d4', accent: '#3a7ca5' },
  { cloth: '#10141c', panel: '#1c2430', ink: '#e6eef6', gold: '#8aa8c8', accent: '#4a6a8a' },
  { cloth: '#0c1818', panel: '#162828', ink: '#e4f4f0', gold: '#6ab8a8', accent: '#3a8070' },
  { cloth: '#141018', panel: '#241c2c', ink: '#f0e8f4', gold: '#a898c8', accent: '#6a5890' }
] as const;

/** Magazine plate — cream stock + bold masthead, distinct from wiki parchment and spec slate. */
const ARTICLE_PALETTE = [
  { cloth: '#1a1210', panel: '#f4ebe0', ink: '#1c1410', masthead: '#9a3a2a', rule: '#c4a574' },
  { cloth: '#121618', panel: '#f0ece4', ink: '#14181c', masthead: '#2a4a5c', rule: '#8a9aa4' },
  { cloth: '#181410', panel: '#f6eedf', ink: '#1a120e', masthead: '#6a3a28', rule: '#b89868' },
  { cloth: '#141210', panel: '#efe8dc', ink: '#16120e', masthead: '#3a4828', rule: '#9a8a5c' }
] as const;

/** Turn a slug-like T / N / d value into display text. Already-spaced names are kept. */
export function humanizeTag(value: string): string {
  let s = value.trim();
  if (!s) return '';
  const stripped = s.replace(GUTENBERG_PREFIX, '');
  if (stripped) s = stripped;
  if (!/\s/.test(s) && /[-_.]/.test(s)) s = s.replace(/[-_.]+/g, ' ');
  return s.replace(/\S+/g, (word) => {
    if (/^\d+$/.test(word)) return word;
    if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word;
    if (word.length <= 2 && word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

/** Title-tag, else human T-tag, else human d-tag. */
export function coverTitle(event: Event): string {
  const title = firstTag(event, 'title')?.trim();
  if (title) return title;
  const t = firstTag(event, 'T')?.trim();
  if (t) return humanizeTag(t);
  const d = firstTag(event, 'd')?.trim();
  if (d) return humanizeTag(d);
  return 'Untitled';
}

/** Author-tag, else human N-tag. */
export function coverAuthor(event: Event): string {
  const authors = tagValue(event, 'author').map((a) => a.trim()).filter(Boolean);
  if (authors.length) return authors.slice(0, 2).join(', ');
  const names = tagValue(event, 'N').map((n) => humanizeTag(n)).filter(Boolean);
  return names.slice(0, 2).join(', ');
}

export function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || maxLines < 1) return [];
  const lines: string[] = [];
  let line = '';
  const flush = (): boolean => {
    if (!line || lines.length >= maxLines) return false;
    lines.push(line);
    line = '';
    return lines.length < maxLines;
  };
  for (const word of words) {
    const parts = word.length <= maxChars ? [word] : chunk(word, maxChars);
    for (const part of parts) {
      if (lines.length >= maxLines) break;
      if (!line) {
        line = part;
        continue;
      }
      if (`${line} ${part}`.length <= maxChars) line = `${line} ${part}`;
      else if (!flush()) break;
      else line = part;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const joined = lines.join(' ');
  if (joined.length < text.trim().length && lines.length) {
    const last = lines[lines.length - 1]!;
    if (!last.endsWith('…')) lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function chunk(word: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i += size) out.push(word.slice(i, i + size));
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type CoverPalette = {
  cloth: string;
  clothLite: string;
  ink: string;
  gold: string;
  mist: string;
};

type WikiPalette = {
  cloth: string;
  panel: string;
  ink: string;
  gold: string;
};

type SpecPalette = {
  cloth: string;
  panel: string;
  ink: string;
  gold: string;
  accent: string;
};

type ArticlePalette = {
  cloth: string;
  panel: string;
  ink: string;
  masthead: string;
  rule: string;
};

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) >>> 0;
  return h;
}

function bookPaletteFor(event: Event): CoverPalette {
  const key = firstTag(event, 'd') ?? event.id;
  return BOOK_PALETTE[hashKey(key) % BOOK_PALETTE.length]!;
}

function wikiPaletteFor(event: Event): WikiPalette {
  const key = firstTag(event, 'd') ?? event.id;
  return WIKI_PALETTE[hashKey(key) % WIKI_PALETTE.length]!;
}

function specPaletteFor(event: Event): SpecPalette {
  const key = firstTag(event, 'd') ?? event.id;
  return SPEC_PALETTE[hashKey(key) % SPEC_PALETTE.length]!;
}

function articlePaletteFor(event: Event): ArticlePalette {
  const key = firstTag(event, 'd') ?? event.id;
  return ARTICLE_PALETTE[hashKey(key) % ARTICLE_PALETTE.length]!;
}

/** Cookbook plate — cloth spine, cream board, saucepan. */
function recipeBookSvg(event: Event): string {
  const palettes = [
    { cloth: '#6e3428', spine: '#4a221c', panel: '#f7f1e6', ink: '#2a1812', accent: '#8f3d2c', gold: '#c4a574' },
    { cloth: '#3e4c34', spine: '#2a3424', panel: '#f4f0e4', ink: '#1c2418', accent: '#5c6e44', gold: '#c4b48a' },
    { cloth: '#7a422c', spine: '#542c1c', panel: '#f8f2e8', ink: '#2c1810', accent: '#a85a38', gold: '#d4b48a' },
    { cloth: '#5c3040', spine: '#3e2030', panel: '#f7f0ea', ink: '#2a141c', accent: '#8a4860', gold: '#d4b0a0' }
  ] as const;
  const key = firstTag(event, 'd') ?? event.id;
  const palette = palettes[hashKey(key) % palettes.length]!;
  const titleLines = wrapWords(coverTitle(event), 12, 4).map(escapeXml);
  const authorLines = wrapWords(coverAuthor(event), 16, 2).map(escapeXml);
  const titleSize = 17;
  const titleLineH = 21;
  const titleH = titleLines.length * titleLineH;
  const titleY = Math.max(128, 118 + (88 - titleH) / 2);
  const authorY = 248 - Math.max(0, authorLines.length - 1) * 15;

  const titleTs = titleLines
    .map(
      (line, i) =>
        `<text x="112" y="${titleY + i * titleLineH}" text-anchor="middle" font-size="${titleSize}" font-weight="700" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}">${line}</text>`
    )
    .join('');
  const authorTs = authorLines
    .map(
      (line, i) =>
        `<text x="112" y="${authorY + i * 15}" text-anchor="middle" font-size="12" font-style="italic" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}" fill-opacity="0.85">${line}</text>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice">
<rect width="200" height="300" fill="${palette.cloth}"/>
<rect width="22" height="300" fill="${palette.spine}"/>
<line x1="22" y1="0" x2="22" y2="300" stroke="${palette.gold}" stroke-width="1" stroke-opacity="0.45"/>
<rect x="34" y="16" width="150" height="268" rx="2" fill="${palette.panel}"/>
<rect x="34" y="16" width="150" height="268" rx="2" fill="none" stroke="${palette.gold}" stroke-width="1.4"/>
<rect x="42" y="24" width="134" height="252" fill="none" stroke="${palette.accent}" stroke-width="0.8" stroke-opacity="0.35"/>
<g id="recipe-pot" fill="none" stroke="${palette.accent}" stroke-linecap="round" stroke-linejoin="round">
  <path d="M86 78h52" stroke-width="2"/>
  <path d="M90 78v16c0 14 8 22 22 22s22-8 22-22V78" stroke-width="2.2"/>
  <path d="M134 88h16" stroke-width="2.4"/>
  <path d="M100 64c2-6 2-8 0-12" stroke-width="1.4"/>
  <path d="M112 62c2-5 2-7 0-11" stroke-width="1.4"/>
</g>
${titleTs}
${authorLines.length ? `<line x1="72" y1="${authorY - 14}" x2="152" y2="${authorY - 14}" stroke="${palette.accent}" stroke-width="1.2" stroke-opacity="0.45"/>` : ''}
${authorTs}
<text x="112" y="262" text-anchor="middle" font-size="11" font-family="ui-sans-serif,system-ui,sans-serif" letter-spacing="0.28em" fill="${palette.accent}">RECIPE</text>
</svg>`;
}

/** Warm parchment article card — large serif title. */
function wikiDocumentSvg(event: Event): string {
  const palette = wikiPaletteFor(event);
  const titleLines = wrapWords(coverTitle(event), 13, 6).map(escapeXml);
  const authorLines = wrapWords(coverAuthor(event), 16, 2).map(escapeXml);
  const titleSize = 19;
  const titleLineH = 24;
  const titleH = titleLines.length * titleLineH;
  const titleY = Math.max(92, 72 + (148 - titleH) / 2);
  const authorY = 252 - Math.max(0, authorLines.length - 1) * 16;

  const titleTs = titleLines
    .map(
      (line, i) =>
        `<text x="100" y="${titleY + i * titleLineH}" text-anchor="middle" font-size="${titleSize}" font-weight="700" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}">${line}</text>`
    )
    .join('');
  const authorTs = authorLines
    .map(
      (line, i) =>
        `<text x="100" y="${authorY + i * 16}" text-anchor="middle" font-size="13" font-style="italic" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}" fill-opacity="0.9">${line}</text>`
    )
    .join('');
  const rule = authorLines.length
    ? `<line x1="44" y1="${authorY - 18}" x2="156" y2="${authorY - 18}" stroke="${palette.gold}" stroke-width="1" stroke-opacity="0.8"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice">
<rect width="200" height="300" fill="${palette.cloth}"/>
<rect x="10" y="10" width="180" height="280" rx="3" fill="${palette.panel}" stroke="${palette.gold}" stroke-width="1.2"/>
<rect x="22" y="24" width="156" height="7" rx="2" fill="${palette.gold}" fill-opacity="0.35"/>
<rect x="22" y="38" width="118" height="5" rx="2" fill="${palette.gold}" fill-opacity="0.22"/>
<rect x="22" y="48" width="136" height="5" rx="2" fill="${palette.gold}" fill-opacity="0.18"/>
${titleTs}
${rule}
${authorTs}
<text x="100" y="274" text-anchor="middle" font-size="12" font-family="system-ui,sans-serif" letter-spacing="0.14em" fill="${palette.ink}" fill-opacity="0.55">WIKI</text>
</svg>`;
}

/** Slate blueprint plate — distinct from wiki parchment. */
function specDocumentSvg(event: Event): string {
  const palette = specPaletteFor(event);
  const titleLines = wrapWords(coverTitle(event), 14, 5).map(escapeXml);
  const authorLines = wrapWords(coverAuthor(event), 18, 2).map(escapeXml);
  const titleSize = 17;
  const titleLineH = 22;
  const titleH = titleLines.length * titleLineH;
  const titleY = Math.max(108, 96 + (120 - titleH) / 2);
  const authorY = 246 - Math.max(0, authorLines.length - 1) * 14;

  const titleTs = titleLines
    .map(
      (line, i) =>
        `<text x="100" y="${titleY + i * titleLineH}" text-anchor="middle" font-size="${titleSize}" font-weight="600" font-family="ui-sans-serif,system-ui,sans-serif" letter-spacing="0.02em" fill="${palette.ink}">${line}</text>`
    )
    .join('');
  const authorTs = authorLines
    .map(
      (line, i) =>
        `<text x="100" y="${authorY + i * 14}" text-anchor="middle" font-size="12" font-family="ui-sans-serif,system-ui,sans-serif" fill="${palette.ink}" fill-opacity="0.78">${line}</text>`
    )
    .join('');

  // Horizontal rule marks — blueprint / technical sheet feel.
  const rules = [0, 1, 2, 3, 4]
    .map((i) => {
      const y = 78 + i * 28;
      return `<line x1="28" y1="${y}" x2="172" y2="${y}" stroke="${palette.accent}" stroke-width="0.6" stroke-opacity="0.28"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice">
<rect width="200" height="300" fill="${palette.cloth}"/>
<rect x="8" y="8" width="184" height="284" fill="${palette.panel}" stroke="${palette.gold}" stroke-width="1.4"/>
<rect x="8" y="8" width="184" height="36" fill="${palette.accent}" fill-opacity="0.85"/>
<text x="100" y="32" text-anchor="middle" font-size="11" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif" letter-spacing="0.28em" fill="${palette.ink}">SPEC</text>
${rules}
${titleTs}
${authorLines.length ? `<line x1="52" y1="${authorY - 14}" x2="148" y2="${authorY - 14}" stroke="${palette.gold}" stroke-width="0.9" stroke-opacity="0.55"/>` : ''}
${authorTs}
<rect x="8" y="268" width="184" height="24" fill="${palette.cloth}" fill-opacity="0.55"/>
<text x="100" y="284" text-anchor="middle" font-size="10" font-family="ui-monospace,monospace" letter-spacing="0.08em" fill="${palette.gold}" fill-opacity="0.85">30817</text>
</svg>`;
}

/** Magazine article plate — bold masthead, large serif headline, fake body columns. */
function magazineArticleSvg(event: Event): string {
  const palette = articlePaletteFor(event);
  const titleLines = wrapWords(coverTitle(event), 14, 5).map(escapeXml);
  const authorLines = wrapWords(coverAuthor(event), 18, 2).map(escapeXml);
  const titleSize = titleLines.length > 3 ? 16 : 20;
  const titleLineH = titleLines.length > 3 ? 20 : 24;
  const titleH = titleLines.length * titleLineH;
  const titleY = Math.max(78, 68 + (110 - titleH) / 2);
  const authorY = 188 - Math.max(0, authorLines.length - 1) * 14;

  const titleTs = titleLines
    .map(
      (line, i) =>
        `<text x="22" y="${titleY + i * titleLineH}" text-anchor="start" font-size="${titleSize}" font-weight="700" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}">${line}</text>`
    )
    .join('');
  const authorTs = authorLines
    .map(
      (line, i) =>
        `<text x="22" y="${authorY + i * 14}" text-anchor="start" font-size="11" font-style="italic" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}" fill-opacity="0.78">${line}</text>`
    )
    .join('');

  // Two-column teaser lines under the fold — magazine layout cue.
  const bodyLines = [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const y = 210 + i * 10;
      const leftW = 70 + ((i * 17) % 18);
      const rightW = 62 + ((i * 13) % 22);
      return `<rect x="22" y="${y}" width="${leftW}" height="3.5" rx="1" fill="${palette.ink}" fill-opacity="0.12"/>
<rect x="108" y="${y}" width="${rightW}" height="3.5" rx="1" fill="${palette.ink}" fill-opacity="0.1"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice">
<rect width="200" height="300" fill="${palette.cloth}"/>
<rect x="8" y="8" width="184" height="284" fill="${palette.panel}"/>
<rect x="8" y="8" width="184" height="28" fill="${palette.masthead}"/>
<text x="22" y="27" text-anchor="start" font-size="10" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif" letter-spacing="0.32em" fill="#f8f0e8">ARTICLE</text>
<text x="178" y="27" text-anchor="end" font-size="9" font-family="ui-sans-serif,system-ui,sans-serif" letter-spacing="0.06em" fill="#f8f0e8" fill-opacity="0.75">30023</text>
<line x1="22" y1="48" x2="178" y2="48" stroke="${palette.rule}" stroke-width="1.2" stroke-opacity="0.85"/>
${titleTs}
${authorLines.length ? `<line x1="22" y1="${authorY - 12}" x2="90" y2="${authorY - 12}" stroke="${palette.masthead}" stroke-width="2" stroke-opacity="0.7"/>` : ''}
${authorTs}
<line x1="22" y1="198" x2="178" y2="198" stroke="${palette.rule}" stroke-width="0.8" stroke-opacity="0.55"/>
${bodyLines}
<rect x="8" y="278" width="184" height="14" fill="${palette.masthead}" fill-opacity="0.12"/>
</svg>`;
}

function coverDefs(palette: CoverPalette, id: string): string {
  return `<defs>
<linearGradient id="cloth-${id}" x1="0" y1="0" x2="0.35" y2="1">
  <stop offset="0%" stop-color="${palette.clothLite}"/>
  <stop offset="55%" stop-color="${palette.cloth}"/>
  <stop offset="100%" stop-color="${palette.cloth}"/>
</linearGradient>
<linearGradient id="metal-${id}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#fff8ec"/>
  <stop offset="40%" stop-color="${palette.ink}"/>
  <stop offset="100%" stop-color="${palette.gold}"/>
</linearGradient>
<radialGradient id="glow-${id}" cx="50%" cy="30%" r="40%">
  <stop offset="0%" stop-color="${OXBLOOD}" stop-opacity="0.28"/>
  <stop offset="55%" stop-color="${palette.gold}" stop-opacity="0.1"/>
  <stop offset="100%" stop-color="${palette.gold}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vignette-${id}" cx="50%" cy="45%" r="72%">
  <stop offset="50%" stop-color="#000" stop-opacity="0"/>
  <stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
</radialGradient>
<pattern id="grain-${id}" width="5" height="5" patternUnits="userSpaceOnUse">
  <circle cx="1" cy="1.5" r="0.4" fill="${palette.mist}" fill-opacity="0.16"/>
  <circle cx="3.5" cy="3.2" r="0.3" fill="#fff" fill-opacity="0.04"/>
</pattern>
</defs>`;
}

/** Ornate frame — double rule + corner filigree (fantasy-cover style). */
function ornateFrame(palette: CoverPalette): string {
  const g = palette.gold;
  return `<g fill="none" stroke="${g}" stroke-linecap="round" stroke-linejoin="round">
  <rect x="10" y="10" width="180" height="280" rx="2" stroke-width="1.2" stroke-opacity="0.9"/>
  <rect x="15" y="15" width="170" height="270" rx="1" stroke-width="0.55" stroke-opacity="0.45"/>
  <!-- corner flourishes -->
  <path d="M22 38 C22 26 26 22 38 22" stroke-width="1.1" stroke-opacity="0.85"/>
  <path d="M28 34 C28 28 30 26 36 26" stroke-width="0.7" stroke-opacity="0.55"/>
  <path d="M22 38 Q18 30 26 24" stroke-width="0.65" stroke-opacity="0.5"/>
  <path d="M178 38 C178 26 174 22 162 22" stroke-width="1.1" stroke-opacity="0.85"/>
  <path d="M172 34 C172 28 170 26 164 26" stroke-width="0.7" stroke-opacity="0.55"/>
  <path d="M178 38 Q182 30 174 24" stroke-width="0.65" stroke-opacity="0.5"/>
  <path d="M22 262 C22 274 26 278 38 278" stroke-width="1.1" stroke-opacity="0.85"/>
  <path d="M28 266 C28 272 30 274 36 274" stroke-width="0.7" stroke-opacity="0.55"/>
  <path d="M22 262 Q18 270 26 276" stroke-width="0.65" stroke-opacity="0.5"/>
  <path d="M178 262 C178 274 174 278 162 278" stroke-width="1.1" stroke-opacity="0.85"/>
  <path d="M172 266 C172 272 170 274 164 274" stroke-width="0.7" stroke-opacity="0.55"/>
  <path d="M178 262 Q182 270 174 276" stroke-width="0.65" stroke-opacity="0.5"/>
  <!-- side mid flourishes -->
  <path d="M18 140 C12 150 12 150 18 160" stroke-width="0.8" stroke-opacity="0.55"/>
  <path d="M182 140 C188 150 188 150 182 160" stroke-width="0.8" stroke-opacity="0.55"/>
</g>`;
}

/**
 * Oxblood disc with abstract Celtic knotwork (4-fold interlacing) — no scroll.
 * Pure stroke/fill paths so it renders inside SVG-as-<img>.
 */
function celticMedallion(cx: number, cy: number, scale: number, palette: CoverPalette): string {
  const g = palette.gold;
  // One lobe of a quatrefoil knot; rotated 0/90/180/270°.
  const lobe =
    'M0 -20 C6 -20 11 -16 12 -10 C13 -4 10 0 6 2 C2 4 0 6 0 10 C0 6 -2 4 -6 2 C-10 0 -13 -4 -12 -10 C-11 -16 -6 -20 0 -20 Z';
  const lobes = [0, 90, 180, 270]
    .map(
      (deg) =>
        `<path d="${lobe}" transform="rotate(${deg})" fill="none" stroke="${g}" stroke-width="1.35" stroke-linejoin="round"/>`
    )
    .join('');
  // Inner interlaced diamond ring (abstract endless-knot feel).
  const diamond =
    'M0 -10 L7 0 L0 10 L-7 0 Z M0 -6 L4 0 L0 6 L-4 0 Z';
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
  <circle cx="0" cy="0" r="32" fill="${OXBLOOD_DEEP}" fill-opacity="0.55"/>
  <circle cx="0" cy="0" r="28" fill="${OXBLOOD}"/>
  <circle cx="0" cy="0" r="28" fill="none" stroke="${g}" stroke-width="1.4" stroke-opacity="0.95"/>
  <circle cx="0" cy="0" r="25.2" fill="none" stroke="${g}" stroke-width="0.55" stroke-opacity="0.45"/>
  ${lobes}
  <path d="${diamond}" fill="none" stroke="${g}" stroke-width="1.1" stroke-linejoin="round" stroke-opacity="0.9"/>
  <circle cx="0" cy="0" r="3.2" fill="${g}" fill-opacity="0.85"/>
  <circle cx="0" cy="0" r="1.4" fill="${OXBLOOD_DEEP}"/>
</g>`;
}

const EMBLEM_PALETTE: CoverPalette = {
  cloth: '#100c0b',
  clothLite: '#2a1814',
  ink: '#f0e6d8',
  gold: '#d4b88a',
  mist: OXBLOOD
};

/** Standalone oxblood Celtic mark for reader headers (no full book plate). */
export function celticEmblemUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${celticMedallion(32, 32, 1, EMBLEM_PALETTE)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function titleBlock(
  titleLines: string[],
  authorLines: string[],
  palette: CoverPalette,
  opts: { titleStartY: number; authorY: number; gradId: string; kindLabel?: string }
): string {
  const lineH = 24;
  const fontSize = 19;
  // Dark halo first so light metal stays legible on dark cloth.
  const titleShadow = titleLines
    .map(
      (line, i) =>
        `<text x="100" y="${opts.titleStartY + i * lineH}" text-anchor="middle" font-size="${fontSize}" font-weight="700" font-family="Georgia,'Times New Roman',serif" letter-spacing="0.01em" fill="#000" fill-opacity="0.55">${line}</text>`
    )
    .join('');
  const titleInk = titleLines
    .map(
      (line, i) =>
        `<text x="100" y="${opts.titleStartY + i * lineH - 0.7}" text-anchor="middle" font-size="${fontSize}" font-weight="700" font-family="Georgia,'Times New Roman',serif" letter-spacing="0.01em" fill="url(#metal-${opts.gradId})">${line}</text>`
    )
    .join('');
  const authorTs = authorLines
    .map(
      (line, i) =>
        `<text x="100" y="${opts.authorY + i * 14}" text-anchor="middle" font-size="11.5" font-style="italic" font-family="Georgia,'Times New Roman',serif" letter-spacing="0.03em" fill="${palette.ink}" fill-opacity="0.9">${line}</text>`
    )
    .join('');
  const ruleY = authorLines.length ? opts.authorY - 14 : opts.titleStartY + titleLines.length * lineH + 8;
  const rule = `<g fill="none" stroke="${palette.gold}" stroke-width="0.85" stroke-opacity="0.85">
  <line x1="48" y1="${ruleY}" x2="86" y2="${ruleY}"/>
  <line x1="114" y1="${ruleY}" x2="152" y2="${ruleY}"/>
  <path d="M100 ${ruleY - 3.5} L103.5 ${ruleY} L100 ${ruleY + 3.5} L96.5 ${ruleY} Z" fill="${palette.gold}" fill-opacity="0.9" stroke="none"/>
</g>`;
  const kind = opts.kindLabel
    ? `<text x="100" y="272" text-anchor="middle" font-size="9.5" font-family="system-ui,sans-serif" letter-spacing="0.18em" fill="${palette.gold}" fill-opacity="0.7">${opts.kindLabel}</text>`
    : '';
  return `<g transform="translate(0.8 0.9)">${titleShadow}</g>${titleInk}${rule}${authorTs}${kind}`;
}

export function coverPlaceholderSvg(event: Event): string {
  if (event.kind === KIND.SPEC) return specDocumentSvg(event);
  if (event.kind === KIND.WIKI) return wikiDocumentSvg(event);
  if (event.kind === KIND.LONG_FORM) {
    return isRecipeArticle(event) ? recipeBookSvg(event) : magazineArticleSvg(event);
  }

  const palette = bookPaletteFor(event);
  const id = (firstTag(event, 'd') ?? event.id).slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, 'x');
  const titleLines = wrapWords(coverTitle(event), 13, 4).map(escapeXml);
  const authorLines = wrapWords(coverAuthor(event), 20, 2).map(escapeXml);
  const titleStartY = 148;
  const authorY = 252 - Math.max(0, authorLines.length - 1) * 12;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice">
${coverDefs(palette, id)}
<rect width="200" height="300" fill="url(#cloth-${id})"/>
<rect width="200" height="300" fill="url(#grain-${id})"/>
<rect width="200" height="300" fill="url(#glow-${id})"/>
${ornateFrame(palette)}
${celticMedallion(100, 78, 1.15, palette)}
${titleBlock(titleLines, authorLines, palette, { titleStartY, authorY, gradId: id })}
<rect width="200" height="300" fill="url(#vignette-${id})" pointer-events="none"/>
</svg>`;
}

export function coverPlaceholderUrl(event: Event): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverPlaceholderSvg(event))}`;
}
