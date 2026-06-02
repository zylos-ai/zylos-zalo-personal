export function safeId(str) {
  return String(str).replace(/[^a-zA-Z0-9_:-]/g, '_').substring(0, 200);
}
