import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('source conformance', () => {
  it('does not fetch group members during ordinary inbound message formatting', () => {
    const source = fs.readFileSync('src/index.js', 'utf8');
    assert.equal(source.includes('getGroupMembersSummary'), false);

    const getGroupMembersCalls = [...source.matchAll(/getGroupMembers\(api,/g)];
    assert.equal(getGroupMembersCalls.length, 1);
    const callIndex = getGroupMembersCalls[0].index;
    const groupInfoRouteIndex = source.indexOf("requestPath === '/internal/group-info'");
    assert.ok(groupInfoRouteIndex >= 0);
    assert.ok(callIndex > groupInfoRouteIndex);
  });
});
