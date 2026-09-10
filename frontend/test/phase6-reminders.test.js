import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getActiveReminder,
  getIndiaClock,
  getNotificationSupport,
  REMINDER_WINDOW_MINUTES,
} from '../src/lib/reminders.js';

const reminders = {
  morning: { enabled: true, time: '09:00' },
  night: { enabled: true, time: '20:00' },
};

describe('client reminder timing', () => {
  test('uses Asia/Kolkata logical time and a documented 60-minute window', () => {
    assert.equal(REMINDER_WINDOW_MINUTES, 60);
    assert.deepEqual(getIndiaClock(new Date('2026-09-10T03:30:00.000Z')), {
      date: '2026-09-10',
      minutes: 9 * 60,
    });
    assert.equal(getActiveReminder(reminders, new Date('2026-09-10T03:29:00.000Z')), null);
    assert.equal(getActiveReminder(reminders, new Date('2026-09-10T04:29:00.000Z')).mealType, 'morning');
    assert.equal(getActiveReminder(reminders, new Date('2026-09-10T04:30:00.000Z')), null);
  });

  test('disabled reminders do not display and keys deduplicate by logical day and meal', () => {
    const disabled = { ...reminders, night: { enabled: false, time: '20:00' } };
    assert.equal(getActiveReminder(disabled, new Date('2026-09-10T14:30:00.000Z')), null);
    assert.equal(
      getActiveReminder(reminders, new Date('2026-09-10T14:30:00.000Z')).key,
      '2026-09-10:night',
    );
  });

  test('a reminder window can safely cross India midnight', () => {
    const late = { ...reminders, night: { enabled: true, time: '23:59' } };
    const active = getActiveReminder(late, new Date('2026-09-10T18:45:00.000Z'));
    assert.equal(active.key, '2026-09-10:night');
  });

  test('notification support exposes granted, denied, default, and unsupported states', () => {
    for (const permission of ['granted', 'denied', 'default']) {
      assert.equal(getNotificationSupport({ permission }), permission);
    }
    assert.equal(getNotificationSupport(null), 'unsupported');
  });
});
