import { assertSafeStudentId } from '../students/studentId.js';
import {
  MAX_MEMBER_SHARE_UNITS,
  MAX_PHYSICAL_PLATES,
  SHARE_UNITS_PER_PLATE,
} from './plateAllocation.constants.js';

function ownEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value);
}

export function toPlainMealValue(value) {
  if (value === null || value === undefined || value instanceof Date) return value;
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [key, toPlainMealValue(entry)]),
    );
  }
  if (Array.isArray(value)) return value.map(toPlainMealValue);
  if (typeof value.toObject === 'function') {
    return toPlainMealValue(value.toObject({ depopulate: true, flattenMaps: true }));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toPlainMealValue(entry)]),
    );
  }
  return value;
}

export function normalizeParticipantIds(participants = []) {
  if (!Array.isArray(participants)) throw new TypeError('participants must be an array');
  const seen = new Set();
  const result = [];
  for (const participant of participants) {
    const studentId = typeof participant === 'string' ? participant : participant?.studentId;
    assertSafeStudentId(studentId);
    if (!seen.has(studentId)) {
      seen.add(studentId);
      result.push(studentId);
    }
  }
  return result;
}

export function validateStudentKeyedRecord(value, fieldName = 'student-keyed record') {
  if (value === null || value === undefined) return true;
  if (!(value instanceof Map) && (typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError(`${fieldName} must be a student-keyed object or Map`);
  }
  for (const [studentId] of ownEntries(value)) assertSafeStudentId(studentId);
  return true;
}

export function extractMealParticipantIds(document) {
  const source = toPlainMealValue(document) ?? {};
  const ordered = [];
  const seen = new Set();
  const addRecordKeys = (record) => {
    for (const [studentId] of ownEntries(record)) {
      if (!seen.has(studentId)) {
        seen.add(studentId);
        ordered.push(studentId);
      }
    }
  };

  for (const mealType of ['morning', 'night']) addRecordKeys(source.meals?.[mealType]);
  for (const mealType of ['morning', 'night']) {
    for (const plate of source.allocations?.[mealType]?.plates ?? []) addRecordKeys(plate?.shares);
  }
  return ordered;
}

export function calculateStoredShareUnits(allocation) {
  const plates = allocation?.plates ?? [];
  const participantIds = [];
  const seen = new Set();
  for (const plate of plates) {
    for (const [studentId] of ownEntries(plate?.shares)) {
      if (!seen.has(studentId)) {
        seen.add(studentId);
        participantIds.push(studentId);
      }
    }
  }

  const units = Object.fromEntries(participantIds.map((studentId) => [studentId, 0]));
  for (const plate of plates) {
    for (const [studentId, value] of ownEntries(plate?.shares)) units[studentId] += value ?? 0;
  }
  return { ...units, totalUnits: Object.values(units).reduce((sum, value) => sum + value, 0) };
}

export function validateAllocationPlates(plates) {
  if (!Array.isArray(plates)) throw new TypeError('allocation plates must be an array');
  if (plates.length > MAX_PHYSICAL_PLATES) {
    throw new TypeError(`allocation cannot exceed ${MAX_PHYSICAL_PLATES} physical plates`);
  }

  const participantUnits = new Map();
  for (const [index, plate] of plates.entries()) {
    validateStudentKeyedRecord(plate?.shares, `plate #${index + 1} shares`);
    let plateUnits = 0;
    for (const [studentId, units] of ownEntries(plate?.shares)) {
      plateUnits += units;
      const total = (participantUnits.get(studentId) ?? 0) + units;
      if (total > MAX_MEMBER_SHARE_UNITS) {
        throw new TypeError(
          `student '${studentId}' cannot exceed ${MAX_MEMBER_SHARE_UNITS} share units per meal`,
        );
      }
      participantUnits.set(studentId, total);
    }
    if (plateUnits !== SHARE_UNITS_PER_PLATE) {
      throw new TypeError(
        `plate #${index + 1} must total exactly ${SHARE_UNITS_PER_PLATE} share units`,
      );
    }
  }
  return true;
}
