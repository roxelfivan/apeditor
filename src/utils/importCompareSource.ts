/**
 * Read a comparison source (.md / .txt / .json backup / .docx) into
 * markdown text. DOCX conversion is lazy-loaded so mammoth stays out
 * of the initial app chunk.
 */

import {
  parseDocumentBackup,
  BACKUP_MAX_FILE_BYTES,
} from '@/utils/backup';

export const COMPARE_FILE_ACCEPT =
  '.md,.txt,.json,.docx,text/markdown,text/plain,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class CompareSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompareSourceError';
  }
}

export interface CompareSource {
  title: string;
  text: string;
  kind: 'markdown' | 'json' | 'docx';
}

function basename(name: string): string {
  return name.replace(/\.[^.]+$/, '') || name;
}

/** Enough HTML→markdown for compare: headings, paragraphs, lists. */
function htmlToMarkdownish(html: string): string {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_, n: string) => `${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function readCompareFile(file: File): Promise<CompareSource> {
  if (file.size > BACKUP_MAX_FILE_BYTES) {
    throw new CompareSourceError(
      `File is too large to compare (max ${Math.round(BACKUP_MAX_FILE_BYTES / (1024 * 1024))} MB).`
    );
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    return {
      title: basename(file.name),
      text: htmlToMarkdownish(result.value || ''),
      kind: 'docx',
    };
  }
  const raw = (await file.text()).replace(/\r\n/g, '\n');
  if (lower.endsWith('.json')) {
    try {
      const parsed = parseDocumentBackup(raw);
      return {
        title: parsed.document.title || basename(file.name),
        text: parsed.document.content,
        kind: 'json',
      };
    } catch {
      try {
        const obj = JSON.parse(raw) as { title?: unknown; content?: unknown };
        if (typeof obj?.content === 'string') {
          return {
            title:
              typeof obj.title === 'string' && obj.title.trim()
                ? obj.title
                : basename(file.name),
            text: obj.content,
            kind: 'json',
          };
        }
      } catch {
        /* fall through — treat as markdown text */
      }
    }
  }
  return {
    title: basename(file.name),
    text: raw,
    kind: 'markdown',
  };
}
