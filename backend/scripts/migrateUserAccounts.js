import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { MEMBER_IDS, MEMBER_NAMES } from '../src/config/members.js';
import { MemberAccount } from '../src/auth/memberAccount.model.js';
import { UserAccount } from '../src/auth/userAccount.model.js';
import { ROLES } from '../src/auth/permissions.js';
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

export async function migrateUserAccounts({ dryRun = false, env = process.env } = {}) {
  logger.info(`Starting UserAccount migration (dryRun=${dryRun})...`);

  const stats = {
    membersMigrated: 0,
    membersSkipped: 0,
    adminsMigrated: 0,
    adminsSkipped: 0,
    errors: [],
  };

  // 1. Fetch existing MemberAccount documents from member_accounts collection
  const existingMemberAccounts = await MemberAccount.find({}).lean();
  logger.info(`Found ${existingMemberAccounts.length} existing member_accounts records.`);

  // If member_accounts is empty in DB, check env fallback for members
  const memberCandidates = [];
  if (existingMemberAccounts.length > 0) {
    for (const doc of existingMemberAccounts) {
      memberCandidates.push({
        source: 'collection',
        memberId: doc.memberId,
        email: doc.email.trim().toLowerCase(),
        passwordHash: doc.passwordHash,
        active: doc.active !== false,
      });
    }
  } else {
    logger.info('No member_accounts in DB; checking environment seed variables...');
    for (const memberId of MEMBER_IDS) {
      const email = env[`MEMBER_${memberId.toUpperCase()}_EMAIL`]?.trim().toLowerCase();
      const passwordHash = env[`MEMBER_${memberId.toUpperCase()}_PASSWORD_HASH`]?.trim();
      if (email && passwordHash) {
        memberCandidates.push({
          source: 'env',
          memberId,
          email,
          passwordHash,
          active: true,
        });
      }
    }
  }

  // 2. Process Members
  for (const candidate of memberCandidates) {
    if (!emailPattern.test(candidate.email)) {
      stats.errors.push(`Invalid email format for member ${candidate.memberId}: ${candidate.email}`);
      continue;
    }
    if (!hasBcryptCost12(candidate.passwordHash)) {
      stats.errors.push(`Invalid bcrypt cost 12 hash for member ${candidate.memberId}`);
      continue;
    }

    const existingUser = await UserAccount.findOne({
      $or: [{ email: candidate.email }, { memberId: candidate.memberId }],
    }).lean();

    if (existingUser) {
      if (existingUser.role !== ROLES.MEMBER) {
        stats.errors.push(`Conflict: account ${candidate.email} exists with non-member role ${existingUser.role}`);
        continue;
      }
      logger.info(`Member account for ${candidate.memberId} (${candidate.email}) already exists. Preserving.`);
      stats.membersSkipped += 1;
      continue;
    }

    const newRecord = {
      userId: crypto.randomUUID(),
      memberId: candidate.memberId,
      displayName: MEMBER_NAMES[candidate.memberId] || candidate.memberId,
      email: candidate.email,
      passwordHash: candidate.passwordHash,
      role: ROLES.MEMBER,
      active: candidate.active,
      sessionVersion: 0,
      passwordChangedAt: null,
      lastLoginAt: null,
    };

    if (dryRun) {
      logger.info(`[DRY-RUN] Would create UserAccount: memberId=${newRecord.memberId}, email=${newRecord.email}, role=${newRecord.role}`);
      stats.membersMigrated += 1;
    } else {
      await UserAccount.create(newRecord);
      logger.info(`Migrated UserAccount: memberId=${newRecord.memberId}, email=${newRecord.email}`);
      stats.membersMigrated += 1;
    }
  }

  // 3. Process Admin & Super Admin Bootstrap from Environment
  const adminCandidates = [
    {
      role: ROLES.ADMIN,
      displayName: 'Household Admin',
      email: env.ADMIN_EMAIL?.trim().toLowerCase(),
      passwordHash: env.ADMIN_PASSWORD_HASH?.trim(),
    },
    {
      role: ROLES.SUPERADMIN,
      displayName: 'Super Admin',
      email: env.SUPERADMIN_EMAIL?.trim().toLowerCase(),
      passwordHash: env.SUPERADMIN_PASSWORD_HASH?.trim(),
    },
  ];

  for (const admin of adminCandidates) {
    if (!admin.email || !admin.passwordHash) {
      logger.warn(`Skipping bootstrap for role=${admin.role}: missing email or passwordHash in environment.`);
      continue;
    }

    if (!emailPattern.test(admin.email)) {
      stats.errors.push(`Invalid email format for role=${admin.role}: ${admin.email}`);
      continue;
    }
    if (!hasBcryptCost12(admin.passwordHash)) {
      stats.errors.push(`Invalid bcrypt cost 12 hash for role=${admin.role}`);
      continue;
    }

    const existingAdmin = await UserAccount.findOne({ email: admin.email }).lean();
    if (existingAdmin) {
      logger.info(`Account for ${admin.role} (${admin.email}) already exists. Preserving.`);
      stats.adminsSkipped += 1;
      continue;
    }

    const newAdminRecord = {
      userId: crypto.randomUUID(),
      memberId: null,
      displayName: admin.displayName,
      email: admin.email,
      passwordHash: admin.passwordHash,
      role: admin.role,
      active: true,
      sessionVersion: 0,
      passwordChangedAt: null,
      lastLoginAt: null,
    };

    if (dryRun) {
      logger.info(`[DRY-RUN] Would create UserAccount: email=${newAdminRecord.email}, role=${newAdminRecord.role}`);
      stats.adminsMigrated += 1;
    } else {
      await UserAccount.create(newAdminRecord);
      logger.info(`Bootstrapped UserAccount: role=${newAdminRecord.role}, email=${newAdminRecord.email}`);
      stats.adminsMigrated += 1;
    }
  }

  if (stats.errors.length > 0) {
    logger.error('Migration encountered errors:', stats.errors);
    throw new Error(`Migration failed with ${stats.errors.length} error(s):\n${stats.errors.join('\n')}`);
  }

  logger.info(`UserAccount migration finished successfully:`, stats);
  return stats;
}

// CLI runner
if (process.argv[1]?.endsWith('migrateUserAccounts.js')) {
  const isDryRun = process.argv.includes('--dry-run');

  try {
    await connectDatabase();
    const stats = await migrateUserAccounts({ dryRun: isDryRun });
    logger.info('Migration complete summary:', stats);
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
}
