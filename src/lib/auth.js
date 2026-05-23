import { saveConfig } from './config.js';

export function hasOwner(config) {
  return config.owner && config.owner.user_id !== null;
}

export function bindOwner(config, userId, userName) {
  const prevOwner = config.owner ? { ...config.owner } : { user_id: null, name: null, bound_at: null };
  const prevDmAllowFrom = Array.isArray(config.dmAllowFrom) ? [...config.dmAllowFrom] : [];

  config.owner = {
    user_id: String(userId),
    name: userName || null,
    bound_at: new Date().toISOString()
  };
  if (!Array.isArray(config.dmAllowFrom)) config.dmAllowFrom = [];
  if (!config.dmAllowFrom.includes(String(userId))) {
    config.dmAllowFrom.push(String(userId));
  }

  if (!saveConfig(config)) {
    config.owner = prevOwner;
    config.dmAllowFrom = prevDmAllowFrom;
    console.error(`[zalo-personal] Owner binding rolled back due to save failure`);
    return false;
  }

  console.log(`[zalo-personal] Owner bound: ${userName || userId}`);
  return true;
}

export function isOwner(config, userId) {
  if (!hasOwner(config)) return false;
  return String(userId) === String(config.owner.user_id);
}

export function isDmAllowed(config, userId) {
  if (isOwner(config, userId)) return true;
  const policy = config.dmPolicy || 'owner';
  if (policy === 'open') return true;
  if (policy === 'owner') return false;
  return (config.dmAllowFrom || []).map(String).includes(String(userId));
}

export function isGroupAllowed(config, groupId) {
  const policy = config.groupPolicy || 'allowlist';
  if (policy === 'disabled') return false;
  if (policy === 'open') return true;
  return !!config.groups?.[String(groupId)];
}

export function isGroupSenderAllowed(config, groupId, userId) {
  if (isOwner(config, userId)) return true;
  const gc = config.groups?.[String(groupId)];
  if (!gc) return false;
  const allowFrom = gc.allowFrom || ['*'];
  if (allowFrom.includes('*')) return true;
  return allowFrom.map(String).includes(String(userId));
}

export function getGroupConfig(config, groupId) {
  return config.groups?.[String(groupId)] || null;
}

export function getGroupMode(config, groupId) {
  const gc = getGroupConfig(config, groupId);
  return gc?.mode || 'mention';
}

export function registerGroup(config, groupId, { name, mode } = {}) {
  if (!config.groups) config.groups = {};
  const key = String(groupId);
  const hadGroup = Object.prototype.hasOwnProperty.call(config.groups, key);
  const prevGroup = hadGroup ? { ...config.groups[key] } : undefined;

  config.groups[key] = {
    name: name || key,
    mode: mode || 'mention',
    allowFrom: ['*']
  };

  if (!saveConfig(config)) {
    if (hadGroup) {
      config.groups[key] = prevGroup;
    } else {
      delete config.groups[key];
    }
    console.error(`[zalo-personal] Group registration rolled back due to save failure`);
    return false;
  }

  console.log(`[zalo-personal] Auto-registered group ${groupId} (${name || 'unnamed'}) in ${mode || 'mention'} mode`);
  return true;
}
