/**
 * Directory normalization/filtering for friend & group resolution.
 *
 * The zca-js getAllFriends/getAllGroups responses vary in shape (array, object
 * map, or { data } wrapper) and field naming. These pure helpers normalize them
 * to { id, name } and support substring lookup so operators can resolve targets
 * and configure allowlists. No I/O here — the admin CLI fetches via the service.
 */

export function extractId(entry) {
  if (!entry || typeof entry !== 'object') return entry != null ? String(entry) : null;
  const id = entry.userId ?? entry.uid ?? entry.groupId ?? entry.gid ?? entry.id ?? null;
  return id != null ? String(id) : null;
}

export function extractName(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.displayName ?? entry.zaloName ?? entry.name ?? entry.dName ?? '');
}

export function normalizeEntries(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.data)) list = raw.data;
    else if (raw.data && typeof raw.data === 'object') list = Object.values(raw.data);
    else list = Object.values(raw);
  }
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const id = extractId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: extractName(entry) });
  }
  return out;
}

export function filterByName(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(e =>
    String(e.name).toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q));
}
