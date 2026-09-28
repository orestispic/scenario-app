export function isPublicSupabaseKey(value) {
  if (typeof value !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
    // A service_role JWT looks like an anon JWT unless its payload is checked.
    return payload?.role === 'anon';
  } catch { return false; }
}
