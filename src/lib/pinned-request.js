import https from 'https';
import dns from 'dns/promises';

export function requestPinned(url, pin, signal, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      ...options,
      method: options.method || 'GET',
      servername: pin.hostname,
      lookup(hostname, lookupOptions, callback) {
        if (hostname === pin.hostname) {
          if (lookupOptions?.all) {
            callback(null, [{ address: pin.address, family: pin.family || 4 }]);
          } else {
            callback(null, pin.address, pin.family || 4);
          }
          return;
        }
        dns.lookup(hostname, lookupOptions).then(
          result => callback(null, result.address, result.family),
          callback
        );
      }
    }, resolve);
    req.on('error', reject);
    if (signal) {
      if (signal.aborted) req.destroy(new Error('aborted'));
      signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    }
    req.end();
  });
}
