export const APP_NAME = 'MealKhata';
export const APP_TAGLINE = 'Meals tracked. Bills sorted.';

export const ROOMMATES = Object.freeze([
  Object.freeze({ id: 'gaurav', name: 'Gaurav', initial: 'G' }),
  Object.freeze({ id: 'nikhil', name: 'Nikhil', initial: 'N' }),
  Object.freeze({ id: 'devansh', name: 'Devansh', initial: 'D' }),
]);

export const MEAL_TYPES = Object.freeze([
  Object.freeze({ id: 'morning', name: 'Morning' }),
  Object.freeze({ id: 'night', name: 'Night' }),
]);

export const NAV_ITEMS = [
  { label: 'Home', path: '/' },
  { label: 'Mess', path: '/calendar' },
  { label: 'Room Fees', path: '/room-fees' },
  { label: 'Expenses', path: '/expenses' },
  { label: 'Payments', path: '/payments' },
  { label: 'Reports', path: '/reports' },
];

export const EXPENSE_CATEGORIES = Object.freeze([
  'groceries',
  'snacks',
  'outside_food',
  'household_supplies',
  'utilities',
  'other',
]);

export const EXPENSE_CATEGORY_CONFIG = Object.freeze({
  groceries: { label: 'Groceries', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800' },
  snacks: { label: 'Snacks & Tea', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800' },
  outside_food: { label: 'Outside Food', badgeClass: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800' },
  household_supplies: { label: 'Household Supplies', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800' },
  utilities: { label: 'Utilities', badgeClass: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700' },
  other: { label: 'Other', badgeClass: 'bg-stone-50 text-stone-700 border-stone-200 dark:bg-stone-900/60 dark:text-stone-300 dark:border-stone-700' },
});

export const SPLIT_TYPES = Object.freeze({
  EQUAL: 'equal',
  PERSONAL: 'personal',
  CUSTOM: 'custom',
});

export const ROLE_LABELS = Object.freeze({
  viewer: 'Viewer',
  member: 'Member',
  admin: 'Admin',
  superadmin: 'Super Admin',
});

export function getRoleLabel(role) {
  return ROLE_LABELS[role] ?? ROLE_LABELS.viewer;
}
