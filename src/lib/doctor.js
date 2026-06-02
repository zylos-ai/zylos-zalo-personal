/**
 * Operator diagnostics for zylos-zalo-personal.
 *
 * On-demand health report for the personal (zca-js) channel: saved session,
 * live websocket/login status (probed via the running service's
 * /internal/status), pending QR, access-policy sanity, dangerous open-group
 * allowlists, media settings, and file permissions. All external effects are
 * injectable for testing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const CREDENTIALS_PATH = path.join(SESSIONS_DIR, 'credentials.json');
const QR_PATH = path.join(SESSIONS_DIR, 'qr.png');
const INTERNAL_TOKEN_PATH = path.join(SESSIONS_DIR, '.internal-token');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

const VALID_DM_POLICIES = ['open', 'allowlist', 'owner', 'pairing'];
const VALID_GROUP_POLICIES = ['open', 'allowlist', 'disabled'];

function check(name, ok, detail = '') {
  return { name, ok: Boolean(ok), detail };
}

function formatStatus(ok) {
  return ok ? 'ok' : 'warn';
}

export function formatDoctorReport(results) {
  return results
    .map(result => `[${formatStatus(result.ok)}] ${result.name}${result.detail ? ` - ${result.detail}` : ''}`)
    .join('\n');
}

async function defaultStatusProbe(port, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/internal/status`, {
      headers: token ? { 'X-Internal-Token': token } : {},
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { reachable: true, httpStatus: res.status };
    return { reachable: true, ...(await res.json()) };
  } catch (err) {
    clearTimeout(timer);
    return { reachable: false, error: err.message };
  }
}

function modeOf(statImpl, p) {
  return statImpl(p).mode & 0o777;
}

export async function runDoctor(config, {
  statusProbe = defaultStatusProbe,
  existsImpl = fs.existsSync,
  statImpl = fs.statSync,
  readFileImpl = fs.readFileSync,
} = {}) {
  const results = [];

  results.push(check('component enabled', config.enabled !== false,
    config.enabled === false ? 'config.enabled is false' : 'enabled'));

  // Saved session credentials.
  const hasCreds = existsImpl(CREDENTIALS_PATH);
  results.push(check('saved session', hasCreds,
    hasCreds ? 'credentials.json present' : 'no saved session — will require QR login on start'));

  // Live session health via the running service.
  let token = null;
  try { if (existsImpl(INTERNAL_TOKEN_PATH)) token = String(readFileImpl(INTERNAL_TOKEN_PATH, 'utf8')).trim(); } catch {}
  const port = config.internal_port || 3463;
  const status = await statusProbe(port, token);
  if (!status?.reachable) {
    results.push(check('live session', false,
      `service not reachable on :${port} (${status?.error || 'no response'}) — is pm2 zylos-zalo-personal running?`));
  } else if (status.httpStatus) {
    results.push(check('live session', false, `/internal/status returned HTTP ${status.httpStatus}`));
  } else {
    const connected = !!status.connected && status.wsHealthy !== false;
    let detail = connected
      ? `connected${status.ownId ? ` as ${status.ownId}` : ''}`
      : 'websocket not healthy';
    if (status.disconnectedSince) detail += `; disconnected since ${status.disconnectedSince}`;
    results.push(check('live session', connected, detail));
  }

  // Pending QR (only meaningful when not connected).
  const qrPending = existsImpl(QR_PATH);
  if (qrPending && !(status?.reachable && status?.connected)) {
    results.push(check('QR login', false, 'qr.png present — scan with the Zalo app to authenticate'));
  } else {
    results.push(check('QR login', true, qrPending ? 'authenticated (stale qr.png can be ignored)' : 'no pending QR'));
  }

  // Access-policy sanity.
  const dmPolicy = config.dmPolicy || 'owner';
  results.push(check('dm policy', VALID_DM_POLICIES.includes(dmPolicy),
    VALID_DM_POLICIES.includes(dmPolicy) ? dmPolicy : `invalid: ${dmPolicy}`));
  const groupPolicy = config.groupPolicy || 'allowlist';
  results.push(check('group policy', VALID_GROUP_POLICIES.includes(groupPolicy),
    VALID_GROUP_POLICIES.includes(groupPolicy) ? groupPolicy : `invalid: ${groupPolicy}`));

  // Dangerous open-group allowlists (mutable name/'*' matching guard).
  const groups = config.groups || {};
  const openGroups = Object.entries(groups)
    .filter(([, g]) => Array.isArray(g?.allowFrom) && g.allowFrom.includes('*'))
    .map(([id, g]) => g?.name || id);
  results.push(check('group allowlist guard', openGroups.length === 0,
    openGroups.length === 0
      ? 'no groups allow all senders'
      : `${openGroups.length} group(s) allow ALL senders (allowFrom '*'): ${openGroups.join(', ')}`));

  // Owner binding.
  const owner = config.owner || {};
  results.push(check('owner bound', !!owner.user_id,
    owner.user_id ? `${owner.name || 'unknown'} (${owner.user_id})` : 'not bound yet (binds on first owner DM)'));

  // Media settings.
  results.push(check('media download', true,
    config.features?.download_media === false ? 'disabled' : 'enabled'));

  // File permissions — session + config hold sensitive material.
  const permTargets = [
    ['config.json', path.join(DATA_DIR, 'config.json'), 0o600],
    ['data dir', DATA_DIR, 0o700],
    ['sessions dir', SESSIONS_DIR, 0o700],
    ['credentials.json', CREDENTIALS_PATH, 0o600],
  ];
  for (const [label, target, want] of permTargets) {
    try {
      if (!existsImpl(target)) {
        if (label === 'credentials.json') continue; // optional until first login
        results.push(check(`perms: ${label}`, false, 'missing'));
        continue;
      }
      const mode = modeOf(statImpl, target);
      results.push(check(`perms: ${label}`, mode === want,
        `0${mode.toString(8)}${mode === want ? '' : ` (expected 0${want.toString(8)})`}`));
    } catch (err) {
      results.push(check(`perms: ${label}`, false, err.message));
    }
  }

  return results;
}
