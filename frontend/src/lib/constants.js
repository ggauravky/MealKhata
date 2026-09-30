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
  { label: 'Dashboard', path: '/' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'Reports', path: '/reports' },
  { label: 'Payments', path: '/payments' },
];

export const ROLE_LABELS = Object.freeze({
  viewer: 'Viewer',
  member: 'Member',
  admin: 'Admin',
  superadmin: 'Super Admin',
});

export function getRoleLabel(role) {
  return ROLE_LABELS[role] ?? ROLE_LABELS.viewer;
}
