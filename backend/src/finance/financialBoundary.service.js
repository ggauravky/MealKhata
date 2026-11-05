import { isValidLogicalDate } from '../utils/date.js';
import { firstDateOfMonth, isValidLogicalMonth, lastDateOfMonth } from '../utils/month.js';
import { systemSettingsRepository } from '../settings/systemSettings.repository.js';

function conflict(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.details = { code };
  return error;
}

function previousDate(value) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function isOperationalMealDayForBoundary(day, financialStartDate) {
  if (!day || !isValidLogicalDate(day.date)) throw new TypeError('meal day must have a YYYY-MM-DD date');
  if (!financialStartDate || day.date < financialStartDate) return false;
  if (day.financialClassification === 'historical') return false;
  if (day.importedFromLegacy || day.calculationVersion?.startsWith('legacy-')) {
    return day.financialClassification === 'operational'
      && day.cutoverClassificationSource === 'migration-manifest';
  }
  if (day.date !== financialStartDate) return true;
  return day.schemaVersion === 3 || day.calculationVersion === 'v3';
}

export function createFinancialBoundaryService({ repository = systemSettingsRepository } = {}) {
  async function getFinancialBoundary(options) {
    const settings = await repository.get(options);
    return {
      financialStartDate: settings?.financialStartDate ?? null,
      timezone: settings?.timezone ?? 'Asia/Kolkata',
      revision: settings?.revision ?? 0,
      configuredAt: settings?.configuredAt ?? null,
      configuredBy: settings?.configuredBy ?? null,
    };
  }

  async function isHistoricalViewOnly(date, options) {
    if (!isValidLogicalDate(date)) throw new TypeError('date must use YYYY-MM-DD');
    const { financialStartDate } = await getFinancialBoundary(options);
    return !financialStartDate || date < financialStartDate;
  }

  async function assertOperationalFinancialDate(date, options) {
    if (!isValidLogicalDate(date)) throw new TypeError('date must use YYYY-MM-DD');
    const { financialStartDate } = await getFinancialBoundary(options);
    if (!financialStartDate) throw conflict('FINANCIAL_BOUNDARY_UNSET', 'Financial start date must be configured before issuing operational financial records.');
    if (date < financialStartDate) throw conflict('HISTORICAL_FINANCIAL_DATE', 'This date is historical and cannot receive new operational financial records.');
  }

  async function getMonthScope(month, options) {
    if (!isValidLogicalMonth(month)) throw new TypeError('month must use YYYY-MM');
    const { financialStartDate } = await getFinancialBoundary(options);
    const first = firstDateOfMonth(month);
    const last = lastDateOfMonth(month);
    if (!financialStartDate || last < financialStartDate) {
      return { month, kind: 'historical', historicalEndDate: last, operationalStartDate: null, operationalEndDate: null };
    }
    if (first >= financialStartDate) {
      return { month, kind: 'operational', historicalEndDate: null, operationalStartDate: first, operationalEndDate: last };
    }
    return { month, kind: 'partial', historicalEndDate: previousDate(financialStartDate), operationalStartDate: financialStartDate, operationalEndDate: last };
  }

  async function assertFullOperationalMonth(month, options) {
    if (!(await getFinancialBoundary(options)).financialStartDate) {
      throw conflict('FINANCIAL_BOUNDARY_UNSET', 'Financial start date must be configured before issuing operational financial records.');
    }
    const scope = await getMonthScope(month, options);
    if (scope.kind !== 'operational') throw conflict('NON_OPERATIONAL_MONTH', `This month is ${scope.kind}; a full operational month is required.`);
    return scope;
  }

  async function assertOperationalMonth(month, options) {
    const settings = await getFinancialBoundary(options);
    if (!settings.financialStartDate) throw conflict('FINANCIAL_BOUNDARY_UNSET', 'Financial start date must be configured before issuing operational financial records.');
    const scope = await getMonthScope(month, options);
    if (scope.kind === 'historical') throw conflict('HISTORICAL_FINANCIAL_MONTH', 'This month is historical and cannot receive new operational financial records.');
    return scope;
  }

  async function isOperationalMealDay(day, options) {
    const { financialStartDate } = await getFinancialBoundary(options);
    return isOperationalMealDayForBoundary(day, financialStartDate);
  }

  return Object.freeze({ getFinancialBoundary, isHistoricalViewOnly, assertOperationalFinancialDate, getMonthScope, assertOperationalMonth, assertFullOperationalMonth, isOperationalMealDay });
}

export const financialBoundaryService = createFinancialBoundaryService();
