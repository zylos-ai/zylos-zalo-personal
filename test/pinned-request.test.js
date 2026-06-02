import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { requestPinned } from '../src/lib/pinned-request.js';

const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDBdRqQVzXg4HTb
SaOCh8bNZLTCM3DjsgR/4mVPwkupqumGbiAHpx866R/BdNVYtG9LTEXw+UZB1eE2
IFWZoRO6a+kMiT675UWlh3gyLufswQZBqGeDlieurtmhsTLpFATBdwNLCnr6sU5E
7zhqDuJO+zTHelrQh3QZ3I0eiJdyCdhtcJrbmGtPE5CHxoqKMTo5VrL3LIc4+4e4
fJlPovdGK+syi4cbVXxohV31rcuNMJBkCV3HmqH56WlJpfOh3cm9wpDYOB7JmcUl
gI/qacPINv/HgG/8c1bCpoI/vxX1cw76wK90P2Chdo95ifyUlJ8JvtrS0E9sYeej
11l97ojBAgMBAAECggEAFMW7NXZ3zY6sXYN5sCFeIl3G3vdhDsHlo8mucTL+ptg4
PPwEKm4yd0Pi6gXehqjRLnehJu/NMHKDvSkZp+ZY1PKTUopGFyzWHqD+Mf1BX/WV
82TewI1V83bI3YjGW6qPnCpoSx1z+Qkiy1oYZ6Lzf+GPWD/2EmAJAmHhMT8fa9oc
w70MwuIniYs1Ei/gQqXLLfgYQWQaw0UVx84lsavg89op2XX0u1ES6IeBT7mjqm8c
fSpADbAWZ+jarFyRgKVXUtx5laXCgP6QNQu7/QptBcezzdMXgEu0VFGHgPfK8Muc
nf4ighAS1u6Nt41X+KUQz36QMS3iPhzDdpttcDfRBQKBgQD1PfFvBOfBycwkVdkE
m1W7Tckbi6lbqHHWuXop2/kKy/Adhyg1yyYEOMRgtYZDnptaf4fo3NDXNggoehH/
egN7jhEVbOg5L8G9f63t1HJhPYbdo5RmsQ0u5DhUjMcX5C+Z6FUXO0C+0DqS9wAR
W8/EoAwS35WhuoCNJmf2Lwxv0wKBgQDJ8Z9ijic03RuG61quQinmLDmoGa6/LXJV
iv/C8tMLvKhenh3c49r9Kq6fo4H0jrIP3cj4W3MGPsJYmE8qbPFDArMaWu3QLr3B
vcMrt12SViFS8SP5vx0VbH79/OquVt+CQW5gqhzUkObV6GXru0J0KskFJjGRgEuY
k2AuBo1cmwKBgQDaVjKb36ch7bJU6yVSJ6V1I3SXlIjMNLRdMjZkDBa2GQkGkO0o
r1uCSLP1Ucdeblfrgz0SAX3hDJbIyp05cXymRL5K7/Hz7+Ox/XlxE0Jd9nQa4Wbe
4mRVShQomkkqqRoEEUeobjVfbG2pqEQkMDRS3xbAutQx76RBhl7qW8rbxwKBgDDY
jODd2YXj5YCg9PIpdtEB6YBLlgUQDRO751lUOtAf9enM/RQs2Q9bf5mFhy2MRm2o
C7BnDk94ZrHfRWbRqxm2UXQSgmtUovl12Pt+AtgelTjmsvj5zSMddyogPvOkd7Od
+ADRpN+VnQAokl6OkOhgYPcp4dt72M0y+JSpaQ/5AoGBANsy8SEk0K21R0xbVxCy
kCPUuQcef2b6hy0ctzBFcckKJ+f23mCUcdGtsKRpHoMGLXNf22+E0aTGupJTGeFr
Ws7fuzEBgsOfy2bIWmUcYomwnNlHe6j42YbJ0dj4I3i/XDc/Z6aFIt7p0pL5Jbwh
bFXGLO/WW0o5gMPvr9eSYfII
-----END PRIVATE KEY-----`;

const CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUHg3DKmWoWsW9MvKrhixMJlTKmh4wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDYwMjE5MDQzM1oXDTI2MDYw
MzE5MDQzM1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAwXUakFc14OB020mjgofGzWS0wjNw47IEf+JlT8JLqarp
hm4gB6cfOukfwXTVWLRvS0xF8PlGQdXhNiBVmaETumvpDIk+u+VFpYd4Mi7n7MEG
Qahng5Ynrq7ZobEy6RQEwXcDSwp6+rFORO84ag7iTvs0x3pa0Id0GdyNHoiXcgnY
bXCa25hrTxOQh8aKijE6OVay9yyHOPuHuHyZT6L3RivrMouHG1V8aIVd9a3LjTCQ
ZAldx5qh+elpSaXzod3JvcKQ2DgeyZnFJYCP6mnDyDb/x4Bv/HNWwqaCP78V9XMO
+sCvdD9goXaPeYn8lJSfCb7a0tBPbGHno9dZfe6IwQIDAQABo1MwUTAdBgNVHQ4E
FgQUTypjnCDpAfOxmAi5XNhbf0PzXFgwHwYDVR0jBBgwFoAUTypjnCDpAfOxmAi5
XNhbf0PzXFgwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAVRSr
p+FPIB1/pdTHXGT+Y6wxO4HDz2qcQpVjEzKASij/9mdzUgYbUTZMp7L6HuHXv69z
hp2iEBBBRSI/fdwrlwKriQmSjVhFM+jWVljFG1ic3522+rh1nS4c1QDJvNXyYgZo
L09YRL4YNt23wvLAJCPGdnzUUL4TbNk8wuXJcCzFgitZPjzef4rVMIUlQMi4BtVm
xiJLbGdfF4lmNKQn4pRbzGFMEHmj6zQrkeHweWYTch0l/ttyvZzWu3/MAQsnv4Nx
8K5g+B+9mX+Dy8fsH3ZHYnTyj3usNYH0/knKnNYoYMi7XRQzAy6toPv4uMx+DWOb
Ifpa9TfmXu7M3wx/jQ==
-----END CERTIFICATE-----`;

describe('requestPinned', () => {
  it('returns an async-iterable IncomingMessage body', async () => {
    const payload = Buffer.from('pinned body bytes');
    const server = https.createServer({ key: KEY, cert: CERT }, (req, res) => {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(payload.length)
      });
      res.end(payload);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const resp = await requestPinned(
        `https://localhost:${port}/clip.aac`,
        { hostname: 'localhost', address: '127.0.0.1', family: 4 },
        null,
        { ca: CERT, checkServerIdentity: () => undefined }
      );

      assert.equal(resp.statusCode, 200);
      assert.equal(resp.body, undefined);
      assert.equal(typeof resp[Symbol.asyncIterator], 'function');

      const chunks = [];
      for await (const chunk of resp) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), payload);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
