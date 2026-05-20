import { saveConfig } from './config.js';

export function hasOwner(config) {
  return config.owner && config.owner.user_id !== null;
}

export function bindOwner(config, userId, userName) {
  config.owner = {
    user_id: String(userId),
    name: userName || null,
    bound_at: new Date().toISOString()
  };
  if (!Array.isArray(config.dmAllowFrom)) config.dmAllowFrom = [];
  if (!config.dmAllowFrom.includes(String(userId))) {
    config.dmAllowFrom.push(String(userId));
  }
  saveConfig(config);
  console.log(`[zalo-personal] Owner bound: ${userName || userId}`);
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
