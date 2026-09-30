import { describe, it, expect } from 'vitest';
import {
  tokenizeComment, serializeComment, isSafeCommentUrl, buildCommentInline,
  commentVisibleLength, commentPreview,
} from './setup.js';

const inline = (str) => tokenizeComment(str)[0].inline.map(({ type, text, href }) =>
  (href !== undefined ? { type, text, href } : { type, text }));

describe('comment grammar — blocks', () => {
  it.each([
    ['plain text', 'paragraph', undefined],
    ['# Heading', 'heading', undefined],
    ['- bullet', 'bullet', undefined],
    ['* star bullet', 'bullet', undefined],
    ['- [ ] open item', 'check', false],
    ['- [x] done item', 'check', true],
  ])('%j is a %s', (line, type, checked) => {
    const [block] = tokenizeComment(line);
    expect(block.type).toBe(type);
    expect(block.checked).toBe(checked);
  });

  it.each([
    '#no space', '## two levels', '-no space', '*no space', '  - indented',
    '- [X] capital X', '- [ ]no space', '1. numbered', '> quote',
  ])('%j stays literal (paragraph or bullet text), never a new construct', (line) => {
    const [block] = tokenizeComment(line);
    expect(['paragraph', 'bullet']).toContain(block.type);
  });

  it('keeps source ranges for blocks and inline tokens', () => {
    const str = 'a\n- [x] **b** c';
    const [, second] = tokenizeComment(str);
    expect(str.slice(second.start, second.end)).toBe('- [x] **b** c');
    const bold = second.inline[0];
    expect(str.slice(bold.start, bold.end)).toBe('**b**');
    expect(str.slice(second.inline[1].start, second.inline[1].end)).toBe(' c');
  });
});

describe('comment grammar — inline', () => {
  it('bold, italic, link and autolink', () => {
    expect(inline('**b** *i* [t](https://a.cz) https://b.cz/x')).toEqual([
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'italic', text: 'i' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 't', href: 'https://a.cz' },
      { type: 'text', text: ' ' },
      { type: 'autolink', text: 'https://b.cz/x', href: 'https://b.cz/x' },
    ]);
  });

  it.each([
    '2 * 3 * 4', '** not bold **', '* not italic *', 'a**b', '***', '*', '**',
    'snake_case_name', '[no link]', '[x]()', 'price: 5*',
  ])('%j is literal text', (str) => {
    expect(inline(str).every(tk => tk.type === 'text')).toBe(true);
  });

  it('autolink leaves trailing punctuation outside', () => {
    expect(inline('see https://a.cz/x.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'autolink', text: 'https://a.cz/x', href: 'https://a.cz/x' },
      { type: 'text', text: '.' },
    ]);
  });

  it('a link with an unsafe target renders as its literal source', () => {
    expect(inline('[click](javascript:alert(1))').every(tk => tk.type === 'text')).toBe(true);
  });
});

describe('isSafeCommentUrl', () => {
  it.each(['https://example.com', 'http://example.com/a?b=c#d', 'HTTPS://EXAMPLE.COM', 'mailto:a@b.cz'])(
    'allows %j', (url) => expect(isSafeCommentUrl(url)).toBe(true));

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox',
    ' https://example.com', '\thttps://example.com', 'java\nscript:alert(1)', 'https://exa mple.com',
    'javascript&#58;alert(1)', '&#106;avascript:alert(1)', 'https:/example.com', 'https:',
    '//evil.example', 'ftp://example.com', 'file:///etc/passwd', '', null, undefined,
  ])('rejects %j', (url) => expect(isSafeCommentUrl(url)).toBe(false));
});

describe('comment round trip — tokens re-serialize byte-identically', () => {
  // Comments the way people actually write them, literal Markdown-ish
  // characters and whitespace included.
  const corpus = [
    '',
    'Call Petr about the invoice',
    'Buy:\n- milk\n- eggs\n- 2 * bread',
    '- [ ] book flights\n- [x] pack\n- [ ] taxi at 6:30',
    '# Plan\nFirst **draft** by Friday, *then* review.\n\n\nLinks: [doc](https://docs.example.com/d/1) and https://example.com/path?q=1.',
    '  indented line\ttab\ntrailing spaces   \n',
    '#hashtag and #another\n## not a heading\n* not a bullet',
    'snake_case_var, a*b*c, 5 * 3 = 15, ***stars***, **unclosed',
    '[broken](javascript:alert(1)) [ok](mailto:me@example.com)',
    'Czech: ěščřžýáíéůú ĚŠČŘŽ — emoji 👍🏽 and 漢字',
    '\n\n\n',
    '- [X] capital\n- [ ]no space\n-  two spaces',
    '* star\n- dash\n* mixed *italic* inside\n*not a bullet*',
    'CRLF line\r\nsecond',
  ];

  it.each(corpus)('%j', (str) => {
    expect(serializeComment(tokenizeComment(str))).toBe(str);
  });

  it('serializes from token meaning, not from raw source', () => {
    const blocks = tokenizeComment('- [ ] a');
    blocks[0].checked = true;
    expect(serializeComment(blocks)).toBe('- [x] a');
  });
});

describe('buildCommentInline', () => {
  const fakeParent = () => {
    const kids = [];
    return { kids, appendChild: (el) => { kids.push(el); return el; } };
  };

  it('builds text nodes and elements via textContent, links hardened', () => {
    const parent = fakeParent();
    buildCommentInline(tokenizeComment('x **<b>** [<img onerror=1>](https://a.cz)')[0].inline, parent);
    const [text, bold, space, link] = parent.kids;
    expect(text.textContent).toBe('x ');
    expect(bold.textContent).toBe('<b>');
    expect(bold.innerHTML).toBe('');
    expect(space.textContent).toBe(' ');
    expect(link.textContent).toBe('<img onerror=1>');
    expect(link.href).toBe('https://a.cz');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.target).toBe('_blank');
  });

  it('never creates an anchor for an unsafe link', () => {
    const parent = fakeParent();
    buildCommentInline(tokenizeComment('[x](javascript:alert(1)) data:text/html,hi')[0].inline, parent);
    expect(parent.kids.every(k => k.href === undefined)).toBe(true);
  });
});

describe('commentVisibleLength', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['**abc**', 3],
    ['- [ ] abc', 3],
    ['# a\n- b', 3],
    ['[text](https://example.com/very/long)', 4],
    ['2 * 3', 5],
  ])('%j → %d', (str, len) => expect(commentVisibleLength(str)).toBe(len));
});

describe('commentPreview', () => {
  it('uses the first line with visible text', () => {
    const p = commentPreview('\n- [ ] \n# **Plan** for today\nmore');
    expect(p.inline.map(tk => tk.text).join('')).toBe('Plan for today');
  });

  it('counts checklist items', () => {
    expect(commentPreview('- [x] a\n- [ ] b').checks).toEqual({ done: 1, total: 2 });
    expect(commentPreview('- [x] a\n- [x] b\n- [ ] c\nnote').checks).toEqual({ done: 2, total: 3 });
  });

  it('no checklist, no pill', () => {
    expect(commentPreview('just text\n- bullet').checks).toBe(null);
  });
});
