import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractVoiceUrl, isVoiceMessageData, summarizeVoiceContentShape
} from '../src/lib/voice.js';

describe('voice content helpers', () => {
  it('extracts top-level voice URLs', () => {
    assert.equal(extractVoiceUrl({ href: 'https://file.zalo.me/v.m4a' }), 'https://file.zalo.me/v.m4a');
    assert.equal(extractVoiceUrl({ voiceUrl: 'https://file.zalo.me/v.aac' }), 'https://file.zalo.me/v.aac');
    assert.equal(extractVoiceUrl({ m4aUrl: 'https://file.zalo.me/v.m4a' }), 'https://file.zalo.me/v.m4a');
    assert.equal(extractVoiceUrl({ url: 'https://file.zalo.me/v.mp3' }), 'https://file.zalo.me/v.mp3');
  });

  it('parses JSON-string content before probing URLs', () => {
    const content = JSON.stringify({ href: 'https://file.zalo.me/json.m4a' });
    assert.equal(extractVoiceUrl(content), 'https://file.zalo.me/json.m4a');
  });

  it('extracts nested params and msgInfo URLs, including JSON strings', () => {
    assert.equal(
      extractVoiceUrl({ params: JSON.stringify({ voiceUrl: 'https://file.zalo.me/params.aac' }) }),
      'https://file.zalo.me/params.aac'
    );
    assert.equal(
      extractVoiceUrl({ msgInfo: { m4aUrl: 'https://file.zalo.me/info.m4a' } }),
      'https://file.zalo.me/info.m4a'
    );
  });

  it('never throws for malformed or unsupported content', () => {
    assert.equal(extractVoiceUrl('{bad json'), null);
    assert.equal(extractVoiceUrl(null), null);
    assert.equal(extractVoiceUrl({ params: { href: 123 } }), null);
  });

  it('summarizes shapes without exposing values', () => {
    assert.equal(
      summarizeVoiceContentShape(JSON.stringify({ href: 'https://secret.example/voice.m4a', params: { m4aUrl: 'https://secret.example/nested.m4a' } })),
      'json-string:object(href,params; params:object(m4aUrl))'
    );
    assert.equal(summarizeVoiceContentShape('plain text'), 'string(length=10)');
  });

  it('detects zca voice message data', () => {
    assert.equal(isVoiceMessageData({ msgType: 'chat.voice' }), true);
    assert.equal(isVoiceMessageData({ msgType: 'webchat' }), false);
  });
});
