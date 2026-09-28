import type { SessionTokens } from './contractsV2';

/** Removes all callback credentials even when the callback is invalid. */
export function sanitizeCloudRecoveryHref(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get('cloud-recovery') !== '1') return null;
  url.searchParams.delete('cloud-recovery');
  url.hash = '';
  return url.toString();
}

export function parseCloudRecoveryLink(href: string, now = Date.now()): {
  session: SessionTokens;
  sanitizedHref: string;
} | null {
  const url = new URL(href);
  if (url.searchParams.get('cloud-recovery') !== '1') return null;
  const fragment = new URLSearchParams(url.hash.replace(/^#/u, ''));
  if (fragment.get('type') !== 'magiclink') return null;
  const accessToken = fragment.get('access_token') ?? '';
  const refreshToken = fragment.get('refresh_token') ?? '';
  const absoluteExpiry = Number(fragment.get('expires_at'));
  const duration = Number(fragment.get('expires_in'));
  const expiresAtSeconds = Number.isFinite(absoluteExpiry) && absoluteExpiry > 0
    ? absoluteExpiry
    : Math.floor(now / 1_000) + (Number.isFinite(duration) && duration > 0 ? duration : 3_600);
  if (!accessToken || !refreshToken || expiresAtSeconds * 1_000 <= now) return null;
  return {
    session: {
      accessToken,
      refreshToken,
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    },
    sanitizedHref: sanitizeCloudRecoveryHref(href)!,
  };
}
