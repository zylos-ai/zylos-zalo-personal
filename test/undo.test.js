import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUndoAwarenessText, getUndoActorId, getUndoCacheKeys,
  getUndoDeletedMessageId, getUndoThreadId
} from '../src/lib/undo.js';

describe('undo helpers', () => {
  it('extracts actor, thread, and deleted message ids from zca undo content', () => {
    const undo = {
      threadId: 'group-1',
      data: {
        uidFrom: 'fallback-user',
        idTo: 'fallback-thread',
        msgId: 'event-msg',
        content: {
          srcId: 'user-1',
          destId: 'group-1',
          globalMsgId: 'global-123',
          cliMsgId: 'cli-456',
          deleteMsg: 'deleted-789'
        }
      }
    };

    assert.equal(getUndoActorId(undo), 'user-1');
    assert.equal(getUndoThreadId(undo), 'group-1');
    assert.equal(getUndoDeletedMessageId(undo), 'global-123');
    assert.deepEqual(getUndoCacheKeys(undo), ['global-123', 'cli-456', 'deleted-789', 'event-msg']);
  });

  it('falls back to envelope ids when content is sparse', () => {
    const undo = {
      data: {
        uidFrom: 123,
        idTo: 456,
        cliMsgId: 789,
        content: null
      }
    };

    assert.equal(getUndoActorId(undo), '123');
    assert.equal(getUndoThreadId(undo), '456');
    assert.equal(getUndoDeletedMessageId(undo), '789');
    assert.deepEqual(getUndoCacheKeys(undo), ['789']);
  });

  it('formats awareness text for groups and DMs', () => {
    assert.equal(
      buildUndoAwarenessText({ isGroup: true, threadName: 'Launch Team' }),
      '[recalled a message in Launch Team]'
    );
    assert.equal(buildUndoAwarenessText({ isGroup: false }), '[recalled a message]');
  });
});
