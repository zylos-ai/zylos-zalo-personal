import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupMembersCache,
  getGroupMembers,
  memberDisplayName,
} from '../src/lib/group-members.js';

describe('group-members', () => {
  it('extracts display names from member objects', () => {
    assert.equal(memberDisplayName({ dName: 'Alice' }), 'Alice');
    assert.equal(memberDisplayName({ profile: { displayName: 'Bob' } }), 'Bob');
    assert.equal(memberDisplayName({ uid: 'u1' }), null);
  });

  it('returns capped names from getGroupInfo currentMems', async () => {
    const api = {
      async getGroupInfo() {
        return {
          gridInfoMap: {
            g1: {
              totalMember: 3,
              currentMems: [
                { uid: 'u1', dName: 'Alice' },
                { uid: 'u2', displayName: 'Bob' },
                { uid: 'u3', name: 'Carol' },
              ],
            },
          },
        };
      },
    };

    const summary = await getGroupMembers(api, 'g1', { limit: 2 });
    assert.deepEqual(summary.names, ['Alice', 'Bob']);
    assert.equal(summary.total, 3);
    assert.equal(summary.capped, true);
  });

  it('resolves member ids with getGroupMembersInfo when needed', async () => {
    const calls = [];
    const api = {
      async getGroupInfo(ids) {
        calls.push(['getGroupInfo', ids]);
        return {
          gridInfoMap: {
            g1: {
              totalMember: 2,
              memberIds: ['u1', 'u2'],
            },
          },
        };
      },
      async getGroupMembersInfo(ids) {
        calls.push(['getGroupMembersInfo', ids]);
        return {
          u1: { displayName: 'Alice' },
          u2: { zaloName: 'Bob' },
        };
      },
    };

    const summary = await getGroupMembers(api, 'g1', { limit: 20 });
    assert.deepEqual(summary.names, ['Alice', 'Bob']);
    assert.deepEqual(calls, [
      ['getGroupInfo', ['g1']],
      ['getGroupMembersInfo', ['u1', 'u2']],
    ]);
  });

  it('uses TTL cache and evicts expired entries', async () => {
    const cache = createGroupMembersCache({ ttlMs: 10, maxSize: 2 });
    let calls = 0;
    const api = {
      async getGroupInfo() {
        calls++;
        return {
          gridInfoMap: {
            g1: {
              totalMember: 1,
              currentMems: [{ dName: 'Alice' }],
            },
          },
        };
      },
    };

    assert.deepEqual((await getGroupMembers(api, 'g1', { cache })).names, ['Alice']);
    assert.deepEqual((await getGroupMembers(api, 'g1', { cache })).names, ['Alice']);
    assert.equal(calls, 1);
    assert.equal(cache.sweep(Date.now() + 20), 1);
    assert.equal(cache.size(), 0);
  });
});
