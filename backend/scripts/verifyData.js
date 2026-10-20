import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { isValidLogicalDate } from '../src/utils/date.js';
import { isValidLogicalMonth } from '../src/utils/month.js';
import { isValidPaymentAmount, isValidUuid } from '../src/payments/payment.constants.js';
import { isValidPricePaise } from '../src/billing/monthlyRate.constants.js';
import { isValidLogicalTime } from '../src/settings/reminder.constants.js';
import { MEAL_STATUSES } from '../src/meals/meal.constants.js';

export async function verifyDataIntegrity(dbConnection = mongoose.connection) {
  const issues = [];
  const checks = [];

  const db = dbConnection.db;

  // 1. User Accounts Check
  try {
    const userAccounts = await db.collection('user_accounts').find({}).toArray();
    let userIssues = 0;
    const seenUserIds = new Set();
    const seenEmails = new Set();
    const seenMemberIds = new Set();

    for (const u of userAccounts) {
      if (!isValidUuid(u.userId)) {
        issues.push(`[user_accounts] Invalid userId UUID for user: ${u.email || u._id}`);
        userIssues++;
      }
      if (seenUserIds.has(u.userId)) {
        issues.push(`[user_accounts] Duplicate userId found: ${u.userId}`);
        userIssues++;
      }
      seenUserIds.add(u.userId);

      const normalizedEmail = u.email?.trim().toLowerCase();
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        issues.push(`[user_accounts] Invalid email format for user: ${u.userId}`);
        userIssues++;
      }
      if (seenEmails.has(normalizedEmail)) {
        issues.push(`[user_accounts] Duplicate email found: ${normalizedEmail}`);
        userIssues++;
      }
      seenEmails.add(normalizedEmail);

      if (!['member', 'admin', 'superadmin'].includes(u.role)) {
        issues.push(`[user_accounts] Invalid role ${u.role} for user: ${normalizedEmail}`);
        userIssues++;
      }

      if (u.role === 'member') {
        if (!MEMBER_IDS.includes(u.memberId)) {
          issues.push(`[user_accounts] Member role must have valid memberId: ${u.memberId} for ${normalizedEmail}`);
          userIssues++;
        }
        if (seenMemberIds.has(u.memberId)) {
          issues.push(`[user_accounts] Duplicate active memberId mapping: ${u.memberId}`);
          userIssues++;
        }
        seenMemberIds.add(u.memberId);
      } else {
        if (u.memberId !== null && u.memberId !== undefined) {
          issues.push(`[user_accounts] Role ${u.role} must have memberId null, got: ${u.memberId}`);
          userIssues++;
        }
      }

      if (typeof u.active !== 'boolean') {
        issues.push(`[user_accounts] active must be boolean for ${normalizedEmail}`);
        userIssues++;
      }

      if (typeof u.sessionVersion !== 'number' || u.sessionVersion < 0 || !Number.isInteger(u.sessionVersion)) {
        issues.push(`[user_accounts] sessionVersion must be nonnegative integer for ${normalizedEmail}`);
        userIssues++;
      }

      // Validate bcrypt cost 12 without printing hash
      if (!u.passwordHash || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(u.passwordHash)) {
        issues.push(`[user_accounts] Invalid password hash format for ${normalizedEmail}`);
        userIssues++;
      }
    }

    checks.push({
      name: 'User Accounts',
      recordsChecked: userAccounts.length,
      status: userIssues === 0 ? 'PASS' : 'FAIL',
      issues: userIssues,
    });
  } catch (error) {
    checks.push({ name: 'User Accounts', status: 'FAIL', issues: 1, message: error.message });
  }

  // 1b. Legacy Member Accounts Check (Audit)
  try {
    const members = await db.collection('member_accounts').find({}).toArray();
    let memberIssues = 0;
    const foundMemberIds = new Set();

    for (const m of members) {
      if (!MEMBER_IDS.includes(m.memberId)) {
        issues.push(`[member_accounts] Unknown memberId: ${m.memberId}`);
        memberIssues++;
      }
      if (foundMemberIds.has(m.memberId)) {
        issues.push(`[member_accounts] Duplicate memberId found: ${m.memberId}`);
        memberIssues++;
      }
      foundMemberIds.add(m.memberId);

      if (!m.passwordHash || !m.passwordHash.startsWith('$2')) {
        issues.push(`[member_accounts] Invalid password hash format for ${m.memberId}`);
        memberIssues++;
      }
    }

    checks.push({
      name: 'Legacy Member Accounts',
      recordsChecked: members.length,
      status: memberIssues === 0 ? 'PASS' : 'FAIL',
      issues: memberIssues,
    });
  } catch (error) {
    checks.push({ name: 'Legacy Member Accounts', status: 'FAIL', issues: 1, message: error.message });
  }

  // 2. Meal Days Check
  try {
    const mealDays = await db.collection('meal_days').find({}).toArray();
    let mealIssues = 0;
    const seenDates = new Set();

    for (const md of mealDays) {
      if (!isValidLogicalDate(md.date)) {
        issues.push(`[meal_days] Invalid date format: ${md.date}`);
        mealIssues++;
      }
      if (seenDates.has(md.date)) {
        issues.push(`[meal_days] Duplicate date record: ${md.date}`);
        mealIssues++;
      }
      seenDates.add(md.date);

      for (const mealType of ['morning', 'night']) {
        const mealObj = md.meals?.[mealType] || {};
        for (const memberId of MEMBER_IDS) {
          const status = mealObj[memberId];
          if (status && !MEAL_STATUSES.includes(status)) {
            issues.push(`[meal_days] Invalid status ${status} for ${memberId} on ${md.date}`);
            mealIssues++;
          }
        }

        // Plate allocation invariants
        const alloc = md.allocations?.[mealType];
        if (alloc && alloc.mode === 'custom') {
          if (!Array.isArray(alloc.plates) || alloc.plates.length > 3) {
            issues.push(`[meal_days] Invalid custom plate allocation count on ${md.date} (${mealType})`);
            mealIssues++;
          } else {
            const memberTotalUnits = { gaurav: 0, nikhil: 0, devansh: 0 };
            for (let i = 0; i < alloc.plates.length; i++) {
              const p = alloc.plates[i];
              let plateUnits = 0;
              for (const memberId of MEMBER_IDS) {
                const units = p.shares?.[memberId] ?? 0;
                if (!Number.isInteger(units) || units < 0 || units > 6) {
                  issues.push(`[meal_days] Plate #${i + 1} on ${md.date} (${mealType}) invalid units for ${memberId}: ${units}`);
                  mealIssues++;
                }
                plateUnits += units;
                memberTotalUnits[memberId] += units;
              }
              if (plateUnits !== 6) {
                issues.push(`[meal_days] Plate #${i + 1} on ${md.date} (${mealType}) total units must equal 6, got ${plateUnits}`);
                mealIssues++;
              }
            }

            for (const memberId of MEMBER_IDS) {
              if (memberTotalUnits[memberId] > 6) {
                issues.push(`[meal_days] Member ${memberId} total units exceed 6 on ${md.date} (${mealType}): ${memberTotalUnits[memberId]}`);
                mealIssues++;
              }
            }
          }
        }

        // Price overrides validation
        const override = md.priceOverrides?.[mealType];
        if (override !== undefined && override !== null) {
          if (typeof override !== 'object') {
            issues.push(`[meal_days] Invalid price override structure on ${md.date} (${mealType})`);
            mealIssues++;
          } else {
            if (!isValidPricePaise(override.pricePaise)) {
              issues.push(`[meal_days] Invalid price override paise on ${md.date} (${mealType}): ${override.pricePaise}`);
              mealIssues++;
            }
            if (
              override.reason !== null &&
              override.reason !== undefined &&
              (typeof override.reason !== 'string' || override.reason.length > 200)
            ) {
              issues.push(`[meal_days] Price override reason exceeds 200 chars or invalid on ${md.date} (${mealType})`);
              mealIssues++;
            }
          }
        }
      }

      // Price change audit validation
      if (Array.isArray(md.priceChanges)) {
        for (const pc of md.priceChanges) {
          if (!['morning', 'night'].includes(pc.mealType)) {
            issues.push(`[meal_days] Invalid priceChange mealType on ${md.date}: ${pc.mealType}`);
            mealIssues++;
          }
          if (!['set', 'clear'].includes(pc.changeType)) {
            issues.push(`[meal_days] Invalid priceChange changeType on ${md.date}: ${pc.changeType}`);
            mealIssues++;
          }
        }
      }
    }

    checks.push({
      name: 'Meal Days',
      recordsChecked: mealDays.length,
      status: mealIssues === 0 ? 'PASS' : 'FAIL',
      issues: mealIssues,
    });
  } catch (error) {
    checks.push({ name: 'Meal Days', status: 'FAIL', issues: 1, message: error.message });
  }

  // 3. Monthly Meal Rates Check
  try {
    const rates = await db.collection('monthly_meal_rates').find({}).toArray();
    let rateIssues = 0;
    const seenMonths = new Set();

    for (const r of rates) {
      if (!isValidLogicalMonth(r.month)) {
        issues.push(`[monthly_meal_rates] Invalid month format: ${r.month}`);
        rateIssues++;
      }
      if (seenMonths.has(r.month)) {
        issues.push(`[monthly_meal_rates] Duplicate rate entry for month: ${r.month}`);
        rateIssues++;
      }
      seenMonths.add(r.month);

      if (!isValidPricePaise(r.morningPricePaise) || !isValidPricePaise(r.nightPricePaise)) {
        issues.push(`[monthly_meal_rates] Invalid price paise in month: ${r.month}`);
        rateIssues++;
      }
    }

    checks.push({
      name: 'Monthly Meal Rates',
      recordsChecked: rates.length,
      status: rateIssues === 0 ? 'PASS' : 'FAIL',
      issues: rateIssues,
    });
  } catch (error) {
    checks.push({ name: 'Monthly Meal Rates', status: 'FAIL', issues: 1, message: error.message });
  }

  // 4. Payments Check
  try {
    const payments = await db.collection('payments').find({}).toArray();
    let paymentIssues = 0;
    const seenPaymentIds = new Set();
    const seenIdempotencyKeys = new Set();

    for (const p of payments) {
      if (!isValidUuid(p.paymentId)) {
        issues.push(`[payments] Invalid UUID paymentId: ${p.paymentId}`);
        paymentIssues++;
      }
      if (seenPaymentIds.has(p.paymentId)) {
        issues.push(`[payments] Duplicate paymentId: ${p.paymentId}`);
        paymentIssues++;
      }
      seenPaymentIds.add(p.paymentId);

      if (!isValidUuid(p.idempotencyKey)) {
        issues.push(`[payments] Invalid UUID idempotencyKey: ${p.idempotencyKey}`);
        paymentIssues++;
      }
      if (seenIdempotencyKeys.has(p.idempotencyKey)) {
        issues.push(`[payments] Duplicate idempotencyKey: ${p.idempotencyKey}`);
        paymentIssues++;
      }
      seenIdempotencyKeys.add(p.idempotencyKey);

      if (!MEMBER_IDS.includes(p.memberId)) {
        issues.push(`[payments] Unknown memberId in payment: ${p.memberId}`);
        paymentIssues++;
      }

      if (!isValidPaymentAmount(p.amountPaise)) {
        issues.push(`[payments] Invalid amountPaise in payment: ${p.paymentId}`);
        paymentIssues++;
      }

      if (p.status === 'voided') {
        if (!p.voidedAt || !p.voidReason) {
          issues.push(`[payments] Voided payment missing audit metadata: ${p.paymentId}`);
          paymentIssues++;
        }
      } else if (p.status === 'recorded') {
        if (p.voidedAt !== null || p.voidReason !== null) {
          issues.push(`[payments] Active payment has void metadata set: ${p.paymentId}`);
          paymentIssues++;
        }
      } else {
        issues.push(`[payments] Unknown payment status ${p.status} in ${p.paymentId}`);
        paymentIssues++;
      }
    }

    checks.push({
      name: 'Payments',
      recordsChecked: payments.length,
      status: paymentIssues === 0 ? 'PASS' : 'FAIL',
      issues: paymentIssues,
    });
  } catch (error) {
    checks.push({ name: 'Payments', status: 'FAIL', issues: 1, message: error.message });
  }

  // 5. Monthly Settlements Check
  try {
    const settlements = await db.collection('monthly_settlements').find({}).toArray();
    let settlementIssues = 0;
    const closedMonths = new Set();

    for (const s of settlements) {
      if (!isValidLogicalMonth(s.month)) {
        issues.push(`[monthly_settlements] Invalid month: ${s.month}`);
        settlementIssues++;
      }

      if (s.status === 'closed') {
        if (closedMonths.has(s.month)) {
          issues.push(`[monthly_settlements] Multiple active closed settlements for month: ${s.month}`);
          settlementIssues++;
        }
        closedMonths.add(s.month);

        // Verify member totals match room totals
        const membersSnapshot = s.snapshot?.members || {};
        const roomSnapshot = s.snapshot?.room || {};
        let summedMorning = 0;
        let summedNight = 0;
        let summedPlates = 0;
        let summedBill = 0;
        let summedPaid = 0;

        for (const memberId of MEMBER_IDS) {
          const mem = membersSnapshot[memberId] || {};
          summedMorning += mem.morningCount || 0;
          summedNight += mem.nightCount || 0;
          summedPlates += mem.totalPlates || 0;
          summedBill += mem.billAmountPaise || 0;
          summedPaid += mem.paidAmountPaise || 0;

          if (mem.remainingAmountPaise !== 0) {
            issues.push(`[monthly_settlements] Closed settlement member ${memberId} has remainingAmountPaise != 0 (${mem.remainingAmountPaise})`);
            settlementIssues++;
          }
        }

        if (
          summedMorning !== roomSnapshot.morningCount ||
          summedNight !== roomSnapshot.nightCount ||
          summedPlates !== roomSnapshot.totalPlates ||
          summedBill !== roomSnapshot.billAmountPaise ||
          summedPaid !== roomSnapshot.paidAmountPaise
        ) {
          issues.push(`[monthly_settlements] Closed snapshot member sums do not equal room total in month: ${s.month}`);
          settlementIssues++;
        }
      }
    }

    checks.push({
      name: 'Monthly Settlements',
      recordsChecked: settlements.length,
      status: settlementIssues === 0 ? 'PASS' : 'FAIL',
      issues: settlementIssues,
    });
  } catch (error) {
    checks.push({ name: 'Monthly Settlements', status: 'FAIL', issues: 1, message: error.message });
  }

  // 6. Settings Singleton Check
  try {
    const paymentSettings = await db.collection('payment_settings').find({}).toArray();
    const reminderSettings = await db.collection('reminder_settings').find({}).toArray();
    let settingsIssues = 0;

    if (paymentSettings.length > 1) {
      issues.push(`[payment_settings] Multiple payment settings records found: ${paymentSettings.length}`);
      settingsIssues++;
    }
    if (reminderSettings.length > 1) {
      issues.push(`[reminder_settings] Multiple reminder settings records found: ${reminderSettings.length}`);
      settingsIssues++;
    }

    for (const rs of reminderSettings) {
      if (
        !isValidLogicalTime(rs.reminders?.morning?.time) ||
        !isValidLogicalTime(rs.reminders?.night?.time)
      ) {
        issues.push('[reminder_settings] Invalid HH:mm time in reminder settings');
        settingsIssues++;
      }
    }

    checks.push({
      name: 'Settings Singletons',
      recordsChecked: paymentSettings.length + reminderSettings.length,
      status: settingsIssues === 0 ? 'PASS' : 'FAIL',
      issues: settingsIssues,
    });
  } catch (error) {
    checks.push({ name: 'Settings Singletons', status: 'FAIL', issues: 1, message: error.message });
  }

  // 7. Room Fees Integrity Check
  try {
    const rooms = await db.collection('rooms').find({}).toArray();
    const assignments = await db.collection('room_assignments').find({}).toArray();
    const feePlans = await db.collection('room_fee_plans').find({}).toArray();
    const roomCharges = await db.collection('room_charges').find({}).toArray();
    const roomPayments = await db.collection('room_payments').find({}).toArray();
    const roomPaymentSettings = await db.collection('room_payment_settings').find({}).toArray();

    let roomIssues = 0;

    for (const r of rooms) {
      if (!isValidUuid(r.roomId)) {
        issues.push(`[rooms] Invalid roomId UUID: ${r.roomId}`);
        roomIssues++;
      }
      if (!r.roomNumber || typeof r.roomNumber !== 'string') {
        issues.push(`[rooms] Missing roomNumber for room ${r.roomId}`);
        roomIssues++;
      }
      if (!Number.isInteger(r.capacity) || r.capacity < 1) {
        issues.push(`[rooms] Invalid capacity for room ${r.roomNumber}`);
        roomIssues++;
      }
    }

    for (const a of assignments) {
      if (!isValidUuid(a.assignmentId)) {
        issues.push(`[room_assignments] Invalid assignmentId UUID: ${a.assignmentId}`);
        roomIssues++;
      }
      if (!MEMBER_IDS.includes(a.memberId)) {
        issues.push(`[room_assignments] Invalid memberId: ${a.memberId}`);
        roomIssues++;
      }
      if (!isValidLogicalMonth(a.effectiveFromMonth)) {
        issues.push(`[room_assignments] Invalid effectiveFromMonth: ${a.effectiveFromMonth}`);
        roomIssues++;
      }
    }

    for (const p of feePlans) {
      if (!isValidUuid(p.feePlanId)) {
        issues.push(`[room_fee_plans] Invalid feePlanId UUID: ${p.feePlanId}`);
        roomIssues++;
      }
      if (!MEMBER_IDS.includes(p.memberId)) {
        issues.push(`[room_fee_plans] Invalid memberId: ${p.memberId}`);
        roomIssues++;
      }
      if (!Number.isSafeInteger(p.amountPaise) || p.amountPaise < 0) {
        issues.push(`[room_fee_plans] Invalid amountPaise for plan: ${p.feePlanId}`);
        roomIssues++;
      }
      if (!isValidLogicalMonth(p.effectiveFromMonth)) {
        issues.push(`[room_fee_plans] Invalid effectiveFromMonth: ${p.effectiveFromMonth}`);
        roomIssues++;
      }
    }

    for (const c of roomCharges) {
      if (!isValidUuid(c.chargeId)) {
        issues.push(`[room_charges] Invalid chargeId UUID: ${c.chargeId}`);
        roomIssues++;
      }
      if (!MEMBER_IDS.includes(c.memberId)) {
        issues.push(`[room_charges] Invalid memberId: ${c.memberId}`);
        roomIssues++;
      }
      if (!isValidLogicalMonth(c.month)) {
        issues.push(`[room_charges] Invalid month: ${c.month}`);
        roomIssues++;
      }
      if (!Number.isSafeInteger(c.baseAmountPaise) || c.baseAmountPaise < 0) {
        issues.push(`[room_charges] Invalid baseAmountPaise for charge: ${c.chargeId}`);
        roomIssues++;
      }
      const adjTotal = (c.adjustments || []).reduce((sum, adj) => sum + adj.amountPaise, 0);
      if (c.baseAmountPaise + adjTotal < 0) {
        issues.push(`[room_charges] Final bill cannot be negative for charge: ${c.chargeId}`);
        roomIssues++;
      }
    }

    for (const p of roomPayments) {
      if (!isValidUuid(p.roomPaymentId)) {
        issues.push(`[room_payments] Invalid roomPaymentId UUID: ${p.roomPaymentId}`);
        roomIssues++;
      }
      if (!MEMBER_IDS.includes(p.memberId)) {
        issues.push(`[room_payments] Invalid memberId: ${p.memberId}`);
        roomIssues++;
      }
      if (!Number.isSafeInteger(p.amountPaise) || p.amountPaise <= 0) {
        issues.push(`[room_payments] Invalid payment amountPaise for payment: ${p.roomPaymentId}`);
        roomIssues++;
      }
      if (!['upi', 'cash', 'bank_transfer', 'other'].includes(p.method)) {
        issues.push(`[room_payments] Invalid payment method for payment: ${p.roomPaymentId}`);
        roomIssues++;
      }
    }

    if (roomPaymentSettings.length > 1) {
      issues.push(`[room_payment_settings] Multiple room payment settings records found: ${roomPaymentSettings.length}`);
      roomIssues++;
    }

    const totalRoomRecords =
      rooms.length +
      assignments.length +
      feePlans.length +
      roomCharges.length +
      roomPayments.length +
      roomPaymentSettings.length;

    checks.push({
      name: 'Room Fees Domain',
      recordsChecked: totalRoomRecords,
      status: roomIssues === 0 ? 'PASS' : 'FAIL',
      issues: roomIssues,
    });
  } catch (error) {
    checks.push({ name: 'Room Fees Domain', status: 'FAIL', issues: 1, message: error.message });
  }

  const overallPassed = checks.every((c) => c.status === 'PASS');
  return { passed: overallPassed, checks, issues };
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith('verifyData.js')) {
  if (!env.mongoUri) {
    console.error('ERROR: MONGODB_URI is required to run data integrity verification.');
    process.exit(1);
  }

  console.info('Connecting to MongoDB for read-only data consistency audit...');
  try {
    await connectDatabase();
    const { passed, checks, issues } = await verifyDataIntegrity(mongoose.connection);

    console.info('\n--- Data Consistency Report ---');
    for (const c of checks) {
      const mark = c.status === 'PASS' ? '✓' : '✗';
      console.info(`${mark} [${c.status}] ${c.name}: ${c.recordsChecked ?? 0} records (${c.issues} issues)`);
    }
    console.info('-------------------------------\n');

    if (issues.length > 0) {
      console.warn('Issues detected:');
      for (const issue of issues) {
        console.warn(`  - ${issue}`);
      }
      console.info('');
    }

    await disconnectDatabase();

    if (!passed) {
      console.error('Data consistency audit failed.');
      process.exit(1);
    }
    console.info('All data consistency checks passed.');
    process.exit(0);
  } catch (error) {
    console.error(`Data integrity check error: ${error.message}`);
    process.exit(1);
  }
}
