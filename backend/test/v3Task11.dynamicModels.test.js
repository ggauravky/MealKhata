import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Payment } from '../src/payments/payment.model.js';
import { RoomAssignment } from '../src/roomFees/roomAssignment.model.js';
import { RoomFeePlan } from '../src/roomFees/roomFeePlan.model.js';
import { RoomCharge } from '../src/roomFees/roomCharge.model.js';
import { RoomPayment } from '../src/roomFees/roomPayment.model.js';
import { RoomFeeScheduleState } from '../src/roomFees/roomFeeScheduleState.model.js';
import { HostelStay, HostelDepositAccount, HostelDepositTransaction, HostelClearance } from '../src/stays/stay.model.js';
import { PaymentReclassification, UnallocatedCredit, CreditAllocation } from '../src/stays/paymentReclassification.model.js';
import { calculateExpenseSplit } from '../src/expenses/expenseSplit.service.js';
import { ExpenseService } from '../src/expenses/expense.service.js';
import { Expense } from '../src/expenses/expense.model.js';
import { ExpenseReimbursement } from '../src/expenses/expenseReimbursement.model.js';

test('operational finance and Stay schemas accept safe fourth student references', async () => {
  for (const Model of [Payment, RoomAssignment, RoomFeePlan, RoomCharge, RoomPayment,
    RoomFeeScheduleState, HostelStay, HostelDepositAccount, HostelDepositTransaction,
    HostelClearance, PaymentReclassification, UnallocatedCredit, CreditAllocation]) {
    await new Model({ memberId: 'student_fourth' }).validate(['memberId']);
    await assert.rejects(new Model({ memberId: '$where' }).validate(['memberId']),
      `${Model.modelName} accepted a Mongo path injection ID`);
  }
});

test('four dynamic expense participants split and conserve every paise', () => {
  const ids = ['student_z', 'gaurav', 'student_a', 'nikhil'];
  const equal = calculateExpenseSplit({ amountPaise: 101, paidByMemberId: 'student_z',
    splitType: 'equal', participants: ids });
  assert.deepEqual(equal.allocations.map(({ memberId }) => memberId), ['gaurav', 'nikhil', 'student_a', 'student_z']);
  assert.equal(equal.allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0), 101);
  const custom = calculateExpenseSplit({ amountPaise: 101, paidByMemberId: 'student_z',
    splitType: 'custom', customAllocations: [
      { memberId: 'student_z', amountPaise: 50 }, { memberId: 'student_a', amountPaise: 51 },
    ] });
  assert.equal(custom.allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0), 101);
  assert.deepEqual(custom.allocations.map(({ memberId }) => memberId), ['student_a', 'student_z']);
});

test('expense preview verifies every dynamic student against the registry', async () => {
  const students = { assertKnown: async (id) => {
    if (id === 'ghost') throw Object.assign(new Error('Student was not found.'), { statusCode: 404 });
    return { studentId: id };
  } };
  const service = new ExpenseService({}, { students });
  await service.previewExpense({ amountPaise: 101, paidByMemberId: 'student_z', splitType: 'equal',
    participants: ['student_z', 'student_a', 'gaurav', 'nikhil'] });
  await assert.rejects(service.previewExpense({ amountPaise: 101, paidByMemberId: 'student_z',
    splitType: 'personal', participants: ['ghost'] }), (error) => error.statusCode === 404);
});

test('expense and reimbursement schemas reject unsafe dynamic references', async () => {
  await new Expense({ paidByMemberId: 'student_fourth' }).validate(['paidByMemberId']);
  await assert.rejects(new Expense({ paidByMemberId: '$where' }).validate(['paidByMemberId']));
  await new ExpenseReimbursement({ fromMemberId: 'student_fourth', toMemberId: 'gaurav' })
    .validate(['fromMemberId', 'toMemberId']);
  await assert.rejects(new ExpenseReimbursement({ fromMemberId: '$where', toMemberId: 'gaurav' })
    .validate(['fromMemberId', 'toMemberId']));
});
