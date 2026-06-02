import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const modulePath = `../src/lib/doctor.js?t=${Date.now()}`;

const BASE = {
  enabled: true,
  dmPolicy: 'owner',
  groupPolicy: 'allowlist',
  owner: { user_id: 'u1', name: 'Felix' },
  groups: {},
  internal_port: 3463,
};

// Inject all fs/probe effects so tests touch nothing real.
const okFs = {
  existsImpl: () => true,
  statImpl: (p) => ({ mode: /config\.json$|credentials\.json$/.test(String(p)) ? 0o600 : 0o700 }),
  readFileImpl: () => 'tok',
};

function find(results, name) {
  return results.find(r => r.name === name);
}

describe('doctor', () => {
  it('reports green when service connected and everything healthy', async () => {
    const { runDoctor } = await import(modulePath);
    const results = await runDoctor(BASE, {
      ...okFs,
      statusProbe: async () => ({ reachable: true, connected: true, wsHealthy: true, ownId: 'me-123' }),
    });
    assert.equal(results.every(r => r.ok), true, JSON.stringify(results, null, 2));
    assert.match(find(results, 'live session').detail, /connected as me-123/);
    assert.equal(find(results, 'group allowlist guard').ok, true);
  });

  it('flags an unreachable service', async () => {
    const { runDoctor } = await import(modulePath);
    const results = await runDoctor(BASE, {
      ...okFs,
      statusProbe: async () => ({ reachable: false, error: 'ECONNREFUSED' }),
    });
    const live = find(results, 'live session');
    assert.equal(live.ok, false);
    assert.match(live.detail, /ECONNREFUSED|not reachable/);
  });

  it('warns on an unhealthy websocket with disconnect time', async () => {
    const { runDoctor } = await import(modulePath);
    const results = await runDoctor(BASE, {
      ...okFs,
      statusProbe: async () => ({ reachable: true, connected: true, wsHealthy: false, disconnectedSince: '2026-06-02T00:00:00Z' }),
    });
    const live = find(results, 'live session');
    assert.equal(live.ok, false);
    assert.match(live.detail, /disconnected since/);
  });

  it('flags a pending QR when not connected', async () => {
    const { runDoctor } = await import(modulePath);
    const results = await runDoctor(BASE, {
      ...okFs,
      statusProbe: async () => ({ reachable: false, error: 'down' }),
    });
    assert.equal(find(results, 'QR login').ok, false);
    assert.match(find(results, 'QR login').detail, /scan/);
  });

  it('warns about groups that allow all senders', async () => {
    const { runDoctor } = await import(modulePath);
    const cfg = { ...BASE, groups: { g1: { name: 'Open Group', allowFrom: ['*'] }, g2: { name: 'Safe', allowFrom: ['u9'] } } };
    const results = await runDoctor(cfg, {
      ...okFs,
      statusProbe: async () => ({ reachable: true, connected: true, wsHealthy: true }),
    });
    const guard = find(results, 'group allowlist guard');
    assert.equal(guard.ok, false);
    assert.match(guard.detail, /Open Group/);
    assert.doesNotMatch(guard.detail, /Safe/);
  });

  it('flags an invalid dm policy and loose config permissions', async () => {
    const { runDoctor } = await import(modulePath);
    const results = await runDoctor({ ...BASE, dmPolicy: 'bogus' }, {
      existsImpl: () => true,
      statImpl: (p) => ({ mode: /config\.json$/.test(String(p)) ? 0o644 : 0o700 }),
      readFileImpl: () => 'tok',
      statusProbe: async () => ({ reachable: true, connected: true, wsHealthy: true }),
    });
    assert.equal(find(results, 'dm policy').ok, false);
    assert.equal(find(results, 'perms: config.json').ok, false);
    assert.match(find(results, 'perms: config.json').detail, /expected 0600/);
  });
});
