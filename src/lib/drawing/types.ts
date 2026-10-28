/** Hand-draw stroke model (Amethyst-compatible GIF export). */

export type DrawTool =
  | 'brush'
  | 'pencil'
  | 'spray'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'text';

export const FREEHAND_TOOLS: readonly DrawTool[] = [
  'brush',
  'pencil',
  'spray',
  'highlighter',
  'eraser'
];

/** Default tip size when switching to highlighter. */
export const DEFAULT_HIGHLIGHTER_SIZE = 16;
export const SHAPE_TOOLS: readonly DrawTool[] = ['line', 'rect', 'ellipse'];
export const LABEL_TOOLS: readonly DrawTool[] = ['text'];

export function isShapeTool(tool: DrawTool): boolean {
  return tool === 'line' || tool === 'rect' || tool === 'ellipse';
}

export function isTextTool(tool: DrawTool): boolean {
  return tool === 'text';
}

/** Fonts available for text labels (canvas + GIF). */
export type DrawFontId =
  | 'sans'
  | 'serif'
  | 'display'
  | 'italic'
  | 'hand'
  | 'cursive'
  | 'comic'
  | 'mono'
  | 'rounded'
  | 'condensed'
  | 'system';

export type DrawFontDef = {
  id: DrawFontId;
  label: string;
  /** CSS font-family stack for canvas fillText / picker preview. */
  family: string;
  style?: 'normal' | 'italic';
  weight?: 'normal' | 'bold' | number;
};

export const DRAW_FONTS: readonly DrawFontDef[] = [
  {
    id: 'sans',
    label: 'Sans',
    family: '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif'
  },
  {
    id: 'serif',
    label: 'Serif',
    family: 'Literata, Georgia, "Times New Roman", serif'
  },
  {
    id: 'display',
    label: 'Display',
    family: 'Georgia, "Palatino Linotype", Palatino, serif',
    weight: 'bold'
  },
  {
    id: 'italic',
    label: 'Italic',
    family: 'Literata, Georgia, "Times New Roman", serif',
    style: 'italic'
  },
  {
    id: 'hand',
    label: 'Hand',
    family: 'Caveat, "Segoe Script", "Apple Chancery", cursive'
  },
  {
    id: 'cursive',
    label: 'Cursive',
    family: '"Segoe Script", "Apple Chancery", "Brush Script MT", "Snell Roundhand", cursive',
    style: 'italic'
  },
  {
    id: 'comic',
    label: 'Comic Sans',
    family: '"Comic Sans MS", "Comic Sans", Chalkboard, "Comic Neue", cursive'
  },
  {
    id: 'mono',
    label: 'Mono',
    family: '"Courier New", Courier, ui-monospace, monospace'
  },
  {
    id: 'rounded',
    label: 'Rounded',
    family: 'ui-rounded, "Trebuchet MS", "Segoe UI", sans-serif'
  },
  {
    id: 'condensed',
    label: 'Condensed',
    family: '"Arial Narrow", "Helvetica Condensed", Impact, sans-serif',
    weight: 'bold'
  },
  {
    id: 'system',
    label: 'System',
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  }
] as const;

export function drawFontById(id: string): DrawFontDef {
  return DRAW_FONTS.find((f) => f.id === id) ?? DRAW_FONTS[0]!;
}

/** Build a canvas `ctx.font` string for a label at `sizePx`. */
export function canvasFontString(sizePx: number, font: DrawFontDef): string {
  const style = font.style === 'italic' ? 'italic' : 'normal';
  const weight = font.weight ?? 'normal';
  return `${style} ${weight} ${Math.max(1, Math.round(sizePx))}px ${font.family}`;
}

/** Default font size when switching to the text tool. */
export const DEFAULT_TEXT_SIZE = 32;

export type DrawPoint = {
  x: number;
  y: number;
  /** 0..1 when the pointer reports pressure; otherwise 0.5. */
  pressure: number;
};

export type DrawStroke = {
  tool: DrawTool;
  color: string;
  /** Brush width, or font size when tool === 'text'. */
  width: number;
  points: DrawPoint[];
  /** Deterministic spray seed (tool === 'spray'). */
  seed: number;
  /** Label content when tool === 'text'. */
  text?: string;
  /** Font stack when tool === 'text'. */
  fontFamily?: string;
  /** Canvas font-style when tool === 'text'. */
  fontStyle?: 'normal' | 'italic';
  /** Canvas font-weight when tool === 'text'. */
  fontWeight?: 'normal' | 'bold' | number;
};

export type PaperId = 'parchment' | 'lined' | 'grid' | 'dots' | 'chalkboard' | 'sticky';

export type PaperDef = {
  id: PaperId;
  label: string;
  background: string;
  /** Optional overlay drawn after the fill (lines, dots). */
  pattern: 'none' | 'lined' | 'grid' | 'dots';
  patternColor: string;
  /** Default ink when switching to this paper. */
  defaultInk: string;
};

export const INK_PALETTE = [
  '#1a1a1a',
  '#8b1a1a',
  '#1a3d7a',
  '#1a5c3a',
  '#6b3fa0',
  '#b85c00',
  '#c4a035',
  '#f5f0e6',
  /** Bright highlighter tips (read well with multiply blend). */
  '#ffe566',
  '#ff7eb3',
  '#7afcff',
  '#b8f27a'
] as const;

export const DEFAULT_HIGHLIGHTER_COLOR = '#ffe566';

export const DEFAULT_DRAW_SIZE = { width: 540, height: 675 } as const;
