export const SHARE_UNITS_PER_PLATE = 6;
export const MAX_PHYSICAL_PLATES = 3;
export const MAX_MEMBER_SHARE_UNITS = 6;

export const MORNING_PRICE_PAISE = 5000;
export const NIGHT_PRICE_PAISE = 7000;

export const MEAL_PRICES = Object.freeze({
  morning: MORNING_PRICE_PAISE,
  night: NIGHT_PRICE_PAISE,
});

export const ALLOCATION_MODES = Object.freeze({
  DEFAULT: 'default',
  CUSTOM: 'custom',
});

export const PRESET_NAMES = Object.freeze({
  INDIVIDUAL: 'individual',
  ONE_PLATE_TWO_SHARED: 'one_plate_two_shared',
  ONE_PLATE_THREE_SHARED: 'one_plate_three_shared',
  TWO_PLATES_THREE_EQUAL: 'two_plates_three_equal',
  TWO_PLATES_ONE_FULL_TWO_HALF: 'two_plates_one_full_two_half',
  THREE_PLATES_THREE_FULL: 'three_plates_three_full',
  CUSTOM: 'custom',
});
