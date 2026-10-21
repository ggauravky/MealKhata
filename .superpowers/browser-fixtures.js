async page => {
  const rooms = {
    gaurav: { roomId: 'room-lower', roomNumber: 'lower', roomLabel: 'Room lower', capacity: 1 },
    nikhil: { roomId: 'room-first', roomNumber: '1st Floor Room', roomLabel: 'Room 1st Floor Room', capacity: 2 },
    devansh: { roomId: 'room-first', roomNumber: '1st Floor Room', roomLabel: 'Room 1st Floor Room', capacity: 2 },
  };
  const assignments = Object.fromEntries(Object.entries(rooms).map(([memberId, room]) => [memberId, {
    assignmentId: `assignment-${memberId}`,
    memberId,
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    effectiveFromMonth: '2026-10',
    effectiveFromDate: '2026-10-20',
    effectiveUntilMonth: null,
    effectiveUntilDate: null,
  }]));
  let expense = {
    expenseId: 'expense-browser-1',
    date: '2026-10-20',
    month: '2026-10',
    title: 'Browser fixture groceries',
    category: 'groceries',
    categoryLabel: 'Groceries',
    description: 'Isolated browser verification',
    amountPaise: 14950,
    paidByMemberId: 'gaurav',
    splitType: 'equal',
    allocations: [
      { memberId: 'gaurav', amountPaise: 4984 },
      { memberId: 'nikhil', amountPaise: 4983 },
      { memberId: 'devansh', amountPaise: 4983 },
    ],
    memberShares: [],
    reimbursements: [],
    status: 'recorded',
    derivedStatus: 'unsettled',
    corrections: [],
    revision: 'browser-revision-1',
  };

  const json = (route, body, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const memberId = url.searchParams.get('memberId') || 'gaurav';

    if (path === '/api/auth/session') {
      return json(route, {
        success: true,
        session: { authenticated: true, role: 'superadmin', memberId: null, displayName: 'Super Admin' },
      });
    }
    if (path === '/api/meals/today') return json(route, { success: true, data: { date: '2026-10-21' } });
    if (path === '/api/admin/members') {
      return json(route, { success: true, data: ['gaurav', 'nikhil', 'devansh'].map((id) => ({
        memberId: id,
        name: id[0].toUpperCase() + id.slice(1),
        account: { exists: true, active: true, role: 'member', displayName: id },
        stay: null,
        room: rooms[id],
        assignment: assignments[id],
        feePlan: { feePlanId: `plan-${id}`, amountPaise: 280000, effectiveFromMonth: '2026-10' },
      })) });
    }
    if (path === '/api/rooms') {
      return json(route, { success: true, data: [
        { ...rooms.gaurav, active: true, currentOccupants: ['gaurav'] },
        { ...rooms.nikhil, active: true, currentOccupants: ['nikhil', 'devansh'] },
      ] });
    }
    if (path === '/api/stays' && method === 'GET') return json(route, { success: true, data: [] });
    if (path === '/api/stays/me') {
      return json(route, {
        success: true,
        memberId,
        configured: false,
        isActive: false,
        data: null,
        currentAssignment: assignments[memberId],
        currentRoom: rooms[memberId],
        currentFeePlan: { feePlanId: `plan-${memberId}`, amountPaise: 280000, effectiveFromMonth: '2026-10' },
      });
    }
    if (path === '/api/stays/me/history') return json(route, { success: true, data: [] });
    if (path.startsWith('/api/room-fees/assignments/')) {
      const id = decodeURIComponent(path.split('/').at(-1));
      return json(route, { success: true, data: [assignments[id]] });
    }
    if (path.startsWith('/api/room-fees/plans/')) {
      const id = decodeURIComponent(path.split('/').at(-1));
      return json(route, { success: true, data: [{ feePlanId: `plan-${id}`, memberId: id, amountPaise: 280000, effectiveFromMonth: '2026-10' }] });
    }
    if (path === '/api/room-fees/me/history') {
      return json(route, { success: true, data: { charges: [], summary: { totalBilledPaise: 0, totalPaidPaise: 0, totalOutstandingPaise: 0 } } });
    }
    if (path === '/api/room-fees/me') {
      return json(route, {
        success: true,
        data: {
          memberId,
          month: url.searchParams.get('month') || '2026-10',
          currentRoom: rooms[memberId],
          currentAssignment: assignments[memberId],
          currentFeePlan: { feePlanId: `plan-${memberId}`, memberId, amountPaise: 280000, effectiveFromMonth: '2026-10' },
          scheduledFeePaise: 280000,
          currentMonthCharge: null,
          summaryMetrics: { totalBilledPaise: 0, totalPaidPaise: 0, totalOutstandingPaise: 0 },
          recipientSettings: null,
        },
      });
    }
    if (path === '/api/expenses' && method === 'GET') {
      return json(route, { success: true, data: expense.status === 'voided' ? [] : [expense] });
    }
    if (path === '/api/expenses/preview' && method === 'POST') {
      const body = request.postDataJSON();
      return json(route, { success: true, data: {
        amountPaise: body.amountPaise,
        allocations: expense.allocations,
        reimbursementObligations: [
          { fromMemberId: 'nikhil', toMemberId: 'gaurav', amountPaise: 4983 },
          { fromMemberId: 'devansh', toMemberId: 'gaurav', amountPaise: 4983 },
        ],
      } });
    }
    if (path === '/api/expenses/summary/2026-10') {
      return json(route, { success: true, data: { totalExpensesPaise: expense.status === 'voided' ? 0 : expense.amountPaise, expenseCount: expense.status === 'voided' ? 0 : 1 } });
    }
    if (path === `/api/expenses/${expense.expenseId}` && method === 'GET') {
      return json(route, { success: true, data: expense });
    }
    if (path === `/api/expenses/${expense.expenseId}/corrections` && method === 'POST') {
      const body = request.postDataJSON();
      expense = {
        ...expense,
        ...(body.changes?.title ? { title: body.changes.title } : {}),
        ...(Number.isSafeInteger(body.changes?.amountPaise) ? { amountPaise: body.changes.amountPaise } : {}),
        revision: 'browser-revision-2',
      };
      return json(route, { success: true, data: expense });
    }
    if (path === `/api/expenses/${expense.expenseId}/void` && method === 'POST') {
      expense = { ...expense, status: 'voided' };
      return json(route, { success: true, data: expense });
    }
    if (path === '/api/expenses/reimbursements' || path === '/api/expenses/reimbursements/summary') {
      return json(route, { success: true, data: [] });
    }
    return json(route, { success: true, data: [] });
  });
}
