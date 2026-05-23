import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'dns/promises';
import {
  isPrivateIp, isAllowedDownloadHost, isIpLikeHostname, validateUrlSyntax
} from '../src/lib/url-validator.js';

async function validateDownloadUrl(url) {
  const check = validateUrlSyntax(url);
  if (!check.valid) return false;
  try {
    const { address } = await dns.lookup(check.hostname);
    if (isPrivateIp(address)) return false;
  } catch { return false; }
  return true;
}

describe('isPrivateIp', () => {
  it('rejects loopback 127.x.x.x', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('127.255.255.255'), true);
  });

  it('rejects 10.x.x.x', () => {
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('10.255.0.1'), true);
  });

  it('rejects 172.16-31.x.x', () => {
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('172.31.255.255'), true);
  });

  it('rejects 192.168.x.x', () => {
    assert.equal(isPrivateIp('192.168.0.1'), true);
    assert.equal(isPrivateIp('192.168.255.255'), true);
  });

  it('rejects link-local 169.254.x.x', () => {
    assert.equal(isPrivateIp('169.254.169.254'), true);
    assert.equal(isPrivateIp('169.254.0.1'), true);
  });

  it('rejects 0.x.x.x', () => {
    assert.equal(isPrivateIp('0.0.0.0'), true);
  });

  it('rejects IPv6 loopback', () => {
    assert.equal(isPrivateIp('::1'), true);
  });

  it('rejects IPv6 private ranges', () => {
    assert.equal(isPrivateIp('fc00::1'), true);
    assert.equal(isPrivateIp('fe80::1'), true);
    assert.equal(isPrivateIp('fd12::1'), true);
  });

  it('allows public IPs', () => {
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('1.1.1.1'), false);
    assert.equal(isPrivateIp('203.0.113.1'), false);
  });
});

describe('isAllowedDownloadHost', () => {
  it('allows Zalo CDN hosts', () => {
    assert.equal(isAllowedDownloadHost('photo.zdn.vn'), true);
    assert.equal(isAllowedDownloadHost('files.zadn.vn'), true);
    assert.equal(isAllowedDownloadHost('cdn.dlfl.vn'), true);
    assert.equal(isAllowedDownloadHost('static.zaloapp.com'), true);
    assert.equal(isAllowedDownloadHost('file.zalo.me'), true);
    assert.equal(isAllowedDownloadHost('cdn.zalo.vn'), true);
  });

  it('rejects non-Zalo hosts', () => {
    assert.equal(isAllowedDownloadHost('evil.com'), false);
    assert.equal(isAllowedDownloadHost('google.com'), false);
    assert.equal(isAllowedDownloadHost('zdn.vn.evil.com'), false);
  });
});

describe('isIpLikeHostname', () => {
  it('rejects dotted IPv4', () => {
    assert.equal(isIpLikeHostname('127.0.0.1'), true);
    assert.equal(isIpLikeHostname('192.168.1.1'), true);
    assert.equal(isIpLikeHostname('0.0.0.0'), true);
  });

  it('rejects IPv6 bracket notation', () => {
    assert.equal(isIpLikeHostname('[::1]'), true);
    assert.equal(isIpLikeHostname('[fe80::1]'), true);
  });

  it('rejects numeric-only (decimal encoding)', () => {
    assert.equal(isIpLikeHostname('2130706433'), true);
  });

  it('rejects hex-prefixed', () => {
    assert.equal(isIpLikeHostname('0x7f000001'), true);
    assert.equal(isIpLikeHostname('0xC0A80101'), true);
  });

  it('rejects octal-prefixed', () => {
    assert.equal(isIpLikeHostname('0177.0.0.1'), true);
    assert.equal(isIpLikeHostname('0300.0250.0.1'), true);
  });

  it('allows normal hostnames', () => {
    assert.equal(isIpLikeHostname('photo.zdn.vn'), false);
    assert.equal(isIpLikeHostname('example.com'), false);
    assert.equal(isIpLikeHostname('cdn.zaloapp.com'), false);
  });
});

describe('validateUrlSyntax', () => {
  it('accepts valid Zalo CDN HTTPS URLs', () => {
    const r = validateUrlSyntax('https://photo.zdn.vn/image.jpg');
    assert.equal(r.valid, true);
    assert.equal(r.hostname, 'photo.zdn.vn');
  });

  it('rejects HTTP (non-HTTPS)', () => {
    assert.equal(validateUrlSyntax('http://photo.zdn.vn/image.jpg').valid, false);
  });

  it('rejects file: scheme', () => {
    assert.equal(validateUrlSyntax('file:///etc/passwd').valid, false);
  });

  it('rejects data: scheme', () => {
    assert.equal(validateUrlSyntax('data:text/html,<h1>hi</h1>').valid, false);
  });

  it('rejects ftp: scheme', () => {
    assert.equal(validateUrlSyntax('ftp://files.zdn.vn/file.zip').valid, false);
  });

  it('rejects non-Zalo hosts', () => {
    assert.equal(validateUrlSyntax('https://evil.com/malware.exe').valid, false);
  });

  it('rejects IP-literal hostnames', () => {
    assert.equal(validateUrlSyntax('https://127.0.0.1/image.jpg').valid, false);
    assert.equal(validateUrlSyntax('https://2130706433/image.jpg').valid, false);
    assert.equal(validateUrlSyntax('https://0x7f000001/image.jpg').valid, false);
  });

  it('rejects invalid URLs', () => {
    assert.equal(validateUrlSyntax('not a url').valid, false);
    assert.equal(validateUrlSyntax('').valid, false);
  });
});

describe('validateDownloadUrl (with DNS resolution)', () => {
  it('rejects URL whose hostname resolves to loopback', async () => {
    const result = await validateDownloadUrl('https://localhost.zdn.vn/image.jpg');
    assert.equal(result, false);
  });

  it('rejects URL with non-Zalo host (syntax stage)', async () => {
    assert.equal(await validateDownloadUrl('https://evil.com/file.bin'), false);
  });

  it('rejects non-HTTPS (syntax stage)', async () => {
    assert.equal(await validateDownloadUrl('http://photo.zdn.vn/img.jpg'), false);
  });

  it('rejects IP-literal hostname (syntax stage)', async () => {
    assert.equal(await validateDownloadUrl('https://127.0.0.1/img.jpg'), false);
  });

  it('rejects hostname that fails DNS lookup', async () => {
    assert.equal(await validateDownloadUrl('https://this-host-does-not-exist-xyzzy.zdn.vn/img.jpg'), false);
  });
});
