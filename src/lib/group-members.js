const DEFAULT_LIMIT = 20;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_SIZE = 200;

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function groupRecord(info, groupId) {
  const key = String(groupId);
  return (
    info?.gridInfoMap?.[key] ||
    info?.gridInfoMap?.[groupId] ||
    info?.[key] ||
    info?.[groupId] ||
    info?.groups?.[key] ||
    null
  );
}

export function memberDisplayName(member) {
  if (!member || typeof member !== 'object') return null;
  return firstString(
    member.dName,
    member.zaloName,
    member.displayName,
    member.name,
    member.fullName,
    member.accountName,
    member.profile?.zaloName,
    member.profile?.displayName,
    member.profile?.name
  );
}

function memberId(member) {
  if (member === undefined || member === null) return null;
  if (typeof member !== 'object') return firstString(member);
  return firstString(member.uid, member.id, member.userId, member.user_id);
}

function memberNamesFromInfo(info) {
  const names = new Map();
  for (const member of asArray(info)) {
    const id = memberId(member);
    const name = memberDisplayName(member);
    if (id && name) names.set(String(id), name);
  }
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    for (const [id, member] of Object.entries(info)) {
      const name = memberDisplayName(member);
      if (name) names.set(String(id), name);
    }
  }
  return names;
}

function groupMemberSources(group) {
  return [
    ...asArray(group?.currentMems),
    ...asArray(group?.members),
    ...asArray(group?.memberList),
  ];
}

function groupMemberIds(group) {
  const ids = [
    ...asArray(group?.memberIds),
    ...asArray(group?.currentMems).map(memberId),
    ...asArray(group?.members).map(memberId),
    ...asArray(group?.memberList).map(memberId),
  ];
  return [...new Set(ids.filter(Boolean).map(String))];
}

async function resolveMemberNames(api, group, limit) {
  const names = [];
  for (const member of groupMemberSources(group)) {
    const name = memberDisplayName(member);
    if (name) names.push(name);
    if (names.length >= limit) return names.slice(0, limit);
  }

  const ids = groupMemberIds(group).slice(0, limit);
  if (!ids.length || typeof api.getGroupMembersInfo !== 'function') return names.slice(0, limit);

  const info = await api.getGroupMembersInfo(ids);
  const byId = memberNamesFromInfo(info);
  for (const id of ids) {
    const name = byId.get(String(id));
    if (name) names.push(name);
    if (names.length >= limit) break;
  }
  return names.slice(0, limit);
}

export function createGroupMembersCache({ ttlMs = DEFAULT_TTL_MS, maxSize = DEFAULT_MAX_CACHE_SIZE } = {}) {
  const cache = new Map();
  return {
    get(groupId) {
      const key = String(groupId);
      const cached = cache.get(key);
      if (!cached) return null;
      if (Date.now() - cached.cachedAt > ttlMs) {
        cache.delete(key);
        return null;
      }
      return cached.value;
    },
    set(groupId, value) {
      const key = String(groupId);
      cache.set(key, { value, cachedAt: Date.now() });
      while (cache.size > maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      return value;
    },
    sweep(now = Date.now()) {
      let removed = 0;
      for (const [key, entry] of cache) {
        if (now - entry.cachedAt > ttlMs) {
          cache.delete(key);
          removed++;
        }
      }
      return removed;
    },
    size() {
      return cache.size;
    },
  };
}

export async function getGroupMembers(api, groupId, { cache, limit = DEFAULT_LIMIT } = {}) {
  const cached = cache?.get(groupId);
  if (cached) return cached;
  const info = await api.getGroupInfo([groupId]);
  const group = groupRecord(info, groupId);
  if (!group) return null;
  const names = await resolveMemberNames(api, group, limit);
  const total = Number(group.totalMember || group.totalMembers || group.memberCount || names.length || 0) || names.length;
  const summary = {
    names,
    total,
    capped: total > names.length,
  };
  cache?.set(groupId, summary);
  return summary;
}
