import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  calculateMemberShareUnits,
  createPresetAllocation,
  formatPlateFraction,
  formatPlateFractionAccessible,
  PRESET_NAMES,
  splitMealCost,
  validatePlateAllocation,
} from '../src/lib/plates.js';

describe('Shared Plate Frontend Architecture', () => {
  describe('Fraction Formatter', () => {
    test('formats base sixth fractions cleanly', () => {
      assert.equal(formatPlateFraction(0), '0');
      assert.equal(formatPlateFraction(1), '⅙');
      assert.equal(formatPlateFraction(2), '⅓');
      assert.equal(formatPlateFraction(3), '½');
      assert.equal(formatPlateFraction(4), '⅔');
      assert.equal(formatPlateFraction(5), '⅚');
      assert.equal(formatPlateFraction(6), '1');
    });

    test('formats multi-plate totals with whole numbers and clean fractions', () => {
      assert.equal(formatPlateFraction(8), '1⅓');
      assert.equal(formatPlateFraction(9), '1½');
      assert.equal(formatPlateFraction(10), '1⅔');
      assert.equal(formatPlateFraction(12), '2');
      assert.equal(formatPlateFraction(14), '2⅓');
      assert.equal(formatPlateFraction(18), '3');
    });

    test('accessible fraction labels speak clearly for screen readers', () => {
      assert.equal(formatPlateFractionAccessible(0), '0 plates');
      assert.equal(formatPlateFractionAccessible(2), 'one-third plate');
      assert.equal(formatPlateFractionAccessible(3), 'half plate');
      assert.equal(formatPlateFractionAccessible(4), 'two-thirds plate');
      assert.equal(formatPlateFractionAccessible(6), 'one plate');
      assert.equal(formatPlateFractionAccessible(9), '1 and half plate');
    });
  });

  describe('Plate Allocation Validation', () => {
    test('validates valid single plate shared by 2 (3 + 3 = 6)', () => {
      const valid = {
        mode: 'custom',
        plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }],
      };
      assert.doesNotThrow(() => validatePlateAllocation(valid));
    });

    test('validates valid single plate shared by 3 (2 + 2 + 2 = 6)', () => {
      const valid = {
        mode: 'custom',
        plates: [{ shares: { gaurav: 2, nikhil: 2, devansh: 2 } }],
      };
      assert.doesNotThrow(() => validatePlateAllocation(valid));
    });

    test('rejects plate with sum less than 6 units', () => {
      const invalid = {
        mode: 'custom',
        plates: [{ shares: { gaurav: 2, nikhil: 2, devansh: 1 } }],
      };
      assert.throws(() => validatePlateAllocation(invalid), /must total exactly 6 share units/);
    });

    test('rejects plate with sum greater than 6 units', () => {
      const invalid = {
        mode: 'custom',
        plates: [{ shares: { gaurav: 4, nikhil: 3, devansh: 0 } }],
      };
      assert.throws(() => validatePlateAllocation(invalid), /must total exactly 6 share units/);
    });

    test('rejects member exceeding max 6 units across plates', () => {
      const invalid = {
        mode: 'custom',
        plates: [
          { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
          { shares: { gaurav: 3, nikhil: 3, devansh: 0 } },
        ],
      };
      assert.throws(() => validatePlateAllocation(invalid), /cannot exceed 1 full plate equivalent/);
    });

    test('rejects more than 3 physical plates', () => {
      const invalid = {
        mode: 'custom',
        plates: [
          { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
          { shares: { gaurav: 0, nikhil: 6, devansh: 0 } },
          { shares: { gaurav: 0, nikhil: 0, devansh: 6 } },
          { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
        ],
      };
      assert.throws(() => validatePlateAllocation(invalid), /more than 3 physical plates/);
    });
  });

  describe('Preset Allocations', () => {
    test('creates 1 Plate / 2 People preset', () => {
      const preset = createPresetAllocation(PRESET_NAMES.ONE_PLATE_TWO_SHARED, {
        members: ['gaurav', 'nikhil'],
      });
      assert.equal(preset.plates.length, 1);
      assert.equal(preset.plates[0].shares.gaurav, 3);
      assert.equal(preset.plates[0].shares.nikhil, 3);
      assert.equal(preset.plates[0].shares.devansh, 0);
    });

    test('creates 2 Plates / 3 Equal preset', () => {
      const preset = createPresetAllocation(PRESET_NAMES.TWO_PLATES_THREE_EQUAL);
      assert.equal(preset.plates.length, 2);
      const units = calculateMemberShareUnits(preset);
      assert.equal(units.gaurav, 4);
      assert.equal(units.nikhil, 4);
      assert.equal(units.devansh, 4);
    });

    test('creates 2 Plates / 1 Full + 2 Half preset', () => {
      const preset = createPresetAllocation(PRESET_NAMES.TWO_PLATES_ONE_FULL_TWO_HALF, {
        fullMemberId: 'gaurav',
      });
      assert.equal(preset.plates.length, 2);
      const units = calculateMemberShareUnits(preset);
      assert.equal(units.gaurav, 6);
      assert.equal(units.nikhil, 3);
      assert.equal(units.devansh, 3);
    });
  });

  describe('Exact Cost Splitting Algorithm - 8 Canonical Cases', () => {
    test('Case 1: 1 person, 1 full plate', () => {
      const allocation = {
        mode: 'custom',
        plates: [{ shares: { gaurav: 6, nikhil: 0, devansh: 0 } }],
      };
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      assert.equal(morning.physicalPlates, 1);
      assert.equal(morning.members.gaurav.amountPaise, 5000);
      assert.equal(morning.members.nikhil.amountPaise, 0);
      assert.equal(morning.roomAmountPaise, 5000);

      const night = splitMealCost({ date: '2026-10-01', mealType: 'night', effectiveAllocation: allocation });
      assert.equal(night.members.gaurav.amountPaise, 7000);
      assert.equal(night.roomAmountPaise, 7000);
    });

    test('Case 2: 1 plate shared by 2 people', () => {
      const allocation = {
        mode: 'custom',
        plates: [{ shares: { gaurav: 3, nikhil: 3, devansh: 0 } }],
      };
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      assert.equal(morning.members.gaurav.amountPaise, 2500);
      assert.equal(morning.members.nikhil.amountPaise, 2500);
      assert.equal(morning.members.devansh.amountPaise, 0);
      assert.equal(morning.roomAmountPaise, 5000);

      const night = splitMealCost({ date: '2026-10-01', mealType: 'night', effectiveAllocation: allocation });
      assert.equal(night.members.gaurav.amountPaise, 3500);
      assert.equal(night.members.nikhil.amountPaise, 3500);
      assert.equal(night.roomAmountPaise, 7000);
    });

    test('Case 3: 1 plate shared by 3 people (Largest Remainder integer paise)', () => {
      const allocation = {
        mode: 'custom',
        plates: [{ shares: { gaurav: 2, nikhil: 2, devansh: 2 } }],
      };
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      const mSum = morning.members.gaurav.amountPaise + morning.members.nikhil.amountPaise + morning.members.devansh.amountPaise;
      assert.equal(mSum, 5000);
      assert.equal(morning.roomAmountPaise, 5000);

      const night = splitMealCost({ date: '2026-10-01', mealType: 'night', effectiveAllocation: allocation });
      const nSum = night.members.gaurav.amountPaise + night.members.nikhil.amountPaise + night.members.devansh.amountPaise;
      assert.equal(nSum, 7000);
      assert.equal(night.roomAmountPaise, 7000);
    });

    test('Case 4: 2 plates, 2 people full', () => {
      const allocation = {
        mode: 'custom',
        plates: [
          { shares: { gaurav: 6, nikhil: 0, devansh: 0 } },
          { shares: { gaurav: 0, nikhil: 6, devansh: 0 } },
        ],
      };
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      assert.equal(morning.members.gaurav.amountPaise, 5000);
      assert.equal(morning.members.nikhil.amountPaise, 5000);
      assert.equal(morning.members.devansh.amountPaise, 0);
      assert.equal(morning.roomAmountPaise, 10000);
    });

    test('Case 5: 2 plates shared equally by 3 people', () => {
      const allocation = createPresetAllocation(PRESET_NAMES.TWO_PLATES_THREE_EQUAL);
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      const mSum = morning.members.gaurav.amountPaise + morning.members.nikhil.amountPaise + morning.members.devansh.amountPaise;
      assert.equal(mSum, 10000);
      assert.equal(morning.roomAmountPaise, 10000);

      const night = splitMealCost({ date: '2026-10-01', mealType: 'night', effectiveAllocation: allocation });
      const nSum = night.members.gaurav.amountPaise + night.members.nikhil.amountPaise + night.members.devansh.amountPaise;
      assert.equal(nSum, 14000);
      assert.equal(night.roomAmountPaise, 14000);
    });

    test('Case 6: 2 plates: 1 full + 2 half', () => {
      const allocation = createPresetAllocation(PRESET_NAMES.TWO_PLATES_ONE_FULL_TWO_HALF, {
        fullMemberId: 'gaurav',
      });
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      assert.equal(morning.members.gaurav.amountPaise, 5000);
      assert.equal(morning.members.nikhil.amountPaise, 2500);
      assert.equal(morning.members.devansh.amountPaise, 2500);
      assert.equal(morning.roomAmountPaise, 10000);

      const night = splitMealCost({ date: '2026-10-01', mealType: 'night', effectiveAllocation: allocation });
      assert.equal(night.members.gaurav.amountPaise, 7000);
      assert.equal(night.members.nikhil.amountPaise, 3500);
      assert.equal(night.members.devansh.amountPaise, 3500);
      assert.equal(night.roomAmountPaise, 14000);
    });

    test('Case 7: 3 plates, 3 full', () => {
      const allocation = createPresetAllocation(PRESET_NAMES.THREE_PLATES_THREE_FULL);
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      assert.equal(morning.members.gaurav.amountPaise, 5000);
      assert.equal(morning.members.nikhil.amountPaise, 5000);
      assert.equal(morning.members.devansh.amountPaise, 5000);
      assert.equal(morning.roomAmountPaise, 15000);
    });

    test('Case 8: 0 plates, everyone skips', () => {
      const allocation = { mode: 'default', plates: [] };
      const morning = splitMealCost({ date: '2026-10-01', mealType: 'morning', effectiveAllocation: allocation });
      assert.equal(morning.physicalPlates, 0);
      assert.equal(morning.roomAmountPaise, 0);
      assert.equal(morning.members.gaurav.amountPaise, 0);
    });
  });
});
