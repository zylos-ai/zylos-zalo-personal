import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMarkdownStyles, splitStyledMessage, TextStyle
} from '../src/lib/markdown-styles.js';

describe('parseMarkdownStyles', () => {
  it('parses bold, italic, and strike ranges after marker removal', () => {
    const result = parseMarkdownStyles('Hello **bold** _italics_ ~~gone~~');

    assert.equal(result.text, 'Hello bold italics gone');
    assert.deepEqual(result.styles, [
      { start: 6, len: 4, st: TextStyle.Bold },
      { start: 11, len: 7, st: TextStyle.Italic },
      { start: 19, len: 4, st: TextStyle.StrikeThrough },
    ]);
  });

  it('uses UTF-16 offsets in the local representation for CJK and emoji', () => {
    const result = parseMarkdownStyles('A **你好🙂** B');

    assert.equal(result.text, 'A 你好🙂 B');
    assert.deepEqual(result.styles, [
      { start: 2, len: 4, st: TextStyle.Bold },
    ]);
  });

  it('normalizes markdown links, headings, quotes, and code markers', () => {
    const result = parseMarkdownStyles('# Title\n> `code`\n[Docs](https://example.test)');

    assert.equal(result.text, 'Title\ncode\nDocs (https://example.test)');
    assert.deepEqual(result.styles, []);
  });

  it('adds list styles while preserving readable list prefixes', () => {
    const result = parseMarkdownStyles('- **first**\n2. second');

    assert.equal(result.text, '- first\n2. second');
    assert.deepEqual(result.styles, [
      { start: 0, len: 7, st: TextStyle.UnorderedList },
      { start: 8, len: 9, st: TextStyle.OrderedList },
    ]);
  });

  it('flattens nested inline markers so style ranges do not overlap', () => {
    const result = parseMarkdownStyles('mix **~~both~~** plain');

    assert.equal(result.text, 'mix both plain');
    assert.deepEqual(result.styles, [
      { start: 4, len: 4, st: TextStyle.Bold },
    ]);
  });

  it('leaves unmatched markers as literal text', () => {
    const result = parseMarkdownStyles('bad **marker');

    assert.equal(result.text, 'bad **marker');
    assert.deepEqual(result.styles, []);
  });
});

describe('splitStyledMessage', () => {
  it('splits style ranges across chunks and adjusts offsets', () => {
    const chunks = splitStyledMessage('hello styled world', [
      { start: 6, len: 12, st: TextStyle.Bold },
    ], 10);

    assert.deepEqual(chunks, [
      { text: 'hello', styles: [] },
      { text: 'styled', styles: [{ start: 0, len: 6, st: TextStyle.Bold }] },
      { text: 'world', styles: [{ start: 0, len: 5, st: TextStyle.Bold }] },
    ]);
  });

  it('returns an empty array for all-whitespace text', () => {
    assert.deepEqual(splitStyledMessage('   ', [], 2000), []);
  });
});
