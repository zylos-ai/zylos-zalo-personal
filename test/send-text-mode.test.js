import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const scriptPath = path.resolve('scripts/send.js');

describe('send.js textMode', () => {
  let tmpHome;
  let dataDir;
  let server;
  let port;
  let actions;
  let origHome;

  beforeEach(async () => {
    origHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-send-mode-'));
    dataDir = path.join(tmpHome, 'zylos/components/zalo-personal');
    const sessionsDir = path.join(dataDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, '.internal-token'), 'test-token', { mode: 0o600 });
    actions = [];

    server = http.createServer((req, res) => {
      if (req.headers['x-internal-token'] !== 'test-token') {
        res.writeHead(403).end('forbidden');
        return;
      }

      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        if (req.url === '/internal/send') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          actions.push(body.action);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === '/internal/clear-thinking') {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === '/internal/record-outgoing') {
          res.writeHead(200).end('ok');
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  async function runSend(textMode) {
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
      internal_port: port,
      message: { textMode }
    }));
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, 'chat-1|type:dm|req:req-1'], {
        env: { ...process.env, HOME: tmpHome },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `send.js exited ${code}`));
      });
      child.stdin.end('Hello **bold**');
    });
    return actions.at(-1);
  }

  it('parses markdown by default', async () => {
    const action = await runSend('markdown');

    assert.equal(action.text, 'Hello bold');
    assert.deepEqual(action.styles, [{ start: 6, len: 4, st: 'b' }]);
  });

  it('honors plain mode as markdown opt-out', async () => {
    const action = await runSend('plain');

    assert.equal(action.text, 'Hello **bold**');
    assert.deepEqual(action.styles, []);
  });
});
