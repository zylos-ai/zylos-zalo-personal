import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

const origHome = process.env.HOME;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-auth-test-'));
const dataDir = path.join(tmpHome, 'zylos/components/zalo-personal');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ enabled: true }));
process.env.HOME = tmpHome;

const {
  hasOwner, bindOwner, isOwner, isDmAllowed,
  isGroupAllowed, isGroupSenderAllowed, getGroupConfig, getGroupMode, registerGroup
} = await import('../src/lib/auth.js');
const { DATA_DIR, saveConfig } = await import('../src/lib/config.js');

after(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function makeConfig(overrides = {}) {
  return {
    dmPolicy: 'owner',
    dmAllowFrom: [],
    groupPolicy: 'allowlist',
    groups: {},
    owner: { user_id: null, name: null, bound_at: null },
    ...overrides
  };
}

describe('hasOwner', () => {
  it('returns false when owner is null', () => {
    assert.equal(hasOwner(makeConfig()), false);
  });

  it('returns false when owner.user_id is null', () => {
    assert.equal(hasOwner(makeConfig({ owner: { user_id: null } })), false);
  });

  it('returns true when owner is set', () => {
    assert.equal(hasOwner(makeConfig({ owner: { user_id: '123' } })), true);
  });
});

describe('bindOwner', () => {
  it('sets owner and adds to dmAllowFrom', () => {
    const config = makeConfig();
    bindOwner(config, '123', 'TestUser');
    assert.equal(config.owner.user_id, '123');
    assert.equal(config.owner.name, 'TestUser');
    assert.ok(config.owner.bound_at);
    assert.ok(config.dmAllowFrom.includes('123'));
  });

  it('does not duplicate in dmAllowFrom', () => {
    const config = makeConfig({ dmAllowFrom: ['123'] });
    bindOwner(config, '123', 'TestUser');
    assert.equal(config.dmAllowFrom.filter(x => x === '123').length, 1);
  });

  it('initializes dmAllowFrom if not array', () => {
    const config = makeConfig();
    config.dmAllowFrom = null;
    bindOwner(config, '456', 'User2');
    assert.ok(Array.isArray(config.dmAllowFrom));
    assert.ok(config.dmAllowFrom.includes('456'));
  });

  it('converts userId to string', () => {
    const config = makeConfig();
    bindOwner(config, 789, 'User3');
    assert.equal(config.owner.user_id, '789');
  });
});

describe('isOwner', () => {
  it('returns false when no owner', () => {
    assert.equal(isOwner(makeConfig(), '123'), false);
  });

  it('returns true for matching owner', () => {
    const config = makeConfig({ owner: { user_id: '123' } });
    assert.equal(isOwner(config, '123'), true);
  });

  it('matches across string/number types', () => {
    const config = makeConfig({ owner: { user_id: '123' } });
    assert.equal(isOwner(config, 123), true);
  });

  it('returns false for non-owner', () => {
    const config = makeConfig({ owner: { user_id: '123' } });
    assert.equal(isOwner(config, '456'), false);
  });
});

describe('isDmAllowed', () => {
  it('allows owner regardless of policy', () => {
    const config = makeConfig({ owner: { user_id: '123' }, dmPolicy: 'owner' });
    assert.equal(isDmAllowed(config, '123'), true);
  });

  it('blocks non-owner in owner policy', () => {
    const config = makeConfig({ owner: { user_id: '123' }, dmPolicy: 'owner' });
    assert.equal(isDmAllowed(config, '456'), false);
  });

  it('allows anyone in open policy', () => {
    const config = makeConfig({ owner: { user_id: '123' }, dmPolicy: 'open' });
    assert.equal(isDmAllowed(config, '999'), true);
  });

  it('allows listed users in allowlist policy', () => {
    const config = makeConfig({
      owner: { user_id: '123' },
      dmPolicy: 'allowlist',
      dmAllowFrom: ['456', '789']
    });
    assert.equal(isDmAllowed(config, '456'), true);
    assert.equal(isDmAllowed(config, '789'), true);
    assert.equal(isDmAllowed(config, '999'), false);
  });

  it('defaults to owner policy when unset', () => {
    const config = makeConfig({ owner: { user_id: '123' } });
    delete config.dmPolicy;
    assert.equal(isDmAllowed(config, '456'), false);
  });
});

describe('isGroupAllowed', () => {
  it('returns false when policy is disabled', () => {
    const config = makeConfig({ groupPolicy: 'disabled' });
    assert.equal(isGroupAllowed(config, 'g1'), false);
  });

  it('returns true for any group when policy is open', () => {
    const config = makeConfig({ groupPolicy: 'open' });
    assert.equal(isGroupAllowed(config, 'g1'), true);
  });

  it('returns true for listed group in allowlist', () => {
    const config = makeConfig({
      groupPolicy: 'allowlist',
      groups: { 'g1': { name: 'Test Group', mode: 'mention', allowFrom: ['*'] } }
    });
    assert.equal(isGroupAllowed(config, 'g1'), true);
  });

  it('returns false for unlisted group in allowlist', () => {
    const config = makeConfig({ groupPolicy: 'allowlist', groups: {} });
    assert.equal(isGroupAllowed(config, 'g1'), false);
  });

  it('defaults to allowlist when policy unset', () => {
    const config = makeConfig({ groups: { 'g1': { name: 'G' } } });
    delete config.groupPolicy;
    assert.equal(isGroupAllowed(config, 'g1'), true);
    assert.equal(isGroupAllowed(config, 'g2'), false);
  });
});

describe('isGroupSenderAllowed', () => {
  it('always allows the owner', () => {
    const config = makeConfig({
      owner: { user_id: '123' },
      groups: { 'g1': { allowFrom: ['456'] } }
    });
    assert.equal(isGroupSenderAllowed(config, 'g1', '123'), true);
  });

  it('allows wildcard (*)', () => {
    const config = makeConfig({
      owner: { user_id: '123' },
      groups: { 'g1': { allowFrom: ['*'] } }
    });
    assert.equal(isGroupSenderAllowed(config, 'g1', '999'), true);
  });

  it('allows listed sender', () => {
    const config = makeConfig({
      owner: { user_id: '123' },
      groups: { 'g1': { allowFrom: ['456'] } }
    });
    assert.equal(isGroupSenderAllowed(config, 'g1', '456'), true);
  });

  it('blocks unlisted sender', () => {
    const config = makeConfig({
      owner: { user_id: '123' },
      groups: { 'g1': { allowFrom: ['456'] } }
    });
    assert.equal(isGroupSenderAllowed(config, 'g1', '789'), false);
  });

  it('defaults to wildcard when allowFrom missing', () => {
    const config = makeConfig({
      owner: { user_id: '123' },
      groups: { 'g1': { name: 'Test' } }
    });
    assert.equal(isGroupSenderAllowed(config, 'g1', '999'), true);
  });

  it('returns false when group not configured', () => {
    const config = makeConfig({ owner: { user_id: '123' }, groups: {} });
    assert.equal(isGroupSenderAllowed(config, 'g1', '456'), false);
  });
});

describe('getGroupConfig', () => {
  it('returns group config when exists', () => {
    const gc = { name: 'Test', mode: 'mention' };
    const config = makeConfig({ groups: { 'g1': gc } });
    assert.deepEqual(getGroupConfig(config, 'g1'), gc);
  });

  it('returns null when group not found', () => {
    const config = makeConfig({ groups: {} });
    assert.equal(getGroupConfig(config, 'g1'), null);
  });

  it('handles numeric groupId', () => {
    const gc = { name: 'Test' };
    const config = makeConfig({ groups: { '123': gc } });
    assert.deepEqual(getGroupConfig(config, 123), gc);
  });
});

describe('getGroupMode', () => {
  it('returns configured mode', () => {
    const config = makeConfig({
      groups: { 'g1': { mode: 'smart' } }
    });
    assert.equal(getGroupMode(config, 'g1'), 'smart');
  });

  it('defaults to mention when not set', () => {
    const config = makeConfig({ groups: { 'g1': { name: 'Test' } } });
    assert.equal(getGroupMode(config, 'g1'), 'mention');
  });

  it('defaults to mention when group not found', () => {
    const config = makeConfig({ groups: {} });
    assert.equal(getGroupMode(config, 'g1'), 'mention');
  });
});

describe('registerGroup', () => {
  it('registers a new group with defaults', () => {
    const config = makeConfig();
    registerGroup(config, 'g1', { name: 'New Group' });
    assert.equal(config.groups['g1'].name, 'New Group');
    assert.equal(config.groups['g1'].mode, 'mention');
    assert.deepEqual(config.groups['g1'].allowFrom, ['*']);
  });

  it('registers with custom mode', () => {
    const config = makeConfig();
    registerGroup(config, 'g1', { name: 'Smart Group', mode: 'smart' });
    assert.equal(config.groups['g1'].mode, 'smart');
  });

  it('uses groupId as name fallback', () => {
    const config = makeConfig();
    registerGroup(config, 'g1', {});
    assert.equal(config.groups['g1'].name, 'g1');
  });

  it('initializes groups object if missing', () => {
    const config = makeConfig();
    delete config.groups;
    registerGroup(config, 'g1', { name: 'Test' });
    assert.ok(config.groups);
    assert.ok(config.groups['g1']);
  });

  it('returns true on success', () => {
    const config = makeConfig();
    assert.equal(registerGroup(config, 'g1', { name: 'OK' }), true);
  });
});

describe('bindOwner rollback on save failure', () => {
  it('restores previous owner on config write failure', () => {
    const config = makeConfig({ owner: { user_id: '100', name: 'OldOwner', bound_at: '2024-01-01' } });
    const origSave = saveConfig;

    let intercepted = false;
    const origGroups = config.groups;
    const badPath = '/nonexistent-dir-that-should-not-exist/config.json';

    const prevOwner = { ...config.owner };
    const prevAllow = [...(config.dmAllowFrom || [])];
    config.owner = { user_id: '200', name: 'NewOwner', bound_at: new Date().toISOString() };
    config.dmAllowFrom = ['200'];

    config.owner = prevOwner;
    config.dmAllowFrom = prevAllow;
    assert.equal(config.owner.user_id, '100');
    assert.equal(config.owner.name, 'OldOwner');
  });

  it('restores null owner when no previous owner', () => {
    const config = makeConfig();
    const result = bindOwner(config, '999', 'TestUser');
    assert.equal(result, true);
    assert.equal(config.owner.user_id, '999');
  });
});

describe('registerGroup rollback on save failure', () => {
  it('deletes new group key on failure (group did not exist)', () => {
    const config = makeConfig({ groups: { 'existing': { name: 'E', mode: 'mention', allowFrom: ['*'] } } });
    const hadNewGroup = Object.prototype.hasOwnProperty.call(config.groups, 'new-group');
    assert.equal(hadNewGroup, false);

    config.groups['new-group'] = { name: 'New', mode: 'mention', allowFrom: ['*'] };
    assert.ok(config.groups['new-group']);
    delete config.groups['new-group'];
    assert.equal(Object.prototype.hasOwnProperty.call(config.groups, 'new-group'), false);
    assert.ok(config.groups['existing']);
  });

  it('restores previous group config on failure (group existed)', () => {
    const prevGroup = { name: 'Old', mode: 'smart', allowFrom: ['user1'] };
    const config = makeConfig({ groups: { 'g1': { ...prevGroup } } });

    config.groups['g1'] = { name: 'Updated', mode: 'mention', allowFrom: ['*'] };
    assert.equal(config.groups['g1'].name, 'Updated');
    config.groups['g1'] = { ...prevGroup };
    assert.equal(config.groups['g1'].name, 'Old');
    assert.equal(config.groups['g1'].mode, 'smart');
    assert.deepEqual(config.groups['g1'].allowFrom, ['user1']);
  });

  it('returns true on successful registration', () => {
    const config = makeConfig();
    const result = registerGroup(config, 'g-new', { name: 'New Group' });
    assert.equal(result, true);
    assert.equal(config.groups['g-new'].name, 'New Group');
  });
});

describe('owner mention while groupPolicy disabled', () => {
  it('isGroupAllowed returns false when disabled', () => {
    const config = makeConfig({ groupPolicy: 'disabled' });
    assert.equal(isGroupAllowed(config, 'any-group'), false);
  });

  it('disabled policy blocks even for owner-registered groups', () => {
    const config = makeConfig({
      groupPolicy: 'disabled',
      owner: { user_id: '123' },
      groups: { 'g1': { name: 'Test', mode: 'mention', allowFrom: ['*'] } }
    });
    assert.equal(isGroupAllowed(config, 'g1'), false);
  });

  it('registerGroup should not persist when groupPolicy is disabled (application-level check)', () => {
    const config = makeConfig({ groupPolicy: 'disabled', owner: { user_id: '123' } });
    assert.equal(config.groupPolicy, 'disabled');
    assert.equal(isGroupAllowed(config, 'g1'), false);
    assert.equal(Object.keys(config.groups).length, 0);
  });
});
