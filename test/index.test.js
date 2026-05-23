import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// index.js has heavy side effects (zca-js import, fs.watch, etc.) so we
// recreate the pure functions here for unit testing. These mirror the
// implementations in src/index.js exactly.

// ============================================================
// parseContent (pure logic, extracted for testing)
// ============================================================

function parseContentSync(content) {
  let text = '';
  let mediaPath = null;
  let mediaMetadata = null;

  if (typeof content === 'string') {
    text = content;
  } else if (content && typeof content === 'object') {
    if (content.params?.photoId || content.thumbUrl || content.hdUrl) {
      const imgUrl = content.hdUrl || content.normalUrl || content.thumbUrl || content.href;
      text = content.desc || content.description || content.title || '[sent an image]';
      mediaMetadata = imgUrl ? `[image, url: ${imgUrl}]` : '[image]';
    } else if (content.id != null && content.type != null && content.catId != null) {
      text = '[sent a sticker]';
    } else if (content.href) {
      const isZaloCdn = /\.(dlfl\.vn|zadn\.vn|zdn\.vn|zaloapp\.com)\//i.test(content.href);
      const isImageUrl = /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(content.href) ||
                         /photo[-.].*\.(zdn\.vn|zadn\.vn)/i.test(content.href);
      const isDownloadable = isZaloCdn || (content.action === 'oa.open.inapp' && content.title);

      if (!isDownloadable) {
        text = `[sent a link: ${content.href}]`;
      } else if (isImageUrl) {
        text = content.desc || content.description || content.title || '[sent an image]';
        mediaMetadata = `[image, url: ${content.href}]`;
      } else {
        const fileName = content.title || 'file_unknown';
        text = `[sent a file: ${fileName}]`;
        mediaMetadata = `[file: ${fileName}]`;
      }
    } else if (content.title) {
      text = `[attachment: ${content.title}]`;
    } else {
      text = JSON.stringify(content);
    }
  }

  if (!text && !mediaPath && !mediaMetadata) {
    text = '[unsupported message type]';
  }

  return { text, mediaPath, mediaMetadata };
}

// ============================================================
// isBotMentioned (pure logic)
// ============================================================

function isBotMentioned(data, ownId) {
  if (!ownId) return false;
  const mentions = data.mentions;
  if (!mentions || !Array.isArray(mentions)) return false;
  return mentions.some(m => String(m.uid) === String(ownId) || m.type === 1);
}

// ============================================================
// buildEndpoint (pure logic)
// ============================================================

const ThreadType = { User: 0, Group: 1 };

function buildEndpoint(threadId, { messageId, threadType } = {}) {
  let endpoint = String(threadId);
  const typeStr = threadType === ThreadType.Group ? 'group' : 'dm';
  if (messageId) {
    const correlationId = `${threadId}:${messageId}`;
    endpoint += `|msg:${messageId}|req:${correlationId}|type:${typeStr}`;
  }
  return endpoint;
}

// ============================================================
// cacheMessage / messageCache logic (pure logic)
// ============================================================

function createMessageCache(maxSize = 200) {
  const cache = new Map();
  return {
    set(msgId, data) {
      cache.set(String(msgId), {
        msgId: data.msgId,
        cliMsgId: data.cliMsgId,
        uidFrom: data.uidFrom,
        msgType: data.msgType || 'webchat',
        ts: data.ts,
        content: data.content,
        ttl: data.ttl || 0
      });
      if (cache.size > maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
    },
    get(msgId) { return cache.get(String(msgId)); },
    size() { return cache.size; },
  };
}

// ============================================================
// Mention time-window logic (pure)
// ============================================================

function createMentionTracker(windowMs = 30000) {
  const map = new Map();
  return {
    recordMention(threadId, senderId) {
      map.set(`${threadId}:${senderId}`, Date.now());
    },
    isInWindow(threadId, senderId) {
      const key = `${threadId}:${senderId}`;
      if (!map.has(key)) return false;
      return (Date.now() - map.get(key)) < windowMs;
    },
    recordMentionAt(threadId, senderId, timestamp) {
      map.set(`${threadId}:${senderId}`, timestamp);
    },
  };
}

// ============================================================
// Reaction parsing logic (pure)
// ============================================================

function parseReaction(data) {
  const rIcon = data.content?.rIcon || '';
  const isRemoved = rIcon === '' || data.content?.rType === -1;
  return isRemoved ? '[removed reaction]' : `[reacted ${rIcon}]`;
}

// ============================================================
// stripBotMention (pure logic)
// ============================================================

function stripBotMention(text, data, ownId) {
  if (!ownId || !text || !data.mentions || !Array.isArray(data.mentions)) return text;
  const botMentions = data.mentions
    .filter(m => String(m.uid) === String(ownId) && typeof m.pos === 'number' && typeof m.len === 'number')
    .sort((a, b) => b.pos - a.pos);
  let result = text;
  for (const m of botMentions) {
    result = result.slice(0, m.pos) + result.slice(m.pos + m.len);
  }
  return result.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
}

// ============================================================
// Thinking indicator tracking (pure logic)
// ============================================================

function createThinkingTracker() {
  const pending = new Map();
  return {
    add(correlationId, data) {
      pending.set(correlationId, data);
    },
    get(correlationId) {
      return pending.get(correlationId);
    },
    remove(correlationId) {
      pending.delete(correlationId);
    },
    has(correlationId) {
      return pending.has(correlationId);
    },
    size() {
      return pending.size;
    }
  };
}

// ============================================================
// Tests
// ============================================================

describe('parseContent', () => {
  describe('string content', () => {
    it('returns plain text', () => {
      const result = parseContentSync('hello world');
      assert.equal(result.text, 'hello world');
      assert.equal(result.mediaPath, null);
      assert.equal(result.mediaMetadata, null);
    });

    it('handles empty string', () => {
      const result = parseContentSync('');
      assert.equal(result.text, '[unsupported message type]');
    });
  });

  describe('image content (photoId/thumbUrl/hdUrl)', () => {
    it('detects image with hdUrl', () => {
      const result = parseContentSync({
        hdUrl: 'https://photo.zdn.vn/img.jpg',
        desc: 'my photo'
      });
      assert.equal(result.text, 'my photo');
      assert.ok(result.mediaMetadata.includes('photo.zdn.vn/img.jpg'));
    });

    it('detects image with thumbUrl', () => {
      const result = parseContentSync({ thumbUrl: 'https://example.com/thumb.jpg' });
      assert.equal(result.text, '[sent an image]');
      assert.ok(result.mediaMetadata.includes('thumb.jpg'));
    });

    it('detects image with params.photoId', () => {
      const result = parseContentSync({
        params: { photoId: '12345' },
        title: 'Photo title'
      });
      assert.equal(result.text, 'Photo title');
      assert.equal(result.mediaMetadata, '[image]');
    });

    it('falls back to [sent an image] without desc', () => {
      const result = parseContentSync({ hdUrl: 'https://x.com/img.png' });
      assert.equal(result.text, '[sent an image]');
    });
  });

  describe('sticker content', () => {
    it('detects sticker', () => {
      const result = parseContentSync({ id: 1, catId: 0, type: 7 });
      assert.equal(result.text, '[sent a sticker]');
    });

    it('detects sticker with different values', () => {
      const result = parseContentSync({ id: 42, catId: 5, type: 2 });
      assert.equal(result.text, '[sent a sticker]');
    });

    it('detects sticker with id=0', () => {
      const result = parseContentSync({ id: 0, catId: 0, type: 0 });
      assert.equal(result.text, '[sent a sticker]');
    });
  });

  describe('href content (files and links)', () => {
    it('detects non-downloadable link', () => {
      const result = parseContentSync({ href: 'https://google.com' });
      assert.equal(result.text, '[sent a link: https://google.com]');
    });

    it('detects Zalo CDN file', () => {
      const result = parseContentSync({
        href: 'https://files.dlfl.vn/file.pdf',
        title: 'document.pdf'
      });
      assert.equal(result.text, '[sent a file: document.pdf]');
      assert.equal(result.mediaMetadata, '[file: document.pdf]');
    });

    it('detects Zalo CDN image', () => {
      const result = parseContentSync({
        href: 'https://photo-storage.zdn.vn/image.jpg'
      });
      assert.equal(result.text, '[sent an image]');
      assert.ok(result.mediaMetadata.includes('image.jpg'));
    });

    it('detects zadn.vn CDN file', () => {
      const result = parseContentSync({
        href: 'https://files.zadn.vn/doc.zip',
        title: 'archive.zip'
      });
      assert.equal(result.text, '[sent a file: archive.zip]');
    });

    it('detects zaloapp.com CDN file', () => {
      const result = parseContentSync({
        href: 'https://cdn.zaloapp.com/files/report.xlsx',
        title: 'report.xlsx'
      });
      assert.equal(result.text, '[sent a file: report.xlsx]');
    });

    it('detects oa.open.inapp action as downloadable', () => {
      const result = parseContentSync({
        href: 'https://random.site/file.pdf',
        action: 'oa.open.inapp',
        title: 'shared_doc.pdf'
      });
      assert.equal(result.text, '[sent a file: shared_doc.pdf]');
    });

    it('detects image by extension in href', () => {
      const result = parseContentSync({
        href: 'https://files.dlfl.vn/photo.png',
        desc: 'nice pic'
      });
      assert.equal(result.text, 'nice pic');
      assert.ok(result.mediaMetadata.includes('[image, url:'));
    });
  });

  describe('title-only content', () => {
    it('formats as attachment', () => {
      const result = parseContentSync({ title: 'Some Attachment' });
      assert.equal(result.text, '[attachment: Some Attachment]');
    });
  });

  describe('unknown object content', () => {
    it('stringifies unknown objects', () => {
      const result = parseContentSync({ foo: 'bar', baz: 42 });
      assert.equal(result.text, '{"foo":"bar","baz":42}');
    });
  });

  describe('null/undefined content', () => {
    it('handles null', () => {
      const result = parseContentSync(null);
      assert.equal(result.text, '[unsupported message type]');
    });

    it('handles undefined', () => {
      const result = parseContentSync(undefined);
      assert.equal(result.text, '[unsupported message type]');
    });
  });
});

describe('isBotMentioned', () => {
  it('returns false when ownId is falsy', () => {
    assert.equal(isBotMentioned({ mentions: [{ uid: '123' }] }, null), false);
    assert.equal(isBotMentioned({ mentions: [{ uid: '123' }] }, ''), false);
  });

  it('returns false when no mentions array', () => {
    assert.equal(isBotMentioned({}, '123'), false);
    assert.equal(isBotMentioned({ mentions: null }, '123'), false);
  });

  it('returns false when mentions is not an array', () => {
    assert.equal(isBotMentioned({ mentions: 'not-array' }, '123'), false);
  });

  it('returns true when ownId matches', () => {
    assert.equal(isBotMentioned({ mentions: [{ uid: '123' }] }, '123'), true);
  });

  it('matches ownId across types', () => {
    assert.equal(isBotMentioned({ mentions: [{ uid: 123 }] }, '123'), true);
    assert.equal(isBotMentioned({ mentions: [{ uid: '123' }] }, 123), true);
  });

  it('returns true for @all mention (type=1)', () => {
    assert.equal(isBotMentioned({ mentions: [{ uid: '999', type: 1 }] }, '123'), true);
  });

  it('returns false when no matching mention', () => {
    assert.equal(isBotMentioned({ mentions: [{ uid: '456' }] }, '123'), false);
  });

  it('returns true with multiple mentions including ownId', () => {
    const data = { mentions: [{ uid: '456' }, { uid: '123' }, { uid: '789' }] };
    assert.equal(isBotMentioned(data, '123'), true);
  });
});

describe('buildEndpoint', () => {
  it('returns threadId as string without messageId', () => {
    assert.equal(buildEndpoint('12345'), '12345');
  });

  it('builds full endpoint for DM', () => {
    const result = buildEndpoint('12345', {
      messageId: 'msg1',
      threadType: ThreadType.User
    });
    assert.equal(result, '12345|msg:msg1|req:12345:msg1|type:dm');
  });

  it('builds full endpoint for group', () => {
    const result = buildEndpoint('g1', {
      messageId: 'msg2',
      threadType: ThreadType.Group
    });
    assert.equal(result, 'g1|msg:msg2|req:g1:msg2|type:group');
  });

  it('handles numeric threadId', () => {
    const result = buildEndpoint(12345);
    assert.equal(result, '12345');
  });
});

describe('messageCache', () => {
  it('stores and retrieves messages', () => {
    const cache = createMessageCache();
    cache.set('msg1', {
      msgId: 'msg1', cliMsgId: 'cli1', uidFrom: 'u1', ts: 1000, content: 'hello'
    });
    const entry = cache.get('msg1');
    assert.equal(entry.msgId, 'msg1');
    assert.equal(entry.uidFrom, 'u1');
    assert.equal(entry.content, 'hello');
    assert.equal(entry.msgType, 'webchat');
  });

  it('defaults msgType to webchat', () => {
    const cache = createMessageCache();
    cache.set('msg1', { msgId: 'msg1', content: 'test' });
    assert.equal(cache.get('msg1').msgType, 'webchat');
  });

  it('preserves explicit msgType', () => {
    const cache = createMessageCache();
    cache.set('msg1', { msgId: 'msg1', content: 'test', msgType: 'chat' });
    assert.equal(cache.get('msg1').msgType, 'chat');
  });

  it('evicts oldest entries beyond max size', () => {
    const cache = createMessageCache(3);
    cache.set('a', { msgId: 'a', content: '1' });
    cache.set('b', { msgId: 'b', content: '2' });
    cache.set('c', { msgId: 'c', content: '3' });
    cache.set('d', { msgId: 'd', content: '4' });
    assert.equal(cache.get('a'), undefined);
    assert.ok(cache.get('b'));
    assert.ok(cache.get('d'));
    assert.equal(cache.size(), 3);
  });

  it('handles numeric msgId', () => {
    const cache = createMessageCache();
    cache.set(123, { msgId: 123, content: 'test' });
    assert.ok(cache.get('123'));
    assert.ok(cache.get(123));
  });
});

describe('mention time-window', () => {
  it('returns false when no mention recorded', () => {
    const tracker = createMentionTracker();
    assert.equal(tracker.isInWindow('g1', 'u1'), false);
  });

  it('returns true within window', () => {
    const tracker = createMentionTracker(30000);
    tracker.recordMention('g1', 'u1');
    assert.equal(tracker.isInWindow('g1', 'u1'), true);
  });

  it('returns false after window expires', () => {
    const tracker = createMentionTracker(30000);
    tracker.recordMentionAt('g1', 'u1', Date.now() - 31000);
    assert.equal(tracker.isInWindow('g1', 'u1'), false);
  });

  it('tracks per user per group', () => {
    const tracker = createMentionTracker(30000);
    tracker.recordMention('g1', 'u1');
    assert.equal(tracker.isInWindow('g1', 'u1'), true);
    assert.equal(tracker.isInWindow('g1', 'u2'), false);
    assert.equal(tracker.isInWindow('g2', 'u1'), false);
  });

  it('updates timestamp on re-mention', () => {
    const tracker = createMentionTracker(30000);
    tracker.recordMentionAt('g1', 'u1', Date.now() - 29000);
    assert.equal(tracker.isInWindow('g1', 'u1'), true);
    tracker.recordMention('g1', 'u1');
    assert.equal(tracker.isInWindow('g1', 'u1'), true);
  });
});

describe('parseReaction', () => {
  it('parses reaction with icon', () => {
    assert.equal(parseReaction({ content: { rIcon: '/-strong' } }), '[reacted /-strong]');
  });

  it('parses heart reaction', () => {
    assert.equal(parseReaction({ content: { rIcon: '❤️' } }), '[reacted ❤️]');
  });

  it('detects removed reaction (empty icon)', () => {
    assert.equal(parseReaction({ content: { rIcon: '' } }), '[removed reaction]');
  });

  it('detects removed reaction (rType -1)', () => {
    assert.equal(parseReaction({ content: { rIcon: '👍', rType: -1 } }), '[removed reaction]');
  });

  it('handles missing content', () => {
    assert.equal(parseReaction({}), '[removed reaction]');
  });

  it('handles null rIcon', () => {
    assert.equal(parseReaction({ content: { rIcon: null } }), '[removed reaction]');
  });
});

describe('message forwarding logic', () => {
  function shouldForward({ isGroup, groupMode, mentioned, inMentionWindow }) {
    return !isGroup || groupMode === 'smart' || mentioned || inMentionWindow;
  }

  it('always forwards DM', () => {
    assert.equal(shouldForward({ isGroup: false, groupMode: null, mentioned: false, inMentionWindow: false }), true);
  });

  it('forwards group message when @mentioned', () => {
    assert.equal(shouldForward({ isGroup: true, groupMode: 'mention', mentioned: true, inMentionWindow: false }), true);
  });

  it('forwards group message in time window', () => {
    assert.equal(shouldForward({ isGroup: true, groupMode: 'mention', mentioned: false, inMentionWindow: true }), true);
  });

  it('blocks group message in mention mode without mention or window', () => {
    assert.equal(shouldForward({ isGroup: true, groupMode: 'mention', mentioned: false, inMentionWindow: false }), false);
  });

  it('always forwards in smart mode', () => {
    assert.equal(shouldForward({ isGroup: true, groupMode: 'smart', mentioned: false, inMentionWindow: false }), true);
  });
});

describe('smart mode download logic', () => {
  function shouldDownload({ downloadEnabled, smartNoMention }) {
    return downloadEnabled !== false && !smartNoMention;
  }

  it('downloads in mention mode with mention', () => {
    assert.equal(shouldDownload({ downloadEnabled: true, smartNoMention: false }), true);
  });

  it('skips download in smart mode without mention', () => {
    assert.equal(shouldDownload({ downloadEnabled: true, smartNoMention: true }), false);
  });

  it('skips download when feature disabled', () => {
    assert.equal(shouldDownload({ downloadEnabled: false, smartNoMention: false }), false);
  });
});

describe('stripBotMention', () => {
  const BOT_ID = '634535186919667503';

  it('strips bot mention from start of text', () => {
    const result = stripBotMention('@Rui hey test', {
      mentions: [{ uid: BOT_ID, pos: 0, len: 4 }]
    }, BOT_ID);
    assert.equal(result, 'hey test');
  });

  it('strips bot mention from middle of text', () => {
    const result = stripBotMention('hello @Rui what do you think', {
      mentions: [{ uid: BOT_ID, pos: 6, len: 4 }]
    }, BOT_ID);
    assert.equal(result, 'hello what do you think');
  });

  it('strips multiple bot mentions', () => {
    const result = stripBotMention('@Rui hey @Rui test', {
      mentions: [
        { uid: BOT_ID, pos: 0, len: 4 },
        { uid: BOT_ID, pos: 9, len: 4 }
      ]
    }, BOT_ID);
    assert.equal(result, 'hey test');
  });

  it('preserves other user mentions', () => {
    const result = stripBotMention('@Rui hey @Felix check this', {
      mentions: [
        { uid: BOT_ID, pos: 0, len: 4 },
        { uid: '999', pos: 9, len: 6 }
      ]
    }, BOT_ID);
    assert.equal(result, 'hey @Felix check this');
  });

  it('returns original text when no ownId', () => {
    assert.equal(stripBotMention('@Rui test', { mentions: [{ uid: '123', pos: 0, len: 4 }] }, null), '@Rui test');
    assert.equal(stripBotMention('@Rui test', { mentions: [{ uid: '123', pos: 0, len: 4 }] }, ''), '@Rui test');
  });

  it('returns original text when no mentions array', () => {
    assert.equal(stripBotMention('hello', {}, BOT_ID), 'hello');
    assert.equal(stripBotMention('hello', { mentions: null }, BOT_ID), 'hello');
  });

  it('returns original text when mentions is not an array', () => {
    assert.equal(stripBotMention('hello', { mentions: 'bad' }, BOT_ID), 'hello');
  });

  it('handles mention without pos/len gracefully', () => {
    const result = stripBotMention('@Rui test', {
      mentions: [{ uid: BOT_ID }]
    }, BOT_ID);
    assert.equal(result, '@Rui test');
  });

  it('trims leading whitespace after stripping', () => {
    const result = stripBotMention('@Rui  hello', {
      mentions: [{ uid: BOT_ID, pos: 0, len: 4 }]
    }, BOT_ID);
    assert.equal(result, 'hello');
  });

  it('matches uid across string/number types', () => {
    const result = stripBotMention('@Bot test', {
      mentions: [{ uid: 12345, pos: 0, len: 4 }]
    }, '12345');
    assert.equal(result, 'test');
  });

  it('handles empty text', () => {
    assert.equal(stripBotMention('', { mentions: [] }, BOT_ID), '');
  });
});

describe('thinking indicator tracking', () => {
  it('stores and retrieves pending reactions', () => {
    const tracker = createThinkingTracker();
    tracker.add('g1:msg1', { msgId: '100', cliMsgId: '200', threadId: 'g1', threadType: 1 });
    const pending = tracker.get('g1:msg1');
    assert.equal(pending.msgId, '100');
    assert.equal(pending.cliMsgId, '200');
    assert.equal(pending.threadId, 'g1');
  });

  it('removes pending reactions', () => {
    const tracker = createThinkingTracker();
    tracker.add('g1:msg1', { msgId: '100' });
    assert.equal(tracker.has('g1:msg1'), true);
    tracker.remove('g1:msg1');
    assert.equal(tracker.has('g1:msg1'), false);
    assert.equal(tracker.get('g1:msg1'), undefined);
  });

  it('tracks multiple independent reactions', () => {
    const tracker = createThinkingTracker();
    tracker.add('g1:msg1', { msgId: '100' });
    tracker.add('g1:msg2', { msgId: '200' });
    tracker.add('dm:msg3', { msgId: '300' });
    assert.equal(tracker.size(), 3);
    tracker.remove('g1:msg1');
    assert.equal(tracker.size(), 2);
    assert.equal(tracker.has('g1:msg2'), true);
    assert.equal(tracker.has('dm:msg3'), true);
  });

  it('returns false for non-existent correlation', () => {
    const tracker = createThinkingTracker();
    assert.equal(tracker.has('nonexistent'), false);
  });

  it('overwrites on duplicate correlationId', () => {
    const tracker = createThinkingTracker();
    tracker.add('g1:msg1', { msgId: '100' });
    tracker.add('g1:msg1', { msgId: '999' });
    assert.equal(tracker.get('g1:msg1').msgId, '999');
    assert.equal(tracker.size(), 1);
  });
});

describe('reaction map', () => {
  const reactionMap = {
    'heart': 'HEART', '❤️': 'HEART', '❤': 'HEART',
    'like': 'LIKE', '👍': 'LIKE',
    'haha': 'HAHA', '😆': 'HAHA',
    'wow': 'WOW', '😮': 'WOW',
    'cry': 'CRY', '😢': 'CRY',
    'angry': 'ANGRY', '😠': 'ANGRY',
  };

  it('maps all text names', () => {
    assert.equal(reactionMap['heart'], 'HEART');
    assert.equal(reactionMap['like'], 'LIKE');
    assert.equal(reactionMap['haha'], 'HAHA');
    assert.equal(reactionMap['wow'], 'WOW');
    assert.equal(reactionMap['cry'], 'CRY');
    assert.equal(reactionMap['angry'], 'ANGRY');
  });

  it('maps all emoji variants', () => {
    assert.equal(reactionMap['❤️'], 'HEART');
    assert.equal(reactionMap['❤'], 'HEART');
    assert.equal(reactionMap['👍'], 'LIKE');
    assert.equal(reactionMap['😆'], 'HAHA');
    assert.equal(reactionMap['😮'], 'WOW');
    assert.equal(reactionMap['😢'], 'CRY');
    assert.equal(reactionMap['😠'], 'ANGRY');
  });

  it('returns undefined for unknown reactions', () => {
    assert.equal(reactionMap['unknown'], undefined);
  });
});

// ============================================================
// timingSafeTokenEqual (mirrors src/index.js)
// ============================================================

function timingSafeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

describe('timingSafeTokenEqual', () => {
  it('returns true for equal tokens', () => {
    const token = crypto.randomBytes(32).toString('hex');
    assert.equal(timingSafeTokenEqual(token, token), true);
  });

  it('returns false for different tokens of same length', () => {
    const a = crypto.randomBytes(32).toString('hex');
    const b = crypto.randomBytes(32).toString('hex');
    assert.equal(timingSafeTokenEqual(a, b), false);
  });

  it('rejects length mismatch before timingSafeEqual', () => {
    assert.equal(timingSafeTokenEqual('short', 'a-much-longer-token-value'), false);
  });

  it('rejects undefined', () => {
    assert.equal(timingSafeTokenEqual(undefined, 'token'), false);
  });

  it('rejects null', () => {
    assert.equal(timingSafeTokenEqual(null, 'token'), false);
  });

  it('rejects number', () => {
    assert.equal(timingSafeTokenEqual(12345, 'token'), false);
  });

  it('rejects array (duplicate header)', () => {
    assert.equal(timingSafeTokenEqual(['tok', 'tok'], 'tok'), false);
  });

  it('returns false when both are non-string', () => {
    assert.equal(timingSafeTokenEqual(null, undefined), false);
  });
});

// ============================================================
// Disabled groupPolicy blocks all group processing
// ============================================================

describe('disabled groupPolicy forwarding', () => {
  function simulateGroupAccess({ groupPolicy, isOwner, isMentioned }) {
    if (groupPolicy === 'disabled') return { blocked: true, reason: 'disabled' };
    return { blocked: false };
  }

  it('blocks owner mention when groupPolicy is disabled', () => {
    const result = simulateGroupAccess({
      groupPolicy: 'disabled', isOwner: true, isMentioned: true
    });
    assert.equal(result.blocked, true);
  });

  it('blocks non-owner when groupPolicy is disabled', () => {
    const result = simulateGroupAccess({
      groupPolicy: 'disabled', isOwner: false, isMentioned: false
    });
    assert.equal(result.blocked, true);
  });

  it('does not block when groupPolicy is allowlist', () => {
    const result = simulateGroupAccess({
      groupPolicy: 'allowlist', isOwner: true, isMentioned: true
    });
    assert.equal(result.blocked, false);
  });
});
