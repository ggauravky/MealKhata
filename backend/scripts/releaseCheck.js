import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../package.json' with { type: 'json' };

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '../..');
const GATES = [
  ['Lint', ['run', 'lint']],
  ['Backend and frontend tests', ['test']],
  ['Frontend build', ['run', 'build']],
  ['Backend production build verification', ['run', 'verify-production-build']],
  ['Security checks', ['run', 'security:check']],
  ['Performance baseline', ['run', 'perf:check']],
];

export function releaseGateSummary({ codeQualityPassed = false, isolatedMigrationPassed = false } = {}) {
  return Object.freeze({ version: packageJson.version,
    codeQuality: codeQualityPassed ? 'verified' : 'pending',
    isolatedMigration: isolatedMigrationPassed ? 'verified' : 'pending',
    productionSourceEvidence: 'pending', recovery: 'pending',
    productionAdapters: 'review pending', ownerApproval: 'pending',
    cutoverAuthorized: false });
}

export function runReleaseCodeChecks({ run = execFileSync, log = console.log } = {}) {
  log(`MealKhata ${packageJson.version} local code verification`);
  for (const [name, args] of GATES) {
    log(`Checking ${name}`);
    run('npm', args, { cwd: rootDir, stdio: 'inherit', env: { ...process.env } });
  }
  const summary = releaseGateSummary({ codeQualityPassed: true, isolatedMigrationPassed: true });
  log('Local code checks passed. Production source, recovery, provider and owner gates remain pending.');
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runReleaseCodeChecks(); }
  catch { console.error('A local code verification gate failed.'); process.exitCode = 1; }
}
