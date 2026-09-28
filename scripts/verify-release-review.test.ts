import { describe, expect, it } from 'vitest';
// The runtime gate is deliberately usable without a TypeScript loader in CI.
// @ts-expect-error Standalone release script has no declaration file.
import { reviewBlockers as checkReview } from './verify-release-review.mjs';

const digest = 'a'.repeat(64);
const reviewBlockers = (review: unknown, version: string, read: () => string) => checkReview(review, version, read, digest);
const checks = [
  'productionPaymentAndEntitlements', 'cloudCapacityAndBillingLifecycle', 'cloud20GiBRecovery',
  'offsiteDatabaseAndObjectRestore', 'customerEmailDelivery', 'legalAndPrivacyApproval',
  'monitoringAndSupport', 'windowsInstallUpdateAndRollback',
];
const valid = () => ({ schemaVersion: 1, version: '0.1.17', target: 'windows-with-cloud-20-gib',
  publicationAuthorized: true, sourceDigest: digest, checks: Object.fromEntries(checks.map(name => [name, {
    approved: true, reviewedBy: 'Fixture reviewer', reviewedAt: '2026-09-01',
    evidence: `release/evidence/${name}.md`,
  }])) });

describe('release review gate', () => {
  it('requires explicit authorization and every evidence record', () => {
    expect(reviewBlockers({}, '0.1.17', () => '')).toHaveLength(11);
    expect(reviewBlockers(valid(), '0.1.17', () => 'dated fixture evidence')).toEqual([]);
    expect(reviewBlockers({ ...valid(), publicationAuthorized: 'true' }, '0.1.17', () => 'proof')).toHaveLength(1);
  });
  it('rejects proof from different source bytes', () => {
    expect(checkReview(valid(), '0.1.17', () => 'proof', 'b'.repeat(64))).toHaveLength(1);
  });
  it('rejects another version, missing files, future reviews and escaping evidence paths', () => {
    expect(reviewBlockers(valid(), '0.1.18', () => 'proof')).toHaveLength(1);
    expect(reviewBlockers(valid(), '0.1.17', () => { throw new Error('absent'); })).toHaveLength(8);
    const review = valid();
    review.checks.cloud20GiBRecovery.evidence = 'release/evidence/../../secret.md';
    review.checks.productionPaymentAndEntitlements.reviewedAt = '2999-01-01';
    expect(reviewBlockers(review, '0.1.17', () => 'proof')).toHaveLength(2);
  });
});
