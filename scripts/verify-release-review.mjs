import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSourceDigest } from './release-source-digest.mjs';

const requiredChecks = [
  'productionPaymentAndEntitlements', 'cloudCapacityAndBillingLifecycle',
  'cloud20GiBRecovery', 'offsiteDatabaseAndObjectRestore', 'customerEmailDelivery',
  'legalAndPrivacyApproval', 'monitoringAndSupport', 'windowsInstallUpdateAndRollback',
];

export function reviewBlockers(review, version, readEvidence, sourceDigest) {
  const blockers = [];
  if (review.schemaVersion !== 1 || review.version !== version || review.target !== 'windows-with-cloud-20-gib')
    blockers.push('La revue doit correspondre à cette version Windows avec Cloud 20 Gio.');
  if (review.publicationAuthorized !== true) blockers.push('Publication non autorisée.');
  if (typeof sourceDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(sourceDigest) || review.sourceDigest !== sourceDigest)
    blockers.push('La revue doit attester les sources exactes de cette construction.');
  for (const name of requiredChecks) {
    const check = review.checks?.[name];
    if (!check || check.approved !== true || typeof check.reviewedBy !== 'string'
      || !check.reviewedBy.trim() || typeof check.reviewedAt !== 'string'
      || !Number.isFinite(Date.parse(check.reviewedAt)) || Date.parse(check.reviewedAt) > Date.now()
      || typeof check.evidence !== 'string' || !/^release\/evidence\/[a-zA-Z0-9_./-]+\.md$/u.test(check.evidence)
      || check.evidence.split('/').includes('..')) {
      blockers.push(`${name} : validation datée et preuve requises.`);
      continue;
    }
    try {
      if (!readEvidence(check.evidence).trim()) throw new Error('Empty evidence');
    } catch { blockers.push(`${name} : preuve locale absente ou vide.`); }
  }
  return blockers;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const sourceDigest = releaseSourceDigest(root);
  if (process.argv.includes('--print-source-digest')) { console.log(sourceDigest); process.exit(0); }
  const review = JSON.parse(readFileSync(resolve(root, 'release/review.json'), 'utf8'));
  const blockers = reviewBlockers(review, config.version, path => {
    const target = resolve(root, path);
    const local = relative(root, target);
    if (local.startsWith('..') || isAbsolute(local)) throw new Error('Invalid evidence path');
    return readFileSync(target, 'utf8');
  }, sourceDigest);
  if (blockers.length) {
    console.error(`Publication bloquée (${blockers.length} prérequis).`);
    blockers.forEach(message => console.error(`- ${message}`));
    process.exitCode = 2;
  } else console.log('Revue documentaire complète pour cette version. Les signatures restent vérifiées séparément.');
}
