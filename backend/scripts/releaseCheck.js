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
  ['Browser end-to-end flow', ['run', 'e2e:browser']],
];

export function runReleaseCodeChecks({ run = execFileSync, log = console.log } = {}) {
  log(`MealKhata ${packageJson.version} local code verification`);
  for (const [name, args] of GATES) {
    log(`Checking ${name}`);
    run('npm', args, { cwd: rootDir, stdio: 'inherit', env: { ...process.env } });
  }
  log('Local code checks passed. Production deployment and a real Super Admin login are verified separately.');
  return Object.freeze({ version: packageJson.version, codeQuality: 'verified' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runReleaseCodeChecks(); }
  catch { console.error('A local code verification gate failed.'); process.exitCode = 1; }
}
