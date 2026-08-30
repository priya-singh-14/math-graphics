/**
 * Two colors. Hardcoded and mode-stable: the plates are ink on paper and do
 * not invert in dark mode. The surrounding chrome may theme; the plate never does.
 */
export const PALETTE = {
  paper: '#EFEDE4',
  ink: '#1A1A18',
  paperEdge: '#C9C6BB',
  label: '#8A867A',
  caption: '#5F5E5A',
} as const;

/** Parsed once — the reaction–diffusion renderer lerps per pixel. */
export const PAPER_RGB = [0xef, 0xed, 0xe4] as const;
export const INK_RGB = [0x1a, 0x1a, 0x18] as const;

export function inkAlpha(a: number): string {
  return `rgba(26, 26, 24, ${a})`;
}

export function paperAlpha(a: number): string {
  return `rgba(239, 237, 228, ${a})`;
}
