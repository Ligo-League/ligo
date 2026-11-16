// The rulebook text for the Rules page. Read (never written) from docs/rules-season-4.md, the
// French draft, with Ligo's internal notes ("Statut", "Appliquée par") and the open questions
// removed, so it reads as the rulebook a league publishes. Returned as sections of blocks so
// each proposal renders its own long-form reading page without a Markdown library.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'h3'; id: string; text: string };

export interface RuleSection {
  id: string;
  number: string;
  title: string;
  blocks: Block[];
  subsections: { id: string; number: string; title: string }[];
}

const source = fileURLToPath(new URL('../../docs/rules-season-4.md', import.meta.url));

/** Inline Markdown to HTML: bold, italics, code. Input is our own file; still escaped first. */
export function inline(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

export function rulebook(): RuleSection[] {
  const text = readFileSync(source, 'utf8');
  const body = text.split(/\n## À trancher/)[0] as string;
  const sections: RuleSection[] = [];
  let current: RuleSection | null = null;
  let para: string[] = [];
  let list: string[] | null = null;
  let skipItem = false;
  const flush = () => {
    if (!current) return;
    if (para.length) current.blocks.push({ kind: 'p', text: inline(para.join(' ')) });
    if (list && list.length) current.blocks.push({ kind: 'ul', items: list.map(inline) });
    para = [];
    list = null;
  };
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const h2 = /^## (\d+)\. (.+)$/.exec(line);
    const h3 = /^### (\d+\.\d+) (.+)$/.exec(line);
    if (h2) {
      flush();
      current = { id: `art-${h2[1]}`, number: h2[1] as string, title: h2[2] as string, blocks: [], subsections: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (h3) {
      flush();
      const id = `art-${(h3[1] as string).replace('.', '-')}`;
      current.blocks.push({ kind: 'h3', id, text: `${h3[1]} ${h3[2]}` });
      current.subsections.push({ id, number: h3[1] as string, title: h3[2] as string });
      continue;
    }
    if (/^---/.test(line)) continue;
    const item = /^- (.*)$/.exec(line);
    if (item) {
      if (para.length) {
        current.blocks.push({ kind: 'p', text: inline(para.join(' ')) });
        para = [];
      }
      skipItem = /^\*\*(Statut|Appliquée par)\*\*/.test(item[1] as string);
      if (!skipItem) {
        if (list) list.push(item[1] as string);
        else list = [item[1] as string];
      }
      continue;
    }
    if (/^\s{2,}\S/.test(raw) && (list || skipItem)) {
      if (!skipItem && list) list[list.length - 1] += ' ' + line.trim();
      continue;
    }
    if (line.trim() === '') {
      if (list) {
        current.blocks.push({ kind: 'ul', items: (list as string[]).map(inline) });
        list = null;
      }
      if (para.length) {
        current.blocks.push({ kind: 'p', text: inline(para.join(' ')) });
        para = [];
      }
      skipItem = false;
      continue;
    }
    if (!skipItem) para.push(line.trim());
  }
  flush();
  // Ligo's own notes about phases do not belong in a published rulebook.
  for (const s of sections) {
    s.blocks = s.blocks
      .map((b) => (b.kind === 'ul' ? { ...b, items: b.items.filter((i) => !/phase \d|\bO-\d|\bM-\d/.test(i)) } : b))
      .filter((b) => (b.kind === 'ul' ? b.items.length > 0 : b.kind === 'p' ? !/phase \d|O-\d|M-\d/.test(b.text) : true));
  }
  return sections;
}
