import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '../..');

const GATES = [
  { name: 'Code Quality & Linting', command: 'npm run lint' },
  { name: 'Automated Test Suites', command: 'npm test' },
  { name: 'Production Frontend Build', command: 'npm run build' },
  { name: 'Dual-Mode Production Verification', command: 'npm run verify-production-build' },
  { name: 'Security & Dependency Audit', command: 'npm run security:check' },
  { name: 'Performance Baseline Check', command: 'node -e "process.env.NODE_ENV=\'test\'; import(\'./backend/scripts/perfCheck.js\')"' },
];

console.log('==========================================');
console.log('   MealKhata v1.0.0 Release Verification   ');
console.log('==========================================\n');

for (const gate of GATES) {
  console.log(`▶ Running gate: ${gate.name} (${gate.command})...`);
  try {
    execSync(gate.command, {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env },
    });
    console.log(`  ✓ ${gate.name}: PASSED\n`);
  } catch {
    console.error(`\n❌ FAILED gate: ${gate.name}`);
    console.error(`Command failed: ${gate.command}`);
    process.exit(1);
  }
}

console.log('==========================================');
console.log('  ALL RELEASE GATES PASSED SUCCESSFULLY   ');
console.log('==========================================\n');
console.log('MealKhata is verified and ready for v1.0.0 release.');
