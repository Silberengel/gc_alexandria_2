import type { PaperDef } from './types';

export const PAPERS: readonly PaperDef[] = [
  {
    id: 'parchment',
    label: 'Parchment',
    background: '#f3ead7',
    pattern: 'none',
    patternColor: 'transparent',
    defaultInk: '#1a1a1a'
  },
  {
    id: 'lined',
    label: 'Lined',
    background: '#f7f3ea',
    pattern: 'lined',
    patternColor: 'rgba(90, 120, 160, 0.35)',
    defaultInk: '#1a3d7a'
  },
  {
    id: 'grid',
    label: 'Grid',
    background: '#f5f2eb',
    pattern: 'grid',
    patternColor: 'rgba(60, 60, 60, 0.18)',
    defaultInk: '#1a1a1a'
  },
  {
    id: 'dots',
    label: 'Dots',
    background: '#f4efe6',
    pattern: 'dots',
    patternColor: 'rgba(50, 50, 50, 0.28)',
    defaultInk: '#1a1a1a'
  },
  {
    id: 'chalkboard',
    label: 'Chalkboard',
    background: '#2a3328',
    pattern: 'none',
    patternColor: 'transparent',
    defaultInk: '#f5f0e6'
  },
  {
    id: 'sticky',
    label: 'Sticky',
    background: '#fff3a0',
    pattern: 'none',
    patternColor: 'transparent',
    defaultInk: '#1a1a1a'
  }
] as const;

export function paperById(id: string): PaperDef {
  return PAPERS.find((p) => p.id === id) ?? PAPERS[0]!;
}
