import fs from 'fs';
import path from 'path';

export function unlinkQuiet(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

export function sweepTimestampCache(cache, { ttlMs, maxSize, now = Date.now() } = {}) {
  for (const [key, entry] of cache) {
    const cachedAt = typeof entry === 'object' && entry !== null ? entry.cachedAt : 0;
    if (cachedAt && ttlMs && now - cachedAt > ttlMs) cache.delete(key);
  }
  while (maxSize && cache.size > maxSize) {
    cache.delete(cache.keys().next().value);
  }
}

export function cleanupMediaTree(rootDir, maxAgeMs, now = Date.now()) {
  function visit(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fp = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          visit(fp);
          continue;
        }
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(fp);
      } catch {}
    }
  }
  visit(rootDir);
}

export function truncateLogFileAtomic(filePath, { maxBytes, keepBytes = 1024 * 1024 } = {}) {
  const stat = fs.statSync(filePath);
  if (stat.size <= maxBytes) return { truncated: false, oldSize: stat.size, newSize: stat.size };

  const bytesToKeep = Math.min(keepBytes, stat.size);
  const buf = Buffer.alloc(bytesToKeep);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, bytesToKeep, stat.size - bytesToKeep);
  } finally {
    fs.closeSync(fd);
  }

  let content = buf.toString('utf-8');
  const nl = content.indexOf('\n');
  if (nl >= 0) content = content.substring(nl + 1);

  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }

  return { truncated: true, oldSize: stat.size, newSize: Buffer.byteLength(content) };
}
