import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpHome;
let origHome;

async function freshImport(modulePath) {
  return import(`../${modulePath}?t=${Date.now()}-${Math.random()}`);
}

function setupTmpHome() {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-personal-transcribe-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
}

function teardownTmpHome() {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

describe('transcription provider', () => {
  beforeEach(setupTmpHome);
  afterEach(teardownTmpHome);

  it('returns disabled when configured disabled', async () => {
    const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
    assert.deepEqual(getTranscriptionProvider('disabled'), { available: false, provider: 'disabled' });
  });

  it('uses OpenAI API fallback when configured', async () => {
    const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
    assert.deepEqual(getTranscriptionProvider('api', { OPENAI_API_KEY: 'sk-test' }), {
      available: true,
      provider: 'openai-api'
    });
  });

  it('is unavailable for api mode without a key', async () => {
    const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
    assert.equal(getTranscriptionProvider('api', {}).available, false);
  });

  it('warns when whisper binary exists without model path', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-whisper-bin-'));
    const oldPath = process.env.PATH;
    const oldWarn = console.warn;
    const warnings = [];
    try {
      const whisperPath = path.join(binDir, 'whisper-cli');
      fs.writeFileSync(whisperPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`;
      console.warn = (message) => warnings.push(String(message));

      const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
      const provider = getTranscriptionProvider('local', {}, { modelPath: '' });

      assert.equal(provider.available, false);
      assert.ok(warnings.some(message => message.includes('whisper-cli found but WHISPER_MODEL not set')));
    } finally {
      console.warn = oldWarn;
      process.env.PATH = oldPath;
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('memoizes provider detection', async () => {
    const binDir = path.join(tmpHome, 'zylos/bin');
    fs.mkdirSync(binDir, { recursive: true });
    const transcribePath = path.join(binDir, 'transcribe');
    fs.writeFileSync(transcribePath, '#!/bin/sh\necho ok\n', { mode: 0o755 });

    const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
    const provider = getTranscriptionProvider('auto', {});
    fs.unlinkSync(transcribePath);

    assert.deepEqual(getTranscriptionProvider('auto', {}), provider);
  });

  it('reads audio asynchronously on the OpenAI path', async () => {
    const audioPath = path.join(tmpHome, 'voice.wav');
    fs.writeFileSync(audioPath, 'audio-bytes');
    const originalFetch = globalThis.fetch;
    const originalReadFileSync = fs.readFileSync;
    globalThis.fetch = async () => new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
    fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
      if (String(filePath) === audioPath) throw new Error('sync read should not be used');
      return originalReadFileSync.call(this, filePath, ...args);
    };

    try {
      const { transcribeAudio } = await freshImport('src/lib/transcribe.js');
      const text = await transcribeAudio(audioPath, {
        provider: { available: true, provider: 'openai-api' },
        env: { OPENAI_API_KEY: 'sk-test' }
      });
      assert.equal(text, 'hello');
    } finally {
      globalThis.fetch = originalFetch;
      fs.readFileSync = originalReadFileSync;
    }
  });
});
