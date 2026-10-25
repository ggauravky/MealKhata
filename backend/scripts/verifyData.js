import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { MEMBER_IDS } from '../src/config/members.js';
import { getLogicalDateInTimeZone, isValidLogicalDate } from '../src/utils/date.js';
import { isValidLogicalMonth, lastDateOfMonth } from '../src/utils/month.js';
import { isValidPaymentAmount, isValidUuid } from '../src/payments/payment.constants.js';
import { isValidPricePaise } from '../src/billing/monthlyRate.constants.js';
import { isValidLogicalTime } from '../src/settings/reminder.constants.js';
import { MEAL_STATUSES } from '../src/meals/meal.constants.js';
import { EXPENSE_CATEGORIES } from '../src/expenses/expense.constants.js';

function assignmentInterval(assignment) {
  return {
    start: assignment.effectiveFromDate || `${assignment.effectiveFromMonth}-01`,
    end: assignment.effectiveUntilDate
      || (assignment.effectiveUntilMonth ? lastDateOfMonth(assignment.effectiveUntilMonth) : '9999-12-31'),
  };
}

function feePlanInterval(plan) {
  return {
    start: plan.effectiveFromMonth,
    end: plan.effectiveUntilMonth || '9999-12',
  };
}

function intervalsOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}

function overlappingPairs(records, intervalFor) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < records.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex++) {
      if (intervalsOverlap(intervalFor(records[leftIndex]), intervalFor(records[rightIndex]))) {
        pairs.push([records[leftIndex], records[rightIndex]]);
      }
    }
  }
  return pairs;
}

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
    const roomMap = new Map(rooms.map((room) => [room.roomId, room]));
    const feePlanMap = new Map(feePlans.map((plan) => [plan.feePlanId, plan]));
    const chargeMap = new Map(roomCharges.map((charge) => [charge.chargeId, charge]));

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
      if (!roomMap.has(a.roomId)) {
        issues.push(`[room_assignments] Assignment ${a.assignmentId} references missing room ${a.roomId}`);
        roomIssues++;
      }
      if (a.effectiveUntilMonth && !isValidLogicalMonth(a.effectiveUntilMonth)) {
        issues.push(`[room_assignments] Invalid effectiveUntilMonth: ${a.effectiveUntilMonth}`);
        roomIssues++;
      }
      if (a.effectiveFromDate && !isValidLogicalDate(a.effectiveFromDate)) {
        issues.push(`[room_assignments] Invalid effectiveFromDate: ${a.effectiveFromDate}`);
        roomIssues++;
      }
      if (a.effectiveUntilDate && !isValidLogicalDate(a.effectiveUntilDate)) {
        issues.push(`[room_assignments] Invalid effectiveUntilDate: ${a.effectiveUntilDate}`);
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
      if (p.effectiveUntilMonth && !isValidLogicalMonth(p.effectiveUntilMonth)) {
        issues.push(`[room_fee_plans] Invalid effectiveUntilMonth: ${p.effectiveUntilMonth}`);
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
      if (!roomMap.has(c.roomId)) {
        issues.push(`[room_charges] Charge ${c.chargeId} references missing room ${c.roomId}`);
        roomIssues++;
      }
      const feePlan = feePlanMap.get(c.feePlanId);
      if (!feePlan) {
        issues.push(`[room_charges] Charge ${c.chargeId} references missing fee plan ${c.feePlanId}`);
        roomIssues++;
      } else if (feePlan.memberId !== c.memberId) {
        issues.push(`[room_charges] Charge ${c.chargeId} member does not match fee plan ${c.feePlanId}`);
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
      const charge = chargeMap.get(p.chargeId);
      if (!charge) {
        issues.push(`[room_payments] Payment ${p.roomPaymentId} references missing charge ${p.chargeId}`);
        roomIssues++;
      } else if (charge.memberId !== p.memberId || charge.month !== p.month) {
        issues.push(`[room_payments] Payment ${p.roomPaymentId} member or month does not match charge ${p.chargeId}`);
        roomIssues++;
      }
    }

    const assignmentsWithValidIntervals = assignments.filter((assignment) => (
      isValidLogicalMonth(assignment.effectiveFromMonth)
      && (!assignment.effectiveUntilMonth || isValidLogicalMonth(assignment.effectiveUntilMonth))
      && (!assignment.effectiveFromDate || isValidLogicalDate(assignment.effectiveFromDate))
      && (!assignment.effectiveUntilDate || isValidLogicalDate(assignment.effectiveUntilDate))
    ));
    const assignmentsWithOrderedIntervals = assignmentsWithValidIntervals.filter((assignment) => {
      const interval = assignmentInterval(assignment);
      if (interval.end < interval.start) {
        issues.push(`[room_assignments] Assignment ${assignment.assignmentId} ends before it starts (${interval.start} to ${interval.end})`);
        roomIssues++;
        return false;
      }
      return true;
    });
    const activeAssignments = assignmentsWithOrderedIntervals.filter((assignment) => !assignment.cancelledAt);
    for (const memberId of new Set(activeAssignments.map((assignment) => assignment.memberId))) {
      const memberAssignments = activeAssignments.filter((assignment) => assignment.memberId === memberId);
      for (const [left, right] of overlappingPairs(memberAssignments, assignmentInterval)) {
        issues.push(`[room_assignments] Overlapping room assignments for member ${memberId}: ${left.assignmentId} and ${right.assignmentId}`);
        roomIssues++;
      }
    }

    for (const room of rooms) {
      const roomAssignments = activeAssignments.filter((assignment) => assignment.roomId === room.roomId);
      let capacityReported = false;
      for (const candidate of roomAssignments) {
        const candidateStart = assignmentInterval(candidate).start;
        const occupancy = roomAssignments.filter((assignment) => {
          const interval = assignmentInterval(assignment);
          return interval.start <= candidateStart && interval.end >= candidateStart;
        }).length;
        if (occupancy > room.capacity) {
          issues.push(`[room_assignments] Room ${room.roomNumber} exceeds capacity ${room.capacity} on ${candidateStart} (${occupancy} assignments)`);
          roomIssues++;
          capacityReported = true;
          break;
        }
      }
      if (capacityReported) continue;
    }

    const validFeePlans = feePlans.filter((plan) => (
      isValidLogicalMonth(plan.effectiveFromMonth)
      && (!plan.effectiveUntilMonth || isValidLogicalMonth(plan.effectiveUntilMonth))
    ));
    const orderedFeePlans = validFeePlans.filter((plan) => {
      const interval = feePlanInterval(plan);
      if (interval.end < interval.start) {
        issues.push(`[room_fee_plans] Fee plan ${plan.feePlanId} ends before it starts (${interval.start} to ${interval.end})`);
        roomIssues++;
        return false;
      }
      return true;
    });
    const activeFeePlans = orderedFeePlans.filter((plan) => !plan.supersededAt);
    for (const memberId of new Set(activeFeePlans.map((plan) => plan.memberId))) {
      const memberPlans = activeFeePlans.filter((plan) => plan.memberId === memberId);
      for (const [left, right] of overlappingPairs(memberPlans, feePlanInterval)) {
        issues.push(`[room_fee_plans] Overlapping fee plans for member ${memberId}: ${left.feePlanId} and ${right.feePlanId}`);
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

  // 8. Other Expenses & Shared Spending Check
  try {
    const expenses = await db.collection('expenses').find({}).toArray();
    const reimbursements = await db.collection('expense_reimbursements').find({}).toArray();
    let expenseIssues = 0;

    const seenExpenseIds = new Set();
    const seenExpenseIdempotency = new Set();
    const expenseMap = new Map();

    for (const exp of expenses) {
      if (!isValidUuid(exp.expenseId)) {
        issues.push(`[expenses] Invalid expenseId UUID: ${exp.expenseId}`);
        expenseIssues++;
      }
      if (seenExpenseIds.has(exp.expenseId)) {
        issues.push(`[expenses] Duplicate expenseId found: ${exp.expenseId}`);
        expenseIssues++;
      }
      seenExpenseIds.add(exp.expenseId);
      expenseMap.set(exp.expenseId, exp);

      if (exp.idempotencyKey) {
        if (!isValidUuid(exp.idempotencyKey)) {
          issues.push(`[expenses] Invalid idempotencyKey UUID: ${exp.idempotencyKey}`);
          expenseIssues++;
        }
        if (seenExpenseIdempotency.has(exp.idempotencyKey)) {
          issues.push(`[expenses] Duplicate idempotencyKey in expenses: ${exp.idempotencyKey}`);
          expenseIssues++;
        }
        seenExpenseIdempotency.add(exp.idempotencyKey);
      }

      if (!MEMBER_IDS.includes(exp.paidByMemberId)) {
        issues.push(`[expenses] Invalid paidByMemberId: ${exp.paidByMemberId}`);
        expenseIssues++;
      }

      if (!EXPENSE_CATEGORIES.includes(exp.category)) {
        issues.push(`[expenses] Invalid category: ${exp.category}`);
        expenseIssues++;
      }

      if (!isValidLogicalDate(exp.date)) {
        issues.push(`[expenses] Invalid date: ${exp.date}`);
        expenseIssues++;
      }

      if (!isValidLogicalMonth(exp.month) || exp.month !== exp.date.slice(0, 7)) {
        issues.push(`[expenses] Mismatched or invalid month: ${exp.month} for date ${exp.date}`);
        expenseIssues++;
      }

      if (!Number.isSafeInteger(exp.amountPaise) || exp.amountPaise <= 0) {
        issues.push(`[expenses] Invalid amountPaise: ${exp.amountPaise}`);
        expenseIssues++;
      }

      if (!Array.isArray(exp.allocations) || exp.allocations.length === 0) {
        issues.push(`[expenses] Missing or empty allocations array for expense: ${exp.expenseId}`);
        expenseIssues++;
      } else {
        let allocationSum = 0;
        const seenAllocMembers = new Set();
        for (const alloc of exp.allocations) {
          if (!MEMBER_IDS.includes(alloc.memberId)) {
            issues.push(`[expenses] Invalid memberId in allocation: ${alloc.memberId}`);
            expenseIssues++;
          }
          if (seenAllocMembers.has(alloc.memberId)) {
            issues.push(`[expenses] Duplicate memberId in allocations: ${alloc.memberId}`);
            expenseIssues++;
          }
          seenAllocMembers.add(alloc.memberId);

          if (!Number.isSafeInteger(alloc.amountPaise) || alloc.amountPaise < 0) {
            issues.push(`[expenses] Invalid allocation amountPaise: ${alloc.amountPaise}`);
            expenseIssues++;
          }
          allocationSum += alloc.amountPaise || 0;
        }

        if (allocationSum !== exp.amountPaise) {
          issues.push(
            `[expenses] Allocation sum (${allocationSum}) does not match expense amount (${exp.amountPaise}) for: ${exp.expenseId}`,
          );
          expenseIssues++;
        }
      }

      if (exp.status === 'voided') {
        if (!exp.voidedAt || !exp.voidReason) {
          issues.push(`[expenses] Voided expense missing audit metadata: ${exp.expenseId}`);
          expenseIssues++;
        }
      } else if (exp.status !== 'recorded') {
        issues.push(`[expenses] Unknown status: ${exp.status}`);
        expenseIssues++;
      }
    }

    const seenReimbursementIds = new Set();
    const seenReimbursementIdempotency = new Set();
    const reimbursementsByExpenseAndMember = new Map();

    for (const r of reimbursements) {
      if (!isValidUuid(r.reimbursementId)) {
        issues.push(`[expense_reimbursements] Invalid reimbursementId UUID: ${r.reimbursementId}`);
        expenseIssues++;
      }
      if (seenReimbursementIds.has(r.reimbursementId)) {
        issues.push(`[expense_reimbursements] Duplicate reimbursementId: ${r.reimbursementId}`);
        expenseIssues++;
      }
      seenReimbursementIds.add(r.reimbursementId);

      if (r.idempotencyKey) {
        if (!isValidUuid(r.idempotencyKey)) {
          issues.push(`[expense_reimbursements] Invalid idempotencyKey: ${r.idempotencyKey}`);
          expenseIssues++;
        }
        if (seenReimbursementIdempotency.has(r.idempotencyKey)) {
          issues.push(`[expense_reimbursements] Duplicate idempotencyKey in reimbursements: ${r.idempotencyKey}`);
          expenseIssues++;
        }
        seenReimbursementIdempotency.add(r.idempotencyKey);
      }

      const referencedExpense = expenseMap.get(r.expenseId);
      if (!referencedExpense) {
        issues.push(`[expense_reimbursements] Reimbursement references nonexistent expenseId: ${r.expenseId}`);
        expenseIssues++;
      } else {
        if (r.toMemberId !== referencedExpense.paidByMemberId) {
          issues.push(
            `[expense_reimbursements] toMemberId (${r.toMemberId}) does not match original payer (${referencedExpense.paidByMemberId})`,
          );
          expenseIssues++;
        }
      }

      if (!MEMBER_IDS.includes(r.fromMemberId)) {
        issues.push(`[expense_reimbursements] Invalid fromMemberId: ${r.fromMemberId}`);
        expenseIssues++;
      }
      if (!MEMBER_IDS.includes(r.toMemberId)) {
        issues.push(`[expense_reimbursements] Invalid toMemberId: ${r.toMemberId}`);
        expenseIssues++;
      }
      if (r.fromMemberId === r.toMemberId) {
        issues.push(`[expense_reimbursements] fromMemberId equals toMemberId: ${r.fromMemberId}`);
        expenseIssues++;
      }

      if (!Number.isSafeInteger(r.amountPaise) || r.amountPaise <= 0) {
        issues.push(`[expense_reimbursements] Invalid amountPaise: ${r.amountPaise}`);
        expenseIssues++;
      }

      if (!['upi', 'cash', 'bank_transfer', 'other'].includes(r.method)) {
        issues.push(`[expense_reimbursements] Invalid method: ${r.method}`);
        expenseIssues++;
      }

      if (r.status === 'voided') {
        if (!r.voidedAt || !r.voidReason) {
          issues.push(`[expense_reimbursements] Voided reimbursement missing audit metadata: ${r.reimbursementId}`);
          expenseIssues++;
        }
      } else if (r.status === 'recorded') {
        const key = `${r.expenseId}:${r.fromMemberId}`;
        const currentSum = reimbursementsByExpenseAndMember.get(key) || 0;
        reimbursementsByExpenseAndMember.set(key, currentSum + r.amountPaise);
      } else {
        issues.push(`[expense_reimbursements] Unknown status: ${r.status}`);
        expenseIssues++;
      }
    }

    for (const [key, totalReimbursed] of reimbursementsByExpenseAndMember.entries()) {
      const [expenseId, fromMemberId] = key.split(':');
      const exp = expenseMap.get(expenseId);
      if (exp) {
        const alloc = (exp.allocations || []).find((a) => a.memberId === fromMemberId);
        const maxAllowed = alloc ? alloc.amountPaise : 0;
        if (totalReimbursed > maxAllowed) {
          issues.push(
            `[expense_reimbursements] Active reimbursements (${totalReimbursed}) exceed allocation (${maxAllowed}) for ${fromMemberId} on expense ${expenseId}`,
          );
          expenseIssues++;
        }
      }
    }

    checks.push({
      name: 'Other Expenses Domain',
      recordsChecked: expenses.length + reimbursements.length,
      status: expenseIssues === 0 ? 'PASS' : 'FAIL',
      issues: expenseIssues,
    });
  } catch (error) {
    checks.push({ name: 'Other Expenses Domain', status: 'FAIL', issues: 1, message: error.message });
  }

  // 7. Hostel Stays & Lifecycle Domain
  try {
    const stays = await db.collection('hostel_stays').find({}).toArray();
    const rooms = await db.collection('rooms').find({}).toArray();
    const assignments = await db.collection('room_assignments').find({}).toArray();
    const feePlans = await db.collection('room_fee_plans').find({}).toArray();
    let stayIssues = 0;
    const activeStayMembers = new Set();
    const roomIds = new Set(rooms.map((room) => room.roomId));
    const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
    const feePlanIds = new Set(feePlans.map((plan) => plan.feePlanId));
    const currentDate = getLogicalDateInTimeZone();

    for (const s of stays) {
      if (!s.stayId || typeof s.stayId !== 'string') {
        issues.push(`[hostel_stays] Invalid stayId for stay: ${s._id}`);
        stayIssues++;
      }

      if (!MEMBER_IDS.includes(s.memberId)) {
        issues.push(`[hostel_stays] Invalid memberId: ${s.memberId} in stay ${s.stayId}`);
        stayIssues++;
      }

      if (!isValidLogicalDate(s.joinedOn)) {
        issues.push(`[hostel_stays] Invalid joinedOn date: ${s.joinedOn} in stay ${s.stayId}`);
        stayIssues++;
      }

      if (s.actualLeftOn && !isValidLogicalDate(s.actualLeftOn)) {
        issues.push(`[hostel_stays] Invalid actualLeftOn date: ${s.actualLeftOn} in stay ${s.stayId}`);
        stayIssues++;
      }

      if (s.actualLeftOn && s.joinedOn && s.actualLeftOn < s.joinedOn) {
        issues.push(`[hostel_stays] actualLeftOn (${s.actualLeftOn}) precedes joinedOn (${s.joinedOn}) in stay ${s.stayId}`);
        stayIssues++;
      }

      if (s.status === 'CHECKED_OUT' && !s.actualLeftOn) {
        issues.push(`[hostel_stays] Checked out stay ${s.stayId} missing actualLeftOn`);
        stayIssues++;
      }

      if (s.initialRoomId && !roomIds.has(s.initialRoomId)) {
        issues.push(`[hostel_stays] Stay ${s.stayId} initialRoomId references missing room ${s.initialRoomId}`);
        stayIssues++;
      }
      if (s.currentRoomId && !roomIds.has(s.currentRoomId)) {
        issues.push(`[hostel_stays] Stay ${s.stayId} currentRoomId references missing room ${s.currentRoomId}`);
        stayIssues++;
      }
      if (s.admissionAssignmentId && !assignmentIds.has(s.admissionAssignmentId)) {
        issues.push(`[hostel_stays] Stay ${s.stayId} references missing admission assignment ${s.admissionAssignmentId}`);
        stayIssues++;
      }
      if (s.admissionFeePlanId && !feePlanIds.has(s.admissionFeePlanId)) {
        issues.push(`[hostel_stays] Stay ${s.stayId} references missing admission fee plan ${s.admissionFeePlanId}`);
        stayIssues++;
      }

      if (['ACTIVE', 'CHECKOUT_REQUESTED', 'CHECKOUT_PENDING'].includes(s.status)) {
        if (activeStayMembers.has(s.memberId)) {
          issues.push(`[hostel_stays] Member ${s.memberId} has multiple active or pending stays`);
          stayIssues++;
        }
        activeStayMembers.add(s.memberId);
        const currentAssignments = assignments.filter((assignment) => {
          if (assignment.cancelledAt || assignment.memberId !== s.memberId || assignment.roomId !== s.currentRoomId) return false;
          const interval = assignmentInterval(assignment);
          return interval.start <= currentDate && currentDate <= interval.end;
        });
        if (currentAssignments.length !== 1) {
          issues.push(`[hostel_stays] Active or pending stay ${s.stayId} has no uncancelled current Room Assignment matching member ${s.memberId} and room ${s.currentRoomId}`);
          stayIssues++;
        }
      }
    }

    checks.push({
      name: 'Hostel Stays & Lifecycle',
      recordsChecked: stays.length,
      status: stayIssues === 0 ? 'PASS' : 'FAIL',
      issues: stayIssues,
    });
  } catch (error) {
    checks.push({ name: 'Hostel Stays & Lifecycle', status: 'FAIL', issues: 1, message: error.message });
  }

  // 8. Security Deposits & Clearances Domain
  try {
    const accounts = await db.collection('hostel_deposit_accounts').find({}).toArray();
    const transactions = await db.collection('hostel_deposit_transactions').find({}).toArray();
    const clearances = await db.collection('hostel_clearances').find({}).toArray();
    const stays = await db.collection('hostel_stays').find({}).toArray();
    let depositIssues = 0;

    const stayMap = new Map(stays.map((stay) => [stay.stayId, stay]));
    const recordedTransactionsByAccount = new Map();
    for (const transaction of transactions) {
      if (transaction.status !== 'recorded') continue;
      recordedTransactionsByAccount.set(
        transaction.depositAccountId,
        (recordedTransactionsByAccount.get(transaction.depositAccountId) || 0) + 1,
      );
    }
    const accountMap = new Map();
    const accountIdMap = new Map();
    for (const a of accounts) {
      if (accountMap.has(a.stayId)) {
        issues.push(`[hostel_deposit_accounts] Multiple deposit accounts reference stay ${a.stayId}`);
        depositIssues++;
      }
      accountMap.set(a.stayId, a);
      accountIdMap.set(a.depositAccountId, a);
      if (typeof a.expectedDepositPaise !== 'number' || a.expectedDepositPaise < 0) {
        issues.push(`[hostel_deposit_accounts] Invalid expectedDepositPaise in account ${a.depositAccountId}`);
        depositIssues++;
      }
      if (!['NOT_REQUIRED', 'OPEN', 'SETTLED'].includes(a.status)) {
        issues.push(`[hostel_deposit_accounts] Invalid status ${a.status} in account ${a.depositAccountId}`);
        depositIssues++;
      }
      if (a.status === 'NOT_REQUIRED' && a.expectedDepositPaise !== 0) {
        issues.push(`[hostel_deposit_accounts] NOT_REQUIRED account ${a.depositAccountId} must have zero expected deposit`);
        depositIssues++;
      }
      if (a.status === 'NOT_REQUIRED' && (recordedTransactionsByAccount.get(a.depositAccountId) || 0) > 0) {
        issues.push(`[hostel_deposit_accounts] NOT_REQUIRED account ${a.depositAccountId} has recorded deposit transactions`);
        depositIssues++;
      }
      const stay = stayMap.get(a.stayId);
      if (!stay) {
        issues.push(`[hostel_deposit_accounts] Deposit account ${a.depositAccountId} references missing stay ${a.stayId}`);
        depositIssues++;
      } else {
        if (a.memberId !== stay.memberId) {
          issues.push(`[hostel_deposit_accounts] Deposit account ${a.depositAccountId} member does not match stay ${a.stayId}`);
          depositIssues++;
        }
        if (stay.status === 'CHECKED_OUT' && a.status === 'OPEN') {
          issues.push(`[hostel_deposit_accounts] Checked-out stay ${a.stayId} has OPEN deposit account ${a.depositAccountId}`);
          depositIssues++;
        }
      }
    }

    // Ledger balance verification per stay
    const totalsByStay = new Map();
    for (const tx of transactions) {
      if (typeof tx.amountPaise !== 'number' || tx.amountPaise <= 0 || !Number.isInteger(tx.amountPaise)) {
        issues.push(`[hostel_deposit_transactions] Non-positive or non-integer amount in tx ${tx.depositTransactionId}`);
        depositIssues++;
      }

      const referencedStay = stayMap.get(tx.stayId);
      if (!referencedStay) {
        issues.push(`[hostel_deposit_transactions] Transaction ${tx.depositTransactionId} references missing stay ${tx.stayId}`);
        depositIssues++;
      } else if (tx.memberId !== referencedStay.memberId) {
        issues.push(`[hostel_deposit_transactions] Transaction ${tx.depositTransactionId} member does not match stay ${tx.stayId}`);
        depositIssues++;
      }
      const referencedAccount = accountIdMap.get(tx.depositAccountId);
      if (!referencedAccount) {
        issues.push(`[hostel_deposit_transactions] Transaction ${tx.depositTransactionId} references missing deposit account ${tx.depositAccountId}`);
        depositIssues++;
      } else if (referencedAccount.stayId !== tx.stayId) {
        issues.push(`[hostel_deposit_transactions] Transaction ${tx.depositTransactionId} stay does not match deposit account ${tx.depositAccountId}`);
        depositIssues++;
      }

      if (tx.status === 'recorded') {
        const current = totalsByStay.get(tx.stayId) || { received: 0, refunded: 0, deducted: 0 };
        if (tx.type === 'RECEIVED') current.received += tx.amountPaise;
        else if (tx.type === 'REFUNDED') current.refunded += tx.amountPaise;
        else if (tx.type === 'DEDUCTED') current.deducted += tx.amountPaise;
        totalsByStay.set(tx.stayId, current);
      }
    }

    for (const [stayId, totals] of totalsByStay.entries()) {
      const held = totals.received - totals.refunded - totals.deducted;
      if (held < 0) {
        issues.push(`[hostel_deposit_transactions] Negative held balance (${held}) in stay ${stayId}`);
        depositIssues++;
      }
    }

    const seenClearanceKeys = new Set();
    const clearanceMap = new Map(clearances.map((clearance) => [clearance.clearanceId, clearance]));
    const activeClearancesByStay = new Map();
    for (const c of clearances) {
      const key = `${c.stayId}:${c.sequence}`;
      if (seenClearanceKeys.has(key)) {
        issues.push(`[hostel_clearances] Duplicate clearance sequence ${c.sequence} for stay ${c.stayId}`);
        depositIssues++;
      }
      seenClearanceKeys.add(key);

      const referencedStay = stayMap.get(c.stayId);
      if (!referencedStay) {
        issues.push(`[hostel_clearances] Clearance ${c.clearanceId} references missing stay ${c.stayId}`);
        depositIssues++;
      } else if (c.memberId !== referencedStay.memberId) {
        issues.push(`[hostel_clearances] Clearance ${c.clearanceId} member does not match stay ${c.stayId}`);
        depositIssues++;
      }

      const validityStatus = c.validityStatus || 'ACTIVE';
      if (validityStatus === 'ACTIVE') {
        activeClearancesByStay.set(c.stayId, (activeClearancesByStay.get(c.stayId) || 0) + 1);
      }
      if (!['ACTIVE', 'REVOKED', 'SUPERSEDED'].includes(validityStatus)) {
        issues.push(`[hostel_clearances] Clearance ${c.clearanceId} has invalid validityStatus ${c.validityStatus}`);
        depositIssues++;
      }
      if (validityStatus === 'REVOKED' && (!c.revokedAt || !c.revokedByRole || !c.revocationReason || !c.restorationId)) {
        issues.push(`[hostel_clearances] Revoked clearance ${c.clearanceId} is missing revocation audit metadata`);
        depositIssues++;
      }
      if (
        validityStatus === 'SUPERSEDED'
        && (!c.supersededAt || !c.supersededByRole || !c.supersessionReason || !c.supersededByClearanceId)
      ) {
        issues.push(`[hostel_clearances] Superseded clearance ${c.clearanceId} is missing supersession audit metadata`);
        depositIssues++;
      }
      if (validityStatus === 'SUPERSEDED' && c.supersededByClearanceId) {
        const replacement = clearanceMap.get(c.supersededByClearanceId);
        if (!replacement || replacement.stayId !== c.stayId || replacement.sequence <= c.sequence) {
          issues.push(`[hostel_clearances] Superseded clearance ${c.clearanceId} references invalid replacement ${c.supersededByClearanceId}`);
          depositIssues++;
        }
      }
      if (referencedStay && ['ACTIVE', 'CHECKOUT_REQUESTED', 'CHECKOUT_PENDING'].includes(referencedStay.status) && validityStatus === 'ACTIVE') {
        issues.push(`[hostel_clearances] Active stay ${c.stayId} has active clearance ${c.clearanceId}`);
        depositIssues++;
      }

      if (c.clearanceStatus === 'NO_DUES' && c.depositSummary?.heldPaise > 0) {
        issues.push(`[hostel_clearances] No-Dues clearance ${c.clearanceId} has unrefunded deposit (${c.depositSummary.heldPaise})`);
        depositIssues++;
      }
    }

    for (const stay of stays.filter((candidate) => candidate.status === 'CHECKED_OUT')) {
      const activeCount = activeClearancesByStay.get(stay.stayId) || 0;
      if (activeCount === 0) {
        issues.push(`[hostel_clearances] Checked-out stay ${stay.stayId} has no active clearance`);
        depositIssues++;
      } else if (activeCount > 1) {
        issues.push(`[hostel_clearances] Checked-out stay ${stay.stayId} has multiple active clearances (${activeCount})`);
        depositIssues++;
      }
    }

    checks.push({
      name: 'Security Deposits & Clearances',
      recordsChecked: accounts.length + transactions.length + clearances.length,
      status: depositIssues === 0 ? 'PASS' : 'FAIL',
      issues: depositIssues,
    });
  } catch (error) {
    checks.push({ name: 'Security Deposits & Clearances', status: 'FAIL', issues: 1, message: error.message });
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
