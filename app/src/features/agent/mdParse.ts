/**
 * Minimal, safe Markdown parser for agent answers (no HTML passthrough, no dangerouslySetInnerHTML).
 * Supports: paragraphs, headings (#..###), bullet and numbered lists, block quotes, fenced code,
 * simple pipe tables, and inline **bold**, *italic* / _italic_, `code`, [links](https://...).
 * Anything else renders as plain text. Pure: unit-tested in node.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

/** Parses inline markup. Unmatched markers stay as literal text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#|-]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const marker = ch + ch;
      const end = src.indexOf(marker, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      // Single marker: must not be followed by a space (so "a * b" stays text); for '_' also not inside a word.
      const prevIsWord = i > 0 && /\w/.test(src[i - 1]);
      if (src[i + 1] && src[i + 1] !== ' ' && !(ch === '_' && prevIsWord)) {
        let end = i + 1;
        while ((end = src.indexOf(ch, end)) !== -1) {
          if (src[end + 1] !== ch && src[end - 1] !== ' ') break;
          end += src[end + 1] === ch ? 2 : 1;
        }
        if (end > i + 1) {
          flush();
          out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '[') {
      const close = src.indexOf('](', i + 1);
      const paren = close > 0 ? src.indexOf(')', close + 2) : -1;
      if (close > i && paren > close) {
        const href = src.slice(close + 2, paren).trim();
        if (SAFE_HREF.test(href)) {
          flush();
          out.push({ t: 'link', href, c: parseInline(src.slice(i + 1, close)) });
          i = paren + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Parses a Markdown document into blocks. */
export function parseMarkdown(src: string | null | undefined): Block[] {
  const lines = (src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ').trim()) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ t: 'code', v: code.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      blocks.push({ t: 'h', level: Math.min(3, h[1].length) as 1 | 2 | 3, c: parseInline(h[2].trim()) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara();
      const head = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]).map(parseInline));
      i--;
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if (UL.test(line) || OL.test(line)) {
      flushPara();
      const ordered = !UL.test(line);
      const re = ordered ? OL : UL;
      const items: Inline[][] = [];
      while (i < lines.length && re.test(lines[i])) {
        let text = re.exec(lines[i])![1];
        // Continuation lines (indented, not a new item) belong to the item.
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !UL.test(lines[i + 1]) && !OL.test(lines[i + 1])) text += ` ${lines[++i].trim()}`;
        items.push(parseInline(text.trim()));
        i++;
      }
      i--;
      blocks.push(ordered ? { t: 'ol', items } : { t: 'ul', items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      blocks.push({ t: 'quote', c: parseInline(q.join(' ').trim()) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** Plain text of inline nodes (for tests and accessible labels). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('');
}
