import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntries, filterByName, extractId, extractName } from '../src/lib/directory.js';

describe('directory', () => {
  it('normalizes an array of friends with varied field names', () => {
    const raw = [
      { userId: '111', displayName: 'Alice' },
      { uid: '222', zaloName: 'Bob' },
      { id: '333', name: 'Carol' },
    ];
    assert.deepEqual(normalizeEntries(raw), [
      { id: '111', name: 'Alice' },
      { id: '222', name: 'Bob' },
      { id: '333', name: 'Carol' },
    ]);
  });

  it('normalizes an object map and a {data} wrapper, dedupes by id', () => {
    const map = { g1: { groupId: 'g1', name: 'Group One' }, g2: { groupId: 'g2', name: 'Group Two' } };
    assert.deepEqual(normalizeEntries(map), [
      { id: 'g1', name: 'Group One' },
      { id: 'g2', name: 'Group Two' },
    ]);
    const wrapped = { data: [{ id: 'x', name: 'X' }, { id: 'x', name: 'dup' }] };
    assert.deepEqual(normalizeEntries(wrapped), [{ id: 'x', name: 'X' }]);
  });

  it('filters by name or id substring, case-insensitive', () => {
    const entries = [
      { id: '111', name: 'Alice Nguyen' },
      { id: '222', name: 'Bob Tran' },
      { id: '99alice', name: 'Zed' },
    ];
    assert.deepEqual(filterByName(entries, 'alice').map(e => e.id), ['111', '99alice']);
    assert.deepEqual(filterByName(entries, 'TRAN').map(e => e.id), ['222']);
    assert.equal(filterByName(entries, '').length, 3);
  });

  it('extractId/extractName tolerate missing fields', () => {
    assert.equal(extractId({}), null);
    assert.equal(extractName({}), '');
    assert.equal(extractId({ gid: 'g9' }), 'g9');
  });
});
