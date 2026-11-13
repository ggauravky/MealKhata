import 'dotenv/config';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createAuthService } from '../src/auth/auth.service.js';
import { configuredDatabaseName } from '../src/config/env.js';
import { describeMongoTarget, parseSetupArguments, prepareFirstAdmin } from '../src/config/firstAdminSetup.js';
import {
  initializeApplication,
  readInitializationState,
  resetSuperAdminPassword,
} from '../src/config/initialization.js';

function ask(prompt) {
  return new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.question(prompt, (answer) => {
      input.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('Run this command in an interactive terminal'));
    let value = '';
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(prompt);
    const finish = (error) => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    function onKeypress(character, key) {
      if (key?.ctrl && key.name === 'c') return finish(new Error('Cancelled'));
      if (key?.name === 'return' || key?.name === 'enter') return finish();
      if (key?.name === 'backspace') { value = value.slice(0, -1); return undefined; }
      if (!key?.ctrl && !key?.meta && character) value += character;
      return undefined;
    }
    process.stdin.on('keypress', onKeypress);
  });
}

async function runPasswordReset({ options, target }) {
  if (!await readInitializationState()) throw new Error('MealKhata has not been set up yet; run setup first.');
  const email = options.email || await ask('Super Admin email: ');
  process.stdout.write(`\nThis replaces the Super Admin password for ${email.trim().toLowerCase()}\n`);
  process.stdout.write(`in database "${target.database}" on ${target.host} and signs out every session.\n\n`);
  if (await ask('Type RESET to continue: ') !== 'RESET') throw new Error('Cancelled');
  const password = await askHidden('New Super Admin password: ');
  const passwordConfirmation = await askHidden('Repeat the password: ');
  const { financialStartDate } = await readInitializationState();
  const prepared = await prepareFirstAdmin({ email, financialStartDate, password, passwordConfirmation });
  const result = await resetSuperAdminPassword({ email: prepared.email, passwordHash: prepared.passwordHash });
  const login = await createAuthService().authenticateCredentials({ email: prepared.email, password });
  if (login.userId !== result.userId) throw new Error('Password was reset but could not be verified');
  process.stdout.write('\nPassword reset. Sign in on the website with the new password.\n');
  return result;
}

/**
 * One-time owner command: creates the only Super Admin and the system settings.
 * Usage: npm run setup:admin -- --email owner@example.com --start-date 2026-11-01
 * Recovery: npm run setup:admin -- --reset-password --email owner@example.com
 */
export async function runSetupAdmin({ argv = process.argv.slice(2), mongoUri = process.env.MONGODB_URI?.trim() } = {}) {
  const options = parseSetupArguments(argv);
  if (!mongoUri || !configuredDatabaseName(mongoUri)) {
    throw new Error('MONGODB_URI must be set in backend/.env and name the database (for example /mealkhata)');
  }
  const target = describeMongoTarget(mongoUri);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15_000 });
  try {
    if (options.resetPassword) return await runPasswordReset({ options, target });
    if (await readInitializationState()) {
      throw new Error('MealKhata is already initialized. Sign in, or use --reset-password if the password is lost.');
    }
    const email = options.email || await ask('Super Admin email: ');
    const financialStartDate = options.financialStartDate || await ask('Financial start date (YYYY-MM-DD): ');
    process.stdout.write(`\nThis creates the Super Admin ${email.trim().toLowerCase()}\n`);
    process.stdout.write(`in database "${target.database}" on ${target.host}.\n`);
    process.stdout.write('No students, meals, rooms or payments will be created.\n\n');
    if (await ask('Type SETUP to continue: ') !== 'SETUP') throw new Error('Cancelled');

    const password = await askHidden('Choose the Super Admin password: ');
    const passwordConfirmation = await askHidden('Repeat the password: ');
    const prepared = await prepareFirstAdmin({ email, financialStartDate, password, passwordConfirmation });
    const result = await initializeApplication(prepared);

    const login = await createAuthService().authenticateCredentials({ email: prepared.email, password });
    if (login.userId !== result.superAdminUserId || login.role !== 'superadmin') {
      throw new Error('The Super Admin was created but could not be verified; do not retry, investigate');
    }
    process.stdout.write('\nSetup complete. Sign in on the website with this email and password.\n');
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSetupAdmin().catch((error) => {
    process.stderr.write(`Setup stopped: ${error.message}\n`);
    process.exitCode = 1;
  });
}
