import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplyTo,
  cacheKeysForMessage,
  cacheRecordFromMessage,
  truncateReplyBody,
} from '../src/lib/reply-to.js';

describe('reply-to', () => {
  it('indexes messages by globalMsgId, msgId, and cliMsgId', () => {
    assert.deepEqual(cacheKeysForMessage({
      globalMsgId: 'global-1',
      msgId: 'msg-1',
      cliMsgId: 'cli-1',
    }), ['global-1', 'msg-1', 'cli-1']);
  });

  it('builds replyTo from inbound quote fields', () => {
    const replyTo = buildReplyTo({
      quote: {
        globalMsgId: 'global-1',
        cliMsgId: 'cli-1',
        ownerId: 'u1',
        msg: 'quoted body',
      },
    }, new Map());

    assert.deepEqual(replyTo, {
      messageId: 'global-1',
      body: 'quoted body',
      fromUserId: 'u1',
    });
  });

  it('falls back to cached quote content and sender by cliMsgId', () => {
    const cache = new Map();
    const cached = cacheRecordFromMessage({
      globalMsgId: 'global-original',
      cliMsgId: 'cli-original',
      uidFrom: 'u2',
      content: 'cached quoted body',
    });
    cache.set('cli-original', cached);

    const replyTo = buildReplyTo({
      quote: {
        cliMsgId: 'cli-original',
      },
    }, cache);

    assert.deepEqual(replyTo, {
      messageId: 'cli-original',
      body: 'cached quoted body',
      fromUserId: 'u2',
    });
  });

  it('truncates reply body to 100 chars', () => {
    const body = 'x'.repeat(120);
    assert.equal(truncateReplyBody(body).length, 100);
    assert.match(truncateReplyBody(body), /\.\.\.$/);
  });

  it('returns null without quote identifiers', () => {
    assert.equal(buildReplyTo({ quote: { msg: 'body only' } }, new Map()), null);
  });
});
