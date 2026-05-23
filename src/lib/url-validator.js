const PRIVATE_IP_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^0\./, /^169\.254\./, /^::1$/, /^fc00:/i, /^fe80:/i, /^fd/i,
];

const ALLOWED_DOWNLOAD_HOSTS = [
  /\.zdn\.vn$/i, /\.zadn\.vn$/i, /\.dlfl\.vn$/i, /\.zaloapp\.com$/i,
  /\.zalo\.me$/i, /\.zalo\.vn$/i,
];

export function isPrivateIp(ip) {
  return PRIVATE_IP_RANGES.some(re => re.test(ip));
}

export function isAllowedDownloadHost(hostname) {
  return ALLOWED_DOWNLOAD_HOSTS.some(re => re.test(hostname));
}

export function isIpLikeHostname(hostname) {
  if (hostname.startsWith('[')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^\d+$/.test(hostname)) return true;
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  if (/^0\d/.test(hostname) && /^\d{1,4}(\.\d{1,4}){0,3}$/.test(hostname)) return true;
  return false;
}

export function validateUrlSyntax(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return { valid: false }; }
  if (parsed.protocol !== 'https:') return { valid: false };
  if (isIpLikeHostname(parsed.hostname)) return { valid: false };
  if (!isAllowedDownloadHost(parsed.hostname)) return { valid: false };
  return { valid: true, hostname: parsed.hostname };
}
