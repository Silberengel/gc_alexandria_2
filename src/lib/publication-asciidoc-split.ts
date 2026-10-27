/**
 * Split AsciiDoc into a NKBIP-01 publication tree (30040 indexes + 30041 sections).
 * Title lives in the compose title tag — a lone `=` document header is rejected.
 */
import { KIND } from './constants';
import { normalizeDTag } from './dtag';

/** Soft ceiling for each 30041 body (UTF-8 bytes). */
export const MAX_LEAF_BYTES = 50 * 1024;

/** Finest heading level that may become an index/section event (`==`…`====`). */
export type PublicationIndexDepth = 2 | 3 | 4;

export const DEFAULT_INDEX_DEPTH: PublicationIndexDepth = 2;

export type PublicationSplitNode = {
  /** Outline level: 0 = root, 2 = ==, 3 = ===, 4 = ==== */
  level: number;
  title: string;
  dTag: string;
  kind: number;
  /** AsciiDoc body for leaves; empty for indexes. */
  content: string;
  children: PublicationSplitNode[];
  /** Source line of the heading (1-based); 0 for synthetic root. */
  sourceLine: number;
  /** UTF-8 byte length of content (leaves). */
  contentBytes: number;
};

export type PublicationSplitWarning = {
  code:
    | 'document_title'
    | 'skipped_level'
    | 'empty_leaf'
    | 'oversize_leaf'
    | 'empty_source'
    | 'preamble_inserted';
  message: string;
  sourceLine?: number;
  title?: string;
};

export type PublicationSplitResult = {
  root: PublicationSplitNode;
  warnings: PublicationSplitWarning[];
  sectionCount: number;
  indexCount: number;
  oversizeLeaves: PublicationSplitNode[];
};

export type IdealSplitGhost = {
  parentKey: string;
  parentTitle: string;
  parentSourceLine: number;
  sections: { title: string; bytes: number }[];
};

export type IdealSplitReport = {
  splitTitles: string[];
  sectionsAdded: number;
  ghosts: IdealSplitGhost[];
};

export type IdealSplitApplyResult = {
  source: string;
  maxIndexLevel: PublicationIndexDepth;
  report: IdealSplitReport;
};

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Parse `== Title` … `====== Title` (not a lone `=`). */
export function parseAsciiDocHeading(
  line: string
): { level: number; title: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('=')) return null;
  let level = 0;
  let i = 0;
  while (i < trimmed.length && trimmed[i] === '=' && level < 6) {
    level += 1;
    i += 1;
  }
  if (level < 1 || level > 6) return null;
  // Require whitespace or end after the equals run (avoid `=====` art).
  if (i < trimmed.length && trimmed[i] !== ' ' && trimmed[i] !== '\t') return null;
  return { level, title: trimmed.slice(i).trim() };
}

function headingMarks(level: number): string {
  return '='.repeat(Math.max(1, Math.min(6, level)));
}

function clampIndexDepth(n: number): PublicationIndexDepth {
  if (n <= 2) return 2;
  if (n >= 4) return 4;
  return 3;
}

/**
 * Fold headings deeper than maxIndexLevel into the parent body as discrete headings.
 * Returns rewritten source lines (no parse yet).
 */
export function foldDeepHeadingsToDiscrete(
  source: string,
  maxIndexLevel: PublicationIndexDepth
): { text: string; hadDocumentTitle: boolean; documentTitleLine?: number } {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let hadDocumentTitle = false;
  let documentTitleLine: number | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const h = parseAsciiDocHeading(line);
    if (!h) {
      out.push(line);
      continue;
    }
    if (h.level === 1) {
      hadDocumentTitle = true;
      documentTitleLine = i + 1;
      // Drop the forbidden document title from the body; title tag owns it.
      continue;
    }
    if (h.level > maxIndexLevel) {
      // Avoid double [discrete] if already present on previous line.
      const prev = out[out.length - 1]?.trim();
      if (prev !== '[discrete]') out.push('[discrete]');
      out.push(line);
      continue;
    }
    out.push(line);
  }

  return {
    text: out.join('\n'),
    hadDocumentTitle,
    documentTitleLine
  };
}

function emptyRoot(title: string, dTag: string): PublicationSplitNode {
  return {
    level: 0,
    title: title || 'Untitled',
    dTag: dTag || 'untitled',
    kind: KIND.PUBLICATION,
    content: '',
    children: [],
    sourceLine: 0,
    contentBytes: 0
  };
}

function assignHierarchicalDTags(root: PublicationSplitNode, rootD: string): void {
  root.dTag = rootD || normalizeDTag(root.title) || 'untitled';

  function walk(parent: PublicationSplitNode, parentTag: string): void {
    const segmentCounts = new Map<string, number>();
    for (const child of parent.children) {
      const segment = normalizeDTag(child.title) || 'untitled';
      const seen = segmentCounts.get(segment) ?? 0;
      segmentCounts.set(segment, seen + 1);
      child.dTag =
        seen === 0 ? `${parentTag}-${segment}` : `${parentTag}-${segment}-${seen + 1}`;
      walk(child, child.dTag);
    }
  }

  walk(root, root.dTag);
}

/**
 * Scriptorium-style rescue: body text under a heading that also has child headings
 * becomes a first child “Preamble” section so nothing is dropped when the parent
 * turns into an empty 30040 index.
 */
function promoteOrphanContentToPreamble(
  node: PublicationSplitNode,
  warnings: PublicationSplitWarning[],
  maxIndexLevel: PublicationIndexDepth
): void {
  for (const child of node.children) {
    promoteOrphanContentToPreamble(child, warnings, maxIndexLevel);
  }

  const orphan = node.content.replace(/^\n+/, '').replace(/\n+$/, '').trim();
  if (!orphan) {
    node.content = '';
    return;
  }

  if (node.children.length === 0) {
    // Leaf keeps its body.
    return;
  }

  const childLevel =
    node.level === 0 ? 2 : Math.min(node.level + 1, maxIndexLevel);
  const preamble: PublicationSplitNode = {
    level: childLevel,
    title: 'Preamble',
    dTag: '',
    kind: KIND.SECTION,
    content: orphan,
    children: [],
    sourceLine: node.sourceLine,
    contentBytes: utf8Bytes(orphan)
  };
  node.children.unshift(preamble);
  node.content = '';
  warnings.push({
    code: 'preamble_inserted',
    message:
      node.level === 0
        ? 'Moved text before the first == heading into a “Preamble” section.'
        : `Moved intro text under “${node.title}” into a “Preamble” subsection so it is not lost.`,
    sourceLine: node.sourceLine,
    title: node.title
  });
}

function markLeafOrIndex(node: PublicationSplitNode): void {
  for (const child of node.children) markLeafOrIndex(child);
  if (node.level === 0) {
    node.kind = KIND.PUBLICATION;
    node.content = '';
    node.contentBytes = 0;
    return;
  }
  if (node.children.length === 0) {
    node.kind = KIND.SECTION;
    node.contentBytes = utf8Bytes(node.content);
  } else {
    node.kind = KIND.PUBLICATION;
    node.content = '';
    node.contentBytes = 0;
  }
}

function countNodes(node: PublicationSplitNode): { sections: number; indexes: number } {
  let sections = 0;
  let indexes = 0;
  if (node.level > 0) {
    if (node.kind === KIND.SECTION) sections += 1;
    else indexes += 1;
  }
  for (const c of node.children) {
    const n = countNodes(c);
    sections += n.sections;
    indexes += n.indexes;
  }
  return { sections, indexes };
}

function collectOversize(node: PublicationSplitNode, out: PublicationSplitNode[]): void {
  if (node.kind === KIND.SECTION && node.contentBytes > MAX_LEAF_BYTES) out.push(node);
  for (const c of node.children) collectOversize(c, out);
}

function detectSkippedLevels(
  lines: string[],
  maxIndexLevel: PublicationIndexDepth
): PublicationSplitWarning[] {
  const warnings: PublicationSplitWarning[] = [];
  const stack: number[] = [0];
  for (let i = 0; i < lines.length; i += 1) {
    const h = parseAsciiDocHeading(lines[i]!);
    if (!h || h.level === 1 || h.level > maxIndexLevel) continue;
    const parent = stack[stack.length - 1] ?? 0;
    if (h.level > parent + 1 && parent > 0) {
      warnings.push({
        code: 'skipped_level',
        message: `Heading level skips from ${'='.repeat(parent)} to ${'='.repeat(h.level)} (“${h.title}”).`,
        sourceLine: i + 1,
        title: h.title
      });
    }
    while (stack.length > 1 && (stack[stack.length - 1] ?? 0) >= h.level) stack.pop();
    stack.push(h.level);
  }
  return warnings;
}

/**
 * Parse AsciiDoc (no `=` title required) into a publication tree.
 * Walks the original source so `sourceLine` matches the editor buffer
 * (deep headings are folded to discrete in-content; `=` titles are skipped).
 */
export function parsePublicationAsciiDoc(
  source: string,
  opts: {
    rootTitle: string;
    rootDTag?: string;
    maxIndexLevel?: PublicationIndexDepth;
  }
): PublicationSplitResult {
  const maxIndexLevel = clampIndexDepth(opts.maxIndexLevel ?? DEFAULT_INDEX_DEPTH);
  const warnings: PublicationSplitWarning[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (!source.trim()) {
    warnings.push({ code: 'empty_source', message: 'AsciiDoc source is empty.' });
  }
  warnings.push(...detectSkippedLevels(lines, maxIndexLevel));

  const rootD = (opts.rootDTag?.trim() || normalizeDTag(opts.rootTitle) || 'untitled').trim();
  const root = emptyRoot(opts.rootTitle.trim() || 'Untitled', rootD);

  type StackNode = PublicationSplitNode;
  const stack: StackNode[] = [root];
  let currentContent: string[] = [];

  const flushContent = () => {
    if (!currentContent.length) return;
    const top = stack[stack.length - 1]!;
    const joined = currentContent.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (joined.trim()) {
      top.content = top.content ? `${top.content}\n${joined}` : joined;
    }
    currentContent = [];
  };

  const pushDiscreteHeading = (line: string) => {
    const prev = currentContent[currentContent.length - 1]?.trim();
    if (prev !== '[discrete]') currentContent.push('[discrete]');
    currentContent.push(line);
  };

  let sawDocumentTitle = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const h = parseAsciiDocHeading(line);
    if (h?.level === 1) {
      if (!sawDocumentTitle) {
        sawDocumentTitle = true;
        warnings.push({
          code: 'document_title',
          message:
            'Remove the “= Document title” line — set the Title field instead. Chapters start with ==.',
          sourceLine: i + 1
        });
      }
      continue;
    }
    if (h && h.level > maxIndexLevel) {
      pushDiscreteHeading(line);
      continue;
    }
    if (h && h.level >= 2 && h.level <= maxIndexLevel) {
      flushContent();
      while (stack.length > 1 && stack[stack.length - 1]!.level >= h.level) stack.pop();
      const parent = stack[stack.length - 1]!;
      const node: PublicationSplitNode = {
        level: h.level,
        title: h.title || 'Untitled',
        dTag: '',
        kind: KIND.PUBLICATION,
        content: '',
        children: [],
        sourceLine: i + 1,
        contentBytes: 0
      };
      parent.children.push(node);
      stack.push(node);
      continue;
    }
    currentContent.push(line);
  }
  flushContent();

  // Rescue orphan body under indexes (and root) into a leading “Preamble” child.
  promoteOrphanContentToPreamble(root, warnings, maxIndexLevel);
  markLeafOrIndex(root);
  assignHierarchicalDTags(root, rootD);

  // Empty leaf warnings
  function walkEmpty(n: PublicationSplitNode): void {
    if (n.kind === KIND.SECTION && !n.content.trim()) {
      warnings.push({
        code: 'empty_leaf',
        message: `Section “${n.title}” has no body.`,
        sourceLine: n.sourceLine,
        title: n.title
      });
    }
    for (const c of n.children) walkEmpty(c);
  }
  walkEmpty(root);

  const oversizeLeaves: PublicationSplitNode[] = [];
  collectOversize(root, oversizeLeaves);
  for (const leaf of oversizeLeaves) {
    warnings.push({
      code: 'oversize_leaf',
      message: `“${leaf.title}” is ${(leaf.contentBytes / 1024).toFixed(1)} KiB (limit 50 KiB). Apply ideal split.`,
      sourceLine: leaf.sourceLine,
      title: leaf.title
    });
  }

  const counts = countNodes(root);
  return {
    root,
    warnings,
    sectionCount: counts.sections,
    indexCount: counts.indexes,
    oversizeLeaves
  };
}

/** Pack paragraphs into chunks each ≤ maxBytes. */
export function packParagraphsToLimit(body: string, maxBytes = MAX_LEAF_BYTES): string[] {
  const trimmed = body.replace(/^\n+/, '').replace(/\n+$/, '');
  if (!trimmed) return [''];
  if (utf8Bytes(trimmed) <= maxBytes) return [trimmed];

  const paras = trimmed.split(/\n\s*\n/);
  const parts: string[] = [];
  let cur = '';

  const pushCur = () => {
    if (cur) parts.push(cur);
    cur = '';
  };

  const hardSplit = (text: string) => {
    let rest = text;
    while (utf8Bytes(rest) > maxBytes) {
      const bytes = new TextEncoder().encode(rest);
      // Walk back to a space near the limit when possible.
      let cut = maxBytes;
      const slice = bytes.slice(0, cut);
      let decoded = new TextDecoder().decode(slice);
      const sp = decoded.lastIndexOf(' ');
      if (sp > maxBytes * 0.5) decoded = decoded.slice(0, sp);
      parts.push(decoded);
      rest = rest.slice(decoded.length).replace(/^\s+/, '');
    }
    if (rest) {
      if (cur) {
        const cand = `${cur}\n\n${rest}`;
        if (utf8Bytes(cand) <= maxBytes) cur = cand;
        else {
          pushCur();
          cur = rest;
        }
      } else cur = rest;
    }
  };

  for (const p of paras) {
    const para = p.trimEnd();
    if (!para.trim()) continue;
    const cand = cur ? `${cur}\n\n${para}` : para;
    if (utf8Bytes(cand) <= maxBytes) {
      cur = cand;
      continue;
    }
    if (cur) pushCur();
    if (utf8Bytes(para) <= maxBytes) cur = para;
    else hardSplit(para);
  }
  pushCur();
  return parts.length ? parts : [''];
}

function nodeKey(n: PublicationSplitNode): string {
  return `${n.sourceLine}:${n.dTag || n.title}`;
}

/** Preview Ideal split cuts without mutating source. */
export function previewIdealSplitGhosts(
  parsed: PublicationSplitResult,
  maxIndexLevel: PublicationIndexDepth = DEFAULT_INDEX_DEPTH
): IdealSplitGhost[] {
  const ghosts: IdealSplitGhost[] = [];
  for (const leaf of parsed.oversizeLeaves) {
    const parts = packParagraphsToLimit(leaf.content);
    if (parts.length <= 1 && utf8Bytes(parts[0] ?? '') <= MAX_LEAF_BYTES) continue;
    const childLevel = Math.min(leaf.level + 1, 4);
    // At max depth, siblings replace the leaf — still show as Section N under parent conceptually.
    void childLevel;
    void maxIndexLevel;
    ghosts.push({
      parentKey: nodeKey(leaf),
      parentTitle: leaf.title,
      parentSourceLine: leaf.sourceLine,
      sections: parts.map((p, i) => ({
        title: `Section ${i + 1}`,
        bytes: utf8Bytes(p)
      }))
    });
  }
  return ghosts;
}

/**
 * Serialize a parsed outline back to AsciiDoc (headings + bodies).
 * Used after structural rewrites.
 */
export function serializePublicationTree(root: PublicationSplitNode): string {
  const lines: string[] = [];

  function walk(node: PublicationSplitNode): void {
    if (node.level > 0) {
      lines.push(`${headingMarks(node.level)} ${node.title}`);
      if (node.children.length === 0 && node.content) {
        lines.push('');
        lines.push(node.content);
        lines.push('');
      } else if (node.children.length) {
        lines.push('');
      }
    }
    for (const c of node.children) walk(c);
  }

  walk(root);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Apply Ideal split: insert Section 1..N under oversized leaves (or sibling ==== at max depth).
 */
export function applyIdealPublicationSplit(
  source: string,
  opts: {
    rootTitle: string;
    rootDTag?: string;
    maxIndexLevel?: PublicationIndexDepth;
  }
): IdealSplitApplyResult {
  let maxIndexLevel = clampIndexDepth(opts.maxIndexLevel ?? DEFAULT_INDEX_DEPTH);
  const parsed = parsePublicationAsciiDoc(source, { ...opts, maxIndexLevel });
  const report: IdealSplitReport = { splitTitles: [], sectionsAdded: 0, ghosts: [] };

  if (!parsed.oversizeLeaves.length) {
    return { source, maxIndexLevel, report };
  }

  // Work on a mutable clone of the tree built from source, then serialize.
  // Re-parse after each batch is simpler and safer.
  let working = source;
  let depth = maxIndexLevel;

  // Process from deepest / later lines first so line offsets stay stable when rewriting via serialize.
  const round = parsePublicationAsciiDoc(working, {
    rootTitle: opts.rootTitle,
    rootDTag: opts.rootDTag,
    maxIndexLevel: depth
  });

  function splitLeafInTree(leaf: PublicationSplitNode, parent: PublicationSplitNode): void {
    const parts = packParagraphsToLimit(leaf.content);
    if (parts.length <= 1 && utf8Bytes(parts[0] ?? '') <= MAX_LEAF_BYTES) return;

    report.splitTitles.push(leaf.title);
    report.sectionsAdded += parts.length;

    if (leaf.level >= 4) {
      // Replace this leaf with sibling ==== Section N under the same parent.
      const idx = parent.children.indexOf(leaf);
      if (idx < 0) return;
      const replacements: PublicationSplitNode[] = parts.map((content, i) => ({
        level: 4,
        title: `Section ${i + 1}`,
        dTag: '',
        kind: KIND.SECTION,
        content,
        children: [],
        sourceLine: leaf.sourceLine,
        contentBytes: utf8Bytes(content)
      }));
      parent.children.splice(idx, 1, ...replacements);
      return;
    }

    const childLevel = (leaf.level + 1) as 3 | 4;
    if (childLevel > depth) depth = clampIndexDepth(childLevel);

    leaf.children = parts.map((content, i) => ({
      level: childLevel,
      title: `Section ${i + 1}`,
      dTag: '',
      kind: KIND.SECTION,
      content,
      children: [],
      sourceLine: leaf.sourceLine,
      contentBytes: utf8Bytes(content)
    }));
    leaf.content = '';
    leaf.contentBytes = 0;
    leaf.kind = KIND.PUBLICATION;
  }

  function walkSplit(node: PublicationSplitNode, parent: PublicationSplitNode | null): void {
    // Copy children list — we may mutate it.
    const kids = [...node.children];
    for (const child of kids) {
      if (
        child.kind === KIND.SECTION &&
        child.contentBytes > MAX_LEAF_BYTES &&
        child.children.length === 0
      ) {
        splitLeafInTree(child, node);
      } else {
        walkSplit(child, node);
      }
    }
    void parent;
  }

  walkSplit(round.root, null);
  markLeafOrIndex(round.root);
  assignHierarchicalDTags(
    round.root,
    opts.rootDTag?.trim() || normalizeDTag(opts.rootTitle) || 'untitled'
  );

  working = serializePublicationTree(round.root);
  maxIndexLevel = depth;

  // Ghosts after apply should be empty if successful; keep report from this pass.
  const after = parsePublicationAsciiDoc(working, {
    rootTitle: opts.rootTitle,
    rootDTag: opts.rootDTag,
    maxIndexLevel
  });
  report.ghosts = previewIdealSplitGhosts(after, maxIndexLevel);

  return { source: working, maxIndexLevel, report };
}

/** Flatten tree for bottom-up publish: all 30041s, then 30040s deepest-first, root last. */
export function flattenPublishOrder(root: PublicationSplitNode): PublicationSplitNode[] {
  const sections: PublicationSplitNode[] = [];
  const indexesByDepth: PublicationSplitNode[][] = [];

  function walk(node: PublicationSplitNode, depth: number): void {
    for (const c of node.children) walk(c, depth + 1);
    if (node.level === 0) return;
    if (node.kind === KIND.SECTION) sections.push(node);
    else {
      while (indexesByDepth.length <= depth) indexesByDepth.push([]);
      indexesByDepth[depth]!.push(node);
    }
  }

  walk(root, 0);
  const indexes: PublicationSplitNode[] = [];
  for (let d = indexesByDepth.length - 1; d >= 1; d -= 1) {
    indexes.push(...(indexesByDepth[d] ?? []));
  }
  return [...sections, ...indexes, root];
}

/** Stable path key for UI selection. */
export function publicationNodePath(node: PublicationSplitNode, ancestors: string[] = []): string {
  return [...ancestors, node.dTag || node.title].join('/');
}
