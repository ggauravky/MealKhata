export const MEMBERS = Object.freeze([
  Object.freeze({ id: 'gaurav', name: 'Gaurav' }),
  Object.freeze({ id: 'nikhil', name: 'Nikhil' }),
  Object.freeze({ id: 'devansh', name: 'Devansh' }),
]);

export const MEMBER_IDS = Object.freeze(MEMBERS.map(({ id }) => id));

export const MEMBER_NAMES = Object.freeze(
  MEMBERS.reduce((acc, member) => {
    acc[member.id] = member.name;
    return acc;
  }, {})
);

