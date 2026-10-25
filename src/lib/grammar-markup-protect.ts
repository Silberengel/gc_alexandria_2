export type Range = { start: number; endExclusive: number };

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>"\]\\^`{}]+/gi;
const WSS_URL_REGEX = /wss:\/\/[^\s<>"\]\\^`{}]+/gi;
const HASHTAG_REGEX = /#[\p{L}\p{N}_-]+/gu;
const NOSTR_REF_REGEX =
  /(?:nostr:)?n(?:pub|profile|addr|event|ote)1[02-9ac-hj-np-z]+/gi;

export function protectedRanges(text: string): Range[] {
  if (!text) return [];
  let merged: Range[] = [];
  merged = mergeRanges(merged, collectFencedCode(text));
  merged = mergeRanges(merged, collectInlineCode(text, merged));
  merged = mergeRanges(merged, collectMarkdownLinks(text, merged));
  merged = mergeRanges(merged, collectUrls(text, merged));
  merged = mergeRanges(merged, collectNostrReferences(text, merged));
  merged = mergeRanges(merged, collectHashtags(text, merged));
  return mergeRanges(merged, collectEmphasisDelimiters(text, merged));
}

export function intersects(offset: number, length: number, ranges: Range[]): boolean {
  if (length <= 0) return false;
  const end = offset + length;
  return ranges.some((r) => offset < r.endExclusive && end > r.start);
}

function mergeRanges(existing: Range[], added: Range[]): Range[] {
  if (!added.length) return existing;
  return mergeSorted([...existing, ...added]);
}

function mergeSorted(ranges: Range[]): Range[] {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort(
    (a, b) => a.start - b.start || a.endExclusive - b.endExclusive,
  );
  const out: Range[] = [];
  let current = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (next.start <= current.endExclusive) {
      current = {
        start: current.start,
        endExclusive: Math.max(current.endExclusive, next.endExclusive),
      };
    } else {
      out.push(current);
      current = next;
    }
  }
  out.push(current);
  return out;
}

function posInMerged(pos: number, merged: Range[]): boolean {
  return merged.some((r) => pos >= r.start && pos < r.endExclusive);
}

function rangeInMerged(start: number, endExclusive: number, merged: Range[]): boolean {
  for (let p = start; p < endExclusive; p++) {
    if (posInMerged(p, merged)) return true;
  }
  return false;
}

function collectFencedCode(text: string): Range[] {
  const ranges: Range[] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const open = text.indexOf('```', searchFrom);
    if (open < 0) break;
    const close = text.indexOf('```', open + 3);
    if (close < 0) break;
    ranges.push({ start: open, endExclusive: close + 3 });
    searchFrom = close + 3;
  }
  return ranges;
}

function collectInlineCode(text: string, merged: Range[]): Range[] {
  const ranges: Range[] = [];
  let i = 0;
  while (i < text.length) {
    if (posInMerged(i, merged)) {
      i++;
      continue;
    }
    if (text[i] !== '`') {
      i++;
      continue;
    }
    let ticks = 0;
    let p = i;
    while (p < text.length && text[p] === '`') {
      ticks++;
      p++;
    }
    let q = p;
    let close = -1;
    while (q < text.length) {
      if (text[q] === '`') {
        let m = 0;
        let r = q;
        while (r < text.length && text[r] === '`') {
          m++;
          r++;
        }
        if (m >= ticks) {
          close = r;
          break;
        }
        q = r;
        continue;
      }
      q++;
    }
    if (close < 0) break;
    ranges.push({ start: i, endExclusive: close });
    i = close;
  }
  return ranges;
}

function collectMarkdownLinks(text: string, merged: Range[]): Range[] {
  const ranges: Range[] = [];
  let i = 0;
  while (i < text.length - 1) {
    if (posInMerged(i, merged)) {
      i++;
      continue;
    }
    const image = text.startsWith('![', i);
    const link = !image && text[i] === '[' && text[i + 1] !== '^';
    if (!image && !link) {
      i++;
      continue;
    }
    const labelStart = image ? i + 2 : i + 1;
    const labelEnd = findClosingBracket(text, labelStart);
    if (labelEnd < 0 || labelEnd + 1 >= text.length || text[labelEnd + 1] !== '(') {
      i++;
      continue;
    }
    const parenEnd = findClosingParen(text, labelEnd + 2);
    if (parenEnd < 0) {
      i++;
      continue;
    }
    ranges.push({ start: i, endExclusive: parenEnd });
    i = parenEnd;
  }
  return ranges;
}

function collectUrls(text: string, merged: Range[]): Range[] {
  const ranges: Range[] = [];
  for (const regex of [URL_REGEX, WSS_URL_REGEX]) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0;
      const end = start + trimUrlTrailingPunctuation(match[0]).length;
      if (!rangeInMerged(start, end, merged)) {
        ranges.push({ start, endExclusive: end });
      }
    }
  }
  return ranges;
}

function collectNostrReferences(text: string, merged: Range[]): Range[] {
  const ranges: Range[] = [];
  NOSTR_REF_REGEX.lastIndex = 0;
  for (const match of text.matchAll(NOSTR_REF_REGEX)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!rangeInMerged(start, end, merged)) {
      ranges.push({ start, endExclusive: end });
    }
  }
  return ranges;
}

function collectHashtags(text: string, merged: Range[]): Range[] {
  const ranges: Range[] = [];
  HASHTAG_REGEX.lastIndex = 0;
  for (const match of text.matchAll(HASHTAG_REGEX)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!rangeInMerged(start, end, merged)) {
      ranges.push({ start, endExclusive: end });
    }
  }
  return ranges;
}

function collectEmphasisDelimiters(text: string, merged: Range[]): Range[] {
  const ranges: Range[] = [];
  for (const token of ['**', '__', '~~']) {
    ranges.push(...collectDelimiterPairEdges(text, [...merged, ...ranges], token));
  }
  return ranges;
}

function collectDelimiterPairEdges(
  text: string,
  merged: Range[],
  token: string,
): Range[] {
  const ranges: Range[] = [];
  const tokenLen = token.length;
  if (tokenLen < 2) return ranges;
  let i = 0;
  while (i <= text.length - tokenLen * 2) {
    if (posInMerged(i, merged)) {
      i++;
      continue;
    }
    if (!text.startsWith(token, i)) {
      i++;
      continue;
    }
    let j = i + tokenLen;
    let closed = false;
    while (j <= text.length - tokenLen) {
      if (posInMerged(j, merged)) {
        j++;
        continue;
      }
      if (text.startsWith(token, j)) {
        ranges.push({ start: i, endExclusive: i + tokenLen });
        ranges.push({ start: j, endExclusive: j + tokenLen });
        i = j + tokenLen;
        closed = true;
        break;
      }
      j++;
    }
    if (!closed) i++;
  }
  return ranges;
}

function findClosingBracket(text: string, from: number): number {
  let j = from;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === ']') return j;
    j++;
  }
  return -1;
}

function findClosingParen(text: string, from: number): number {
  let depth = 1;
  let j = from;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return -1;
}

function trimUrlTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length && '.,;:!?)\\]\'"»'.includes(url.at(-1)!)) {
    url = url.slice(0, -1);
  }
  return url;
}
