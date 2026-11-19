import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.ts';

// The rulebook is written in Markdown by staff and shown to everyone: whatever it holds, it must
// not run a script, load an outside resource, or break out of its own markup.

describe('renderMarkdown', () => {
  it('renders the usual Markdown: headings, lists, emphasis, tables', () => {
    const rendered = renderMarkdown(
      [
        '# Règlement',
        '',
        'Un **forfait** compte comme une *défaite*.',
        '',
        '- 3 points par victoire',
        '- 0 par défaite',
        '',
        '| Points | Victoire |',
        '| ------ | -------- |',
        '| PTS    | 3        |',
      ].join('\n'),
    );
    expect(rendered).toContain('<h1 id="reglement">Règlement</h1>');
    expect(rendered).toContain('<strong>forfait</strong>');
    expect(rendered).toContain('<em>défaite</em>');
    expect(rendered).toContain('<li>3 points par victoire</li>');
    expect(rendered).toContain('<table>');
  });

  it('gives each heading its own anchor, even when two read the same', () => {
    const rendered = renderMarkdown('## 4.1 Forfaits\n\n## 4.1 Forfaits\n\n## !!!');
    expect(rendered).toContain('<h2 id="4-1-forfaits">');
    expect(rendered).toContain('<h2 id="4-1-forfaits-2">');
    expect(rendered).toContain('<h2 id="section-3">');
  });

  it('shows raw HTML as text, in a block or inline', () => {
    const rendered = renderMarkdown(
      '<script>alert(1)</script>\n\nTexte <img src=x onerror="alert(1)"> et <b>gras</b>.',
    );
    expect(rendered).not.toMatch(/<script|<img|<b>/i);
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('keeps web, mail and in-page links, and drops any other kind', () => {
    const rendered = renderMarkdown(
      [
        '[BLAST](https://blast.tv/rules)',
        '[Écrire](mailto:staff@example.org)',
        '[Plus haut](#reglement)',
        '[Classement](/mlb-group/lfr/saison-3)',
        '[Piège](javascript:alert(1))',
        '[Piège 2](data:text/html,<script>alert(1)</script>)',
        '[Piège 3](//evil.example/x)',
      ].join('\n\n'),
    );
    expect(rendered).toContain(
      '<a href="https://blast.tv/rules" rel="nofollow noopener">BLAST</a>',
    );
    expect(rendered).toContain('href="mailto:staff@example.org"');
    expect(rendered).toContain('href="#reglement"');
    expect(rendered).toContain('href="/mlb-group/lfr/saison-3"');
    expect(rendered).not.toMatch(/javascript:|data:|evil\.example"/i);
    expect(rendered).toContain('Piège');
  });

  it('turns an image into a link, so nothing loads from elsewhere', () => {
    const rendered = renderMarkdown('![Le logo](https://evil.example/pixel.png)');
    expect(rendered).not.toContain('<img');
    expect(rendered).toContain(
      '<a href="https://evil.example/pixel.png" rel="nofollow noopener">Le logo</a>',
    );
  });

  it('cannot break out of a link with its title or its address', () => {
    const rendered = renderMarkdown(
      '[x](https://a.example "t\\" onmouseover=\\"alert(1)") [y](https://a.example/"onclick="alert(1))',
    );
    expect(rendered).not.toMatch(/ onmouseover="| onclick="/);
  });
});
