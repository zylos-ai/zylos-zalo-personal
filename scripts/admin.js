#!/usr/bin/env node
/**
 * zylos-zalo-personal admin CLI
 *
 * Usage: node scripts/admin.js <command> [args]
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, DATA_DIR } from '../src/lib/config.js';

// Call the running service's internal API (zca-js needs the live session).
async function callService(action, chatId = '_') {
  const config = loadConfig();
  const port = config.internal_port || 3463;
  let token;
  try {
    token = fs.readFileSync(path.join(DATA_DIR, 'sessions', '.internal-token'), 'utf8').trim();
  } catch {
    throw new Error('cannot read internal token — is the service running? (pm2 zylos-zalo-personal)');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/internal/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify({ chatId, action }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`service returned ${resp.status}`);
    return resp.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('service request timed out');
    throw err;
  }
}

const commands = {
  show: () => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  },

  'set-dm-policy': (policy) => {
    const valid = ['open', 'allowlist', 'owner', 'pairing'];
    policy = String(policy || '').trim().toLowerCase();
    if (!valid.includes(policy)) {
      console.error(`Usage: admin.js set-dm-policy <${valid.join('|')}>`);
      process.exit(1);
    }
    const config = loadConfig();
    config.dmPolicy = policy;
    if (!saveConfig(config)) { console.error('[zalo-personal] Failed to save config'); process.exit(1); }
    console.log(`DM policy set to: ${policy}`);
    console.log('Run: pm2 restart zylos-zalo-personal');
  },

  'add-dm-allow': (userId) => {
    if (!userId) { console.error('Usage: admin.js add-dm-allow <user_id>'); process.exit(1); }
    const config = loadConfig();
    if (!Array.isArray(config.dmAllowFrom)) config.dmAllowFrom = [];
    if (!config.dmAllowFrom.includes(userId)) {
      config.dmAllowFrom.push(userId);
      if (!saveConfig(config)) { console.error('[zalo-personal] Failed to save config'); process.exit(1); }
      console.log(`Added ${userId} to dmAllowFrom`);
    } else {
      console.log(`${userId} already in dmAllowFrom`);
    }
    console.log('Run: pm2 restart zylos-zalo-personal');
  },

  'remove-dm-allow': (userId) => {
    if (!userId) { console.error('Usage: admin.js remove-dm-allow <user_id>'); process.exit(1); }
    const config = loadConfig();
    const idx = (config.dmAllowFrom || []).indexOf(userId);
    if (idx >= 0) {
      config.dmAllowFrom.splice(idx, 1);
      if (!saveConfig(config)) { console.error('[zalo-personal] Failed to save config'); process.exit(1); }
      console.log(`Removed ${userId} from dmAllowFrom`);
    } else {
      console.log(`${userId} not found in dmAllowFrom`);
    }
  },

  'set-dm-welcome': (...parts) => {
    const message = parts.join(' ').trim();
    if (!message) { console.error('Usage: admin.js set-dm-welcome <message>'); process.exit(1); }
    const config = loadConfig();
    config.dmWelcomeMessage = message;
    if (!saveConfig(config)) { console.error('[zalo-personal] Failed to save config'); process.exit(1); }
    console.log('DM welcome message updated');
    console.log('Run: pm2 restart zylos-zalo-personal');
  },

  'show-dm-welcome': () => {
    const config = loadConfig();
    console.log(config.dmWelcomeMessage || '(disabled)');
  },

  'clear-dm-welcome': () => {
    const config = loadConfig();
    config.dmWelcomeMessage = '';
    if (!saveConfig(config)) { console.error('[zalo-personal] Failed to save config'); process.exit(1); }
    console.log('DM welcome message disabled');
  },

  'dm-pending': async () => {
    const { listPending } = await import('../src/lib/dm-pairing.js');
    const pending = listPending();
    if (!pending.length) { console.log('No pending DM access requests.'); return; }
    console.log(`Pending DM access requests (${pending.length}):`);
    for (const p of pending) {
      console.log(`  ${p.name || 'unknown'} (${p.user_id}) — requested ${p.requested_at}`);
      if (p.first_message) console.log(`    first message: ${p.first_message}`);
    }
  },

  'dm-approve': async (userId) => {
    if (!userId) { console.error('Usage: admin.js dm-approve <user_id>'); process.exit(1); }
    const { loadPairingState, savePairingState, approvePairingUser } = await import('../src/lib/dm-pairing.js');
    const config = loadConfig();
    const state = loadPairingState();
    approvePairingUser(config, userId, state);
    if (!saveConfig(config)) { console.error('[zalo-personal] Failed to save config'); process.exit(1); }
    savePairingState(state);
    console.log(`Approved ${userId} — added to dmAllowFrom.`);
    console.log('Run: pm2 restart zylos-zalo-personal');
  },

  'dm-deny': async (userId, ...reasonParts) => {
    if (!userId) { console.error('Usage: admin.js dm-deny <user_id> [reason]'); process.exit(1); }
    const { loadPairingState, savePairingState, denyPairingUser } = await import('../src/lib/dm-pairing.js');
    const config = loadConfig();
    const state = loadPairingState();
    denyPairingUser(config, userId, reasonParts.join(' '), state);
    if (!saveConfig(config)) { console.error('[zalo-personal] Failed to save config'); process.exit(1); }
    savePairingState(state);
    console.log(`Denied ${userId}.`);
  },

  'list-friends': async () => {
    const { normalizeEntries } = await import('../src/lib/directory.js');
    const res = await callService({ type: 'getAllFriends' });
    const entries = normalizeEntries(res?.data);
    if (!entries.length) { console.log('No friends found.'); return; }
    console.log(`Friends (${entries.length}):`);
    for (const e of entries) console.log(`  ${e.name || '(no name)'} — ${e.id}`);
  },

  'list-groups': async () => {
    const { normalizeEntries } = await import('../src/lib/directory.js');
    const res = await callService({ type: 'getAllGroups' });
    const entries = normalizeEntries(res?.data);
    if (!entries.length) { console.log('No groups found.'); return; }
    console.log(`Groups (${entries.length}):`);
    for (const e of entries) console.log(`  ${e.name || '(no name)'} — ${e.id}`);
  },

  resolve: async (...queryParts) => {
    const query = queryParts.join(' ').trim();
    if (!query) { console.error('Usage: admin.js resolve <name-or-id>'); process.exit(1); }
    const { normalizeEntries, filterByName } = await import('../src/lib/directory.js');
    const [friendsRes, groupsRes] = await Promise.all([
      callService({ type: 'getAllFriends' }).catch(() => ({})),
      callService({ type: 'getAllGroups' }).catch(() => ({})),
    ]);
    const friends = filterByName(normalizeEntries(friendsRes?.data), query);
    const groups = filterByName(normalizeEntries(groupsRes?.data), query);
    if (!friends.length && !groups.length) { console.log(`No friends or groups match "${query}".`); return; }
    if (friends.length) {
      console.log(`Friends matching "${query}" (${friends.length}):`);
      for (const e of friends) console.log(`  ${e.name || '(no name)'} — ${e.id}`);
    }
    if (groups.length) {
      console.log(`Groups matching "${query}" (${groups.length}):`);
      for (const e of groups) console.log(`  ${e.name || '(no name)'} — ${e.id}`);
    }
  },

  doctor: async () => {
    const config = loadConfig();
    const { runDoctor, formatDoctorReport } = await import('../src/lib/doctor.js');
    const results = await runDoctor(config);
    console.log(formatDoctorReport(results));
    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      console.log(`\n${failed.length} check(s) need attention.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll checks passed.');
    }
  },

  help: () => {
    console.log(`
zylos-zalo-personal admin CLI

Commands:
  show                                          Show current config
  doctor                                        Run operator health checks

  DM access:
  set-dm-policy <open|allowlist|owner|pairing>  Set DM policy
  add-dm-allow <user_id>                        Add user to dmAllowFrom
  remove-dm-allow <user_id>                     Remove user from dmAllowFrom
  set-dm-welcome <message>                      Set first-contact DM welcome
  show-dm-welcome / clear-dm-welcome            Show / disable DM welcome

  DM pairing (dmPolicy: pairing):
  dm-pending                                    List pending access requests
  dm-approve <user_id>                          Approve a pending request
  dm-deny <user_id> [reason]                    Deny a request

  Directory (requires running service):
  list-friends                                  List friends (name — id)
  list-groups                                   List groups (name — id)
  resolve <name-or-id>                          Find friends/groups matching a query

  help                                          Show this help
`);
  }
};

const args = process.argv.slice(2);
const command = args[0] || 'help';

if (commands[command]) {
  const result = commands[command](...args.slice(1));
  if (result && typeof result.then === 'function') {
    result.catch(err => {
      console.error(`[zalo-personal] ${err.message}`);
      process.exit(1);
    });
  }
} else {
  console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(1);
}
