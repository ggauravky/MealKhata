import { HttpError } from '../utils/HttpError.js';

export async function assertMemberNotCheckedOut(memberId, date, stays) {
  if (!stays) return;
  const activeStay = typeof stays.getActiveStayForMember === 'function'
    ? await stays.getActiveStayForMember(memberId)
    : (typeof stays.findActiveStayForMember === 'function' ? await stays.findActiveStayForMember(memberId) : null);

  if (!activeStay) {
    const memberStays = typeof stays.listStaysForMember === 'function'
      ? await stays.listStaysForMember(memberId)
      : (typeof stays.findStaysByMember === 'function' ? await stays.findStaysByMember(memberId) : []);

    const checkedOutStays = (memberStays || []).filter((stay) => stay.status === 'CHECKED_OUT' && stay.actualLeftOn);
    if (checkedOutStays.length > 0) {
      checkedOutStays.sort((a, b) => (b.actualLeftOn || '').localeCompare(a.actualLeftOn || ''));
      const lastStay = checkedOutStays[0];
      if (date > lastStay.actualLeftOn) {
        throw new HttpError(400, `Meal participation is blocked after hostel checkout on ${lastStay.actualLeftOn}.`);
      }
    }
  }
}
