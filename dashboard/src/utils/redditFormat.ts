export type FormatCheckStatus =
  | 'MATCH'
  | 'PARA_MISMATCH'
  | 'TITLE_MISMATCH'
  | 'TEXT_MISMATCH'
  | 'FETCH_ERROR'
  | 'DELETED'
  | 'SKIPPED';

export interface FormatCheckDetail {
  expectedParas: number;
  actualParas: number;
  titleMatch: boolean;
  error?: string;
}

export function parseFormatDetail(detail?: string | null): FormatCheckDetail | null {
  if (!detail) return null;
  try {
    const d = JSON.parse(detail);
    if (typeof d.expectedParas !== 'number' || typeof d.actualParas !== 'number') return null;
    return { expectedParas: d.expectedParas, actualParas: d.actualParas, titleMatch: !!d.titleMatch, error: d.error };
  } catch {
    return null;
  }
}

export function splitParagraphs(s: string): string[] {
  return s
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function normalizeInline(s: string): string {
  let t = s.normalize('NFC');
  t = t
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/\u00a0/g, ' ');
  t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1');
  t = t.replace(/(\*\*|__|~~|`)/g, '');
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}
