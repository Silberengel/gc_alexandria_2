import type { Event } from 'nostr-tools';
import { firstTag, tagValue } from './nostr/verify';

const GUTENBERG_PREFIX = /^pg\d+[-_.]*/i;

const PALETTE = [
  { cloth: '#3c352c', panel: '#efe6dc', ink: '#2a241c', gold: '#c6a885' },
  { cloth: '#4a3020', panel: '#f3e6d4', ink: '#2a1c12', gold: '#d0ae7a' },
  { cloth: '#2f3c34', panel: '#e8efe6', ink: '#1c2a22', gold: '#a3c4ad' },
  { cloth: '#2c3640', panel: '#e6edf2', ink: '#1c242c', gold: '#8fb4c8' },
  { cloth: '#402c34', panel: '#f2e6ea', ink: '#2a1c22', gold: '#c89aab' },
  { cloth: '#3a3328', panel: '#efe4cf', ink: '#261c10', gold: '#c4a066' }
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

function paletteFor(event: Event): (typeof PALETTE)[number] {
  const key = firstTag(event, 'd') ?? event.id;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function coverPlaceholderSvg(event: Event): string {
  const palette = paletteFor(event);
  const titleLines = wrapWords(coverTitle(event), 16, 7).map(escapeXml);
  const authorLines = wrapWords(coverAuthor(event), 18, 3).map(escapeXml);
  const titleH = titleLines.length * 22;
  const titleY = Math.max(86, 70 + (150 - titleH) / 2);
  const authorY = 272 - Math.max(0, authorLines.length - 1) * 15;

  const titleTs = titleLines
    .map(
      (line, i) =>
        `<text x="114" y="${titleY + i * 22}" text-anchor="middle" font-size="15" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}">${line}</text>`
    )
    .join('');
  const authorTs = authorLines
    .map(
      (line, i) =>
        `<text x="114" y="${authorY + i * 15}" text-anchor="middle" font-size="11" font-style="italic" font-family="Georgia,'Times New Roman',serif" fill="${palette.ink}" fill-opacity="0.88">${line}</text>`
    )
    .join('');
  const ruleY = authorLines.length ? authorY - 16 : 0;
  const rule = authorLines.length
    ? `<line x1="62" y1="${ruleY}" x2="166" y2="${ruleY}" stroke="${palette.gold}" stroke-width="0.8" stroke-opacity="0.75"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="200" height="300">
<rect width="200" height="300" fill="${palette.cloth}"/>
<rect width="16" height="300" fill="#000" fill-opacity="0.28"/>
<rect x="24" y="16" width="158" height="268" fill="none" stroke="${palette.gold}" stroke-width="1.6" stroke-opacity="0.9"/>
<rect x="30" y="22" width="146" height="256" fill="${palette.panel}"/>
<line x1="50" y1="64" x2="156" y2="64" stroke="${palette.gold}" stroke-width="1"/>
${titleTs}
${rule}
${authorTs}
</svg>`;
}

export function coverPlaceholderUrl(event: Event): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverPlaceholderSvg(event))}`;
}
