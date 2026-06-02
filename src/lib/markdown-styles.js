export const TextStyle = {
  Bold: 'b',
  Italic: 'i',
  StrikeThrough: 's',
  UnorderedList: 'lst_1',
  OrderedList: 'lst_2',
};

const INLINE_MARKERS = [
  { marker: '~~', style: TextStyle.StrikeThrough },
  { marker: '**', style: TextStyle.Bold },
  { marker: '__', style: TextStyle.Bold },
  { marker: '*', style: TextStyle.Italic },
  { marker: '_', style: TextStyle.Italic },
];

function normalizeLinks(text) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

function normalizeCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, block => block.slice(3, -3).replace(/^\w*\n/, ''))
    .replace(/`([^`]+)`/g, '$1');
}

function stripBlockMarkers(line) {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '');
}

function hasClosingMarker(text, marker, from) {
  return text.indexOf(marker, from) !== -1;
}

function isWordChar(ch) {
  return typeof ch === 'string' && /[A-Za-z0-9]/.test(ch);
}

function isUsableMarker(text, index, marker) {
  if (marker !== '_') return true;
  const before = index > 0 ? text[index - 1] : '';
  const after = text[index + marker.length] || '';
  return !(isWordChar(before) && isWordChar(after));
}

function parseInline(input, offset) {
  const styles = [];
  const stacks = new Map();
  let text = '';
  let i = 0;

  while (i < input.length) {
    const def = INLINE_MARKERS.find(candidate =>
      input.startsWith(candidate.marker, i) && isUsableMarker(input, i, candidate.marker)
    );

    if (def) {
      const stack = stacks.get(def.marker);
      if (stack !== undefined) {
        const len = text.length - stack;
        if (len > 0) styles.push({ start: offset + stack, len, st: def.style });
        stacks.delete(def.marker);
        i += def.marker.length;
        continue;
      }

      if (hasClosingMarker(input, def.marker, i + def.marker.length)) {
        stacks.set(def.marker, text.length);
        i += def.marker.length;
        continue;
      }
    }

    text += input[i];
    i += 1;
  }

  return { text, styles };
}

function stylePriority(style) {
  if (style.st === TextStyle.UnorderedList || style.st === TextStyle.OrderedList) return 0;
  return 1;
}

function subtractOccupied(start, end, occupied) {
  let segments = [{ start, end }];
  for (const interval of occupied) {
    const next = [];
    for (const segment of segments) {
      if (interval.end <= segment.start || interval.start >= segment.end) {
        next.push(segment);
        continue;
      }
      if (interval.start > segment.start) {
        next.push({ start: segment.start, end: interval.start });
      }
      if (interval.end < segment.end) {
        next.push({ start: interval.end, end: segment.end });
      }
    }
    segments = next;
    if (segments.length === 0) break;
  }
  return segments;
}

function flattenStyles(styles) {
  const candidates = styles
    .filter(style => style && Number.isInteger(style.start) && Number.isInteger(style.len) && style.len > 0 && style.st)
    .sort((a, b) =>
      stylePriority(a) - stylePriority(b)
      || a.start - b.start
      || a.len - b.len
      || String(a.st).localeCompare(String(b.st))
    );
  const occupied = [];
  const merged = [];

  for (const style of candidates) {
    const segments = subtractOccupied(style.start, style.start + style.len, occupied);
    for (const segment of segments) {
      merged.push({ start: segment.start, len: segment.end - segment.start, st: style.st });
      occupied.push(segment);
      occupied.sort((a, b) => a.start - b.start || a.end - b.end);
    }
  }

  merged.sort((a, b) => a.start - b.start || a.len - b.len || String(a.st).localeCompare(String(b.st)));
  const compacted = [];
  for (const style of merged) {
    const prev = compacted[compacted.length - 1];
    if (prev && prev.st === style.st && prev.start + prev.len === style.start) {
      prev.len += style.len;
    } else {
      compacted.push({ ...style });
    }
  }
  return compacted;
}

export function parseMarkdownStyles(markdown) {
  try {
    const normalized = normalizeLinks(normalizeCode(String(markdown ?? '')));
    const lines = normalized.split('\n');
    const output = [];
    const styles = [];
    let offset = 0;

    for (let index = 0; index < lines.length; index++) {
      let line = stripBlockMarkers(lines[index]);
      let listStyle = null;
      const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
      const ordered = line.match(/^\s*(\d+[.)])\s+(.*)$/);

      if (unordered) {
        line = `- ${unordered[1]}`;
        listStyle = TextStyle.UnorderedList;
      } else if (ordered) {
        line = `${ordered[1]} ${ordered[2]}`;
        listStyle = TextStyle.OrderedList;
      }

      const parsed = parseInline(line, offset);
      output.push(parsed.text);
      styles.push(...parsed.styles);
      if (listStyle && parsed.text.trim()) {
        styles.push({ start: offset, len: parsed.text.length, st: listStyle });
      }

      offset += parsed.text.length;
      if (index < lines.length - 1) {
        output.push('\n');
        offset += 1;
      }
    }

    return {
      text: output.join(''),
      styles: flattenStyles(styles),
    };
  } catch {
    return { text: String(markdown ?? ''), styles: [] };
  }
}

function trimRange(text, start, end) {
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return { start, end };
}

function stylesForRange(styles, start, end) {
  return styles
    .map(style => {
      const styleEnd = style.start + style.len;
      const rangeStart = Math.max(start, style.start);
      const rangeEnd = Math.min(end, styleEnd);
      if (rangeEnd <= rangeStart) return null;
      return { ...style, start: rangeStart - start, len: rangeEnd - rangeStart };
    })
    .filter(Boolean);
}

export function splitStyledMessage(text, styles = [], maxLen = 2000) {
  const source = String(text ?? '');
  if (source.length <= maxLen) {
    const range = trimRange(source, 0, source.length);
    const part = source.slice(range.start, range.end);
    return part ? [{ text: part, styles: stylesForRange(styles, range.start, range.end) }] : [];
  }

  const chunks = [];
  let start = 0;
  while (start < source.length) {
    let end;
    if (source.length - start <= maxLen) {
      end = source.length;
    } else {
      const candidate = source.substring(start, start + maxLen);
      let breakAt = maxLen;
      const lastParaBreak = candidate.lastIndexOf('\n\n');
      if (lastParaBreak > maxLen * 0.3) {
        breakAt = lastParaBreak + 1;
      } else {
        const lastNewline = candidate.lastIndexOf('\n');
        if (lastNewline > maxLen * 0.3) {
          breakAt = lastNewline;
        } else {
          const lastSpace = candidate.lastIndexOf(' ');
          if (lastSpace > maxLen * 0.3) breakAt = lastSpace;
        }
      }
      end = start + breakAt;
    }

    const range = trimRange(source, start, end);
    const part = source.slice(range.start, range.end);
    if (part) chunks.push({ text: part, styles: stylesForRange(styles, range.start, range.end) });
    start = end;
    while (start < source.length && /\s/.test(source[start])) start += 1;
  }

  return chunks;
}
