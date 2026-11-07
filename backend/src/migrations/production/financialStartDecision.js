import { isValidLogicalDate } from '../../utils/date.js';

const FIELDS = ['approvedDate', 'timezone', 'importedMealOnBoundary',
  'boundaryDayClassification', 'partialMonthBillingPolicy',
  'firstMessBillingPeriod', 'firstRoomFeePeriod', 'initialActiveStudentIds',
  'mealEligibility', 'roomAssignments', 'roomFeePlans', 'deposits', 'accountProvisioning'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

/** A review gate only. This never sets a database boundary or chooses a date. */
export function validateFinancialStartDecision(decision) {
  if (!exact(decision, FIELDS) || !isValidLogicalDate(decision.approvedDate)
    || decision.timezone !== 'Asia/Kolkata'
    || typeof decision.importedMealOnBoundary !== 'boolean'
    || !['historical', 'operational'].includes(decision.boundaryDayClassification)
    || !['daily-operational-only', 'defer-monthly-charges']
      .includes(decision.partialMonthBillingPolicy)
    || !PERIOD.test(decision.firstMessBillingPeriod ?? '')
    || !PERIOD.test(decision.firstRoomFeePeriod ?? '')
    || decision.firstMessBillingPeriod < decision.approvedDate.slice(0, 7)
    || decision.firstRoomFeePeriod < decision.approvedDate.slice(0, 7)
    || !['initialActiveStudentIds', 'mealEligibility', 'roomAssignments',
      'roomFeePlans', 'deposits', 'accountProvisioning']
      .every(field => Array.isArray(decision[field]))) {
    throw new Error('Owner financial start decision is missing or invalid');
  }
  if (decision.importedMealOnBoundary && decision.boundaryDayClassification !== 'historical') {
    throw new Error('An imported boundary-day meal must retain historical classification');
  }
  const students = decision.initialActiveStudentIds;
  if (students.some(id => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(students).size !== students.length
    || decision.mealEligibility.length !== students.length
    || new Set(decision.mealEligibility.map(item => item?.studentId)).size !== students.length
    || decision.mealEligibility.some(item => !exact(item, ['studentId', 'startDate'])
      || !students.includes(item.studentId)
      || !isValidLogicalDate(item.startDate)
      || item.startDate < decision.approvedDate)) {
    throw new Error('Every initially active student requires an explicit meal eligibility decision');
  }
  return Object.freeze(structuredClone(decision));
}
