import { describe, expect, it } from 'vitest';
import { parseCloudRecoveryLink, sanitizeCloudRecoveryHref } from './cloudRecoveryLink';

describe('lien e-mail de récupération Cloud', () => {
  it('accepte une session magic-link puis retire immédiatement les jetons de l’URL', () => {
    const parsed = parseCloudRecoveryLink(
      'https://senario.app/?cloud-recovery=1#access_token=access&refresh_token=refresh&type=magiclink&expires_in=3600',
      Date.parse('2026-09-18T00:00:00.000Z'),
    );
    expect(parsed?.session).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(parsed?.sanitizedHref).toBe('https://senario.app/');
  });

  it('ignore les autres confirmations et les liens expirés', () => {
    expect(parseCloudRecoveryLink('https://senario.app/#type=magiclink&access_token=a&refresh_token=r')).toBeNull();
    expect(parseCloudRecoveryLink('https://senario.app/?cloud-recovery=1#type=email_change&access_token=a&refresh_token=r')).toBeNull();
    expect(parseCloudRecoveryLink('https://senario.app/?cloud-recovery=1#type=magiclink&access_token=a&refresh_token=r&expires_at=1')).toBeNull();
  });

  it.each([
    'https://senario.app/?cloud-recovery=1#type=magiclink&access_token=expired-access&refresh_token=still-sensitive&expires_at=1',
    'https://senario.app/?cloud-recovery=1#type=email_change&access_token=sensitive-access&refresh_token=sensitive-refresh',
    'https://senario.app/?cloud-recovery=1#type=magiclink&access_token=sensitive-access',
  ])('retire immédiatement les jetons même lorsque le lien est refusé', (href) => {
    expect(parseCloudRecoveryLink(href, Date.parse('2026-09-18T00:00:00.000Z'))).toBeNull();
    expect(sanitizeCloudRecoveryHref(href)).toBe('https://senario.app/');
  });

  it('ne modifie pas une URL qui ne correspond pas au rappel Cloud', () => {
    expect(sanitizeCloudRecoveryHref('https://senario.app/#access_token=unrelated')).toBeNull();
  });
});
