import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOwnerPairingCommand,
  buildOwnerPairingDm,
  ownerPairingReplyFor,
  parseOwnerPairingCommand,
  resolveOwnerPairingCommand,
  resolveOwnerPairingCommandForSender,
  sendOwnerPairingDm
} from '../src/lib/pairing-owner.js';

function stateWith(...entries) {
  return {
    pending: Object.fromEntries(entries.map(entry => [entry.user_id, entry])),
    denied: {}
  };
}

describe('owner pairing approval helpers', () => {
  it('builds an owner DM notification for a pairing request', () => {
    const message = buildOwnerPairingDm({
      userId: 'u1',
      userName: 'Alice',
      firstMessage: 'hello'
    });

    assert.equal(message, [
      'Pairing request: Alice (u1) wants to chat.',
      'First message: "hello"',
      'Reply "approve" to allow or "deny" to reject.'
    ].join('\n'));
  });

  it('sends the owner DM notification on a pairing request', async () => {
    const calls = [];
    const sent = await sendOwnerPairingDm({
      config: { owner: { user_id: 'owner-1' } },
      userId: 'u1',
      userName: 'Alice',
      firstMessage: 'hello',
      send: async (chatId, message) => calls.push({ chatId, message })
    });

    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].chatId, 'owner-1');
    assert.match(calls[0].message, /Alice \(u1\) wants to chat/);
  });

  it('approve with uid allowlists and clears a pending request', () => {
    const state = stateWith({ user_id: 'u1', name: 'Alice', chat_id: 'chat-u1' });
    const config = { dmAllowFrom: [] };
    const resolved = resolveOwnerPairingCommand('approve u1', state);

    assert.equal(applyOwnerPairingCommand(config, state, resolved), true);
    assert.deepEqual(config.dmAllowFrom, ['u1']);
    assert.deepEqual(state.pending, {});
    assert.equal(ownerPairingReplyFor(resolved), 'Approved Alice');
  });

  it('deny with uid clears pending without allowlisting', () => {
    const state = stateWith({ user_id: 'u2', name: 'Bob', chat_id: 'chat-u2' });
    const config = { dmAllowFrom: [] };
    const resolved = resolveOwnerPairingCommand('deny u2', state);

    assert.equal(applyOwnerPairingCommand(config, state, resolved), true);
    assert.deepEqual(config.dmAllowFrom, []);
    assert.deepEqual(state.pending, {});
    assert.equal(state.denied.u2.user_id, 'u2');
    assert.equal(ownerPairingReplyFor(resolved), 'Denied Bob');
  });

  it('bare approve acts on a single pending request', () => {
    const state = stateWith({ user_id: 'u3', name: 'Cora', chat_id: 'chat-u3' });
    const config = { dmAllowFrom: [] };
    const resolved = resolveOwnerPairingCommand('approve', state);

    assert.equal(resolved.userId, 'u3');
    assert.equal(applyOwnerPairingCommand(config, state, resolved), true);
    assert.deepEqual(config.dmAllowFrom, ['u3']);
  });

  it('bare approve with multiple pending requests prompts for a uid', () => {
    const state = stateWith(
      { user_id: 'u4', name: 'Dai' },
      { user_id: 'u5', name: 'Em' }
    );
    const resolved = resolveOwnerPairingCommand('approve', state);

    assert.equal(resolved.needsUserId, true);
    assert.match(resolved.message, /Please specify a user id/);
    assert.match(resolved.message, /Dai \(u4\)/);
    assert.match(resolved.message, /Em \(u5\)/);
  });

  it('does not parse commands when no requests are pending', () => {
    assert.equal(resolveOwnerPairingCommand('approve', { pending: {}, denied: {} }), null);
    assert.equal(parseOwnerPairingCommand('approve', []), null);
  });

  it('does not hijack normal owner conversation containing approve', () => {
    const state = stateWith({ user_id: 'u6', name: 'Fran' });
    assert.equal(resolveOwnerPairingCommand('I approve this plan', state), null);
  });

  it('does not treat non-owner approve as a pairing command', () => {
    const config = { owner: { user_id: 'owner-1' } };
    const state = stateWith({ user_id: 'u7', name: 'Gia' });
    assert.equal(resolveOwnerPairingCommandForSender(config, 'u7', 'approve u7', state), null);
  });
});
