import { useContext } from 'react';
import { ReminderContext } from '../context/reminderContext.js';

export function useReminders() {
  const context = useContext(ReminderContext);
  if (!context) throw new Error('useReminders must be used within ReminderProvider');
  return context;
}
