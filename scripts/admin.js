#!/usr/bin/env node
/**
 * zylos-zalo-personal admin CLI
 *
 * Usage: node scripts/admin.js <command> [args]
 */

import { loadConfig } from '../src/lib/config.js';

const commands = {
  show: () => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
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
  show          Show current config
  doctor        Run operator health checks (session, websocket, policy, perms)
  help          Show this help
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
