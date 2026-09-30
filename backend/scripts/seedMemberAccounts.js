import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { memberAccountRepository } from '../src/auth/memberAccount.repository.js';
import { logger } from '../src/utils/logger.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function hasBcryptCost12(value) {
  if (typeof value !== 'string' || !bcryptHashPattern.test(value)) {
    return false;
  }

  try {
    return bcrypt.getRounds(value) === 12;
  } catch {
    return false;
  }
}

export function extractMemberSeedConfigs(env = process.env) {
  return [
    {
      memberId: 'gaurav',
      email: env.MEMBER_GAURAV_EMAIL?.trim().toLowerCase() ?? '',
      passwordHash: env.MEMBER_GAURAV_PASSWORD_HASH?.trim() ?? '',
    },
    {
      memberId: 'nikhil',
      email: env.MEMBER_NIKHIL_EMAIL?.trim().toLowerCase() ?? '',
      passwordHash: env.MEMBER_NIKHIL_PASSWORD_HASH?.trim() ?? '',
    },
    {
      memberId: 'devansh',
      email: env.MEMBER_DEVANSH_EMAIL?.trim().toLowerCase() ?? '',
      passwordHash: env.MEMBER_DEVANSH_PASSWORD_HASH?.trim() ?? '',
    },
  ];
}

export function validateMemberSeedConfigs(members, { env = process.env } = {}) {
  const missing = [];
  const emails = new Set();
  const reservedEmails = new Set(
    [env.ADMIN_EMAIL, env.SUPERADMIN_EMAIL]
      .filter(Boolean)
      .map((email) => email.trim().toLowerCase()),
  );

  for (const { memberId, email, passwordHash } of members) {
    if (!MEMBER_IDS.includes(memberId)) {
      throw new Error(`Invalid member ID: ${memberId}`);
    }

    if (!email) {
      missing.push(`MEMBER_${memberId.toUpperCase()}_EMAIL`);
    }

    if (!passwordHash) {
      missing.push(`MEMBER_${memberId.toUpperCase()}_PASSWORD_HASH`);
    }

    if (email) {
      if (!emailPattern.test(email)) {
        throw new Error(`Invalid email address for ${memberId}`);
      }

      if (emails.has(email)) {
        throw new Error(`Duplicate member email detected: ${email}`);
      }
      emails.add(email);

      if (reservedEmails.has(email)) {
        throw new Error(`Member email cannot match admin or superadmin email: ${email}`);
      }
    }

    if (passwordHash && !hasBcryptCost12(passwordHash)) {
      throw new Error(`Password hash for ${memberId} must be a valid bcrypt hash with cost 12`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required member seed variables: ${missing.join(', ')}`);
  }
}

export async function seedMemberAccounts({
  members = extractMemberSeedConfigs(),
  repository = memberAccountRepository,
  env = process.env,
} = {}) {
  validateMemberSeedConfigs(members, { env });

  const results = [];
  for (const member of members) {
    const updated = await repository.upsertAccount({
      memberId: member.memberId,
      email: member.email,
      passwordHash: member.passwordHash,
      active: true,
    });
    results.push(updated);
  }

  return results;
}

async function runCli() {
  await connectDatabase();
  try {
    const seeded = await seedMemberAccounts();
    logger.info(`Successfully seeded ${seeded.length} member accounts (${seeded.map((a) => a.memberId).join(', ')})`);
  } finally {
    await disconnectDatabase();
  }
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
import { fileURLToPath } from 'node:url';

if (isDirectExecution) {
  runCli().catch((error) => {
    logger.error('Failed to seed member accounts', { message: error.message });
    process.exitCode = 1;
  });
}
