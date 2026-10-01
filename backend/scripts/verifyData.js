import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
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

  // 1. Member Accounts Check
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
      name: 'Member Accounts',
      recordsChecked: members.length,
      status: memberIssues === 0 ? 'PASS' : 'FAIL',
      issues: memberIssues,
    });
  } catch (error) {
    checks.push({ name: 'Member Accounts', status: 'FAIL', issues: 1, message: error.message });
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
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 });
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

    await mongoose.disconnect();

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
