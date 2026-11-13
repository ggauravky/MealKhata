import { useEffect, useState } from 'react';
import { getIndiaTodayLogicalDate } from '../../lib/logicalDate.js';
import { buildStudentProfilePayload, getStudentErrorMessage } from '../../lib/studentContracts.js';
import { Button } from '../ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.jsx';
import { Input } from '../ui/input.jsx';
import { Label } from '../ui/label.jsx';

function initialValues(student, nextRosterOrder) {
  return {
    displayName: student?.displayName ?? '',
    email: student?.email ?? '',
    phone: student?.phone ?? '',
    // A student is only included in meals from an explicit start date; new students default to today.
    mealEligibilityFrom: student ? (student.mealEligibilityFrom ?? '') : getIndiaTodayLogicalDate(),
    mealEligibilityUntil: student?.mealEligibilityUntil ?? '',
    rosterOrder: student?.rosterOrder ?? nextRosterOrder,
    reason: '',
    expectedUpdatedAt: student?.updatedAt ?? null,
  };
}

export function StudentDialog({ open, onOpenChange, student, nextRosterOrder, onSubmit }) {
  const editing = Boolean(student);
  const [values, setValues] = useState(() => initialValues(student, nextRosterOrder));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValues(initialValues(student, nextRosterOrder));
      setError('');
    }
  }, [nextRosterOrder, open, student]);

  const setField = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onSubmit(buildStudentProfilePayload(values, { editing }));
      onOpenChange(false);
    } catch (requestError) {
      setError(getStudentErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };
  const title = editing ? 'Edit student' : 'Add student';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Identity, meal eligibility, login access, Hostel Stay, room, rent, and deposit remain independent.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="studentDisplayName">Display name</Label>
              <Input id="studentDisplayName" value={values.displayName} onChange={setField('displayName')} maxLength={100} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="studentEmail">Profile email (optional)</Label>
              <Input id="studentEmail" type="email" value={values.email} onChange={setField('email')} maxLength={254} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="studentPhone">Phone (optional)</Label>
              <Input id="studentPhone" type="tel" value={values.phone} onChange={setField('phone')} maxLength={32} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="studentEligibilityFrom">Meals start on</Label>
              <Input id="studentEligibilityFrom" type="date" value={values.mealEligibilityFrom} onChange={setField('mealEligibilityFrom')} required={!editing} />
              <p className="text-[11px] text-slate-500">The student appears in daily meal attendance from this date. Without a date they are not included in meals.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="studentEligibilityUntil">Meal eligible until (optional)</Label>
              <Input id="studentEligibilityUntil" type="date" value={values.mealEligibilityUntil} onChange={setField('mealEligibilityUntil')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="studentRosterOrder">Roster order</Label>
              <Input id="studentRosterOrder" type="number" min="0" step="1" value={values.rosterOrder} onChange={setField('rosterOrder')} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="studentChangeReason">Reason</Label>
              <Input id="studentChangeReason" value={values.reason} onChange={setField('reason')} maxLength={300} required placeholder={editing ? 'Why is this profile changing?' : 'Verified enrollment source'} />
            </div>
          </div>
          {!editing && <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">This creates only the student identity. Login, Hostel Stay, room assignment, rent, and deposit can be configured later when needed.</p>}
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : title}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
