import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scriptPath = path.resolve('scripts/admin.js');
const TEST_TOKEN = 'test-token';

let tmpDir;
let origHome;
let server;
let port;
let handler;

function runAdmin(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [scriptPath, ...args], {
      cwd: path.resolve('.'),
      env: { ...process.env, HOME: tmpDir },
      encoding: 'utf8',
      timeout: 10000,
    }, (err, stdout, stderr) => {
      resolve({
        code: err?.code || 0,
        stdout,
        stderr,
      });
    });
  });
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-admin-test-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;

  const dataDir = path.join(tmpDir, 'zylos/components/zalo-personal');
  const sessionsDir = path.join(dataDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(sessionsDir, '.internal-token'), TEST_TOKEN, { mode: 0o600 });

  server = http.createServer((req, res) => handler(req, res));
  port = await listen(server);
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ internal_port: port }, null, 2), { mode: 0o600 });
});

afterEach(async () => {
  process.env.HOME = origHome;
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('admin group-info', () => {
  it('prints group member names from the running service', async () => {
    handler = (req, res) => {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers['x-internal-token'], TEST_TOKEN);
      const url = new URL(req.url, 'http://127.0.0.1');
      assert.equal(url.pathname, '/internal/group-info');
      assert.equal(url.searchParams.get('threadId'), 'group 1');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: true,
        threadId: 'group 1',
        names: ['Alice', 'Bob'],
        total: 3,
        capped: true,
      }));
    };

    const res = await runAdmin(['group-info', 'group 1']);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Group group 1 members \(2\/3\):/);
    assert.match(res.stdout, /Alice/);
    assert.match(res.stdout, /Bob/);
    assert.match(res.stdout, /\.\.\. 1 more/);
  });

  it('surfaces service errors', async () => {
    handler = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: false,
        error: 'not connected',
      }));
    };

    const res = await runAdmin(['group-info', 'g1']);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /service returned 503: not connected/);
  });
});
