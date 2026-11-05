import {
  Archive,
  BedDouble,
  CalendarDays,
  House,
  KeyRound,
  Mail,
  Pencil,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { MemberAccountDialog } from '../components/members/MemberAccountDialog.jsx';
import { StudentDialog } from '../components/students/StudentDialog.jsx';
import { StudentLifecycleDialog } from '../components/students/StudentLifecycleDialog.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useStudents } from '../hooks/useStudents.js';

function displayDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString('en-IN');
}

function eligibilitySummary(student) {
  if (!student.mealEligibilityFrom && !student.mealEligibilityUntil) return 'No date restriction';
  if (student.mealEligibilityFrom && student.mealEligibilityUntil) {
    return `${student.mealEligibilityFrom} to ${student.mealEligibilityUntil}`;
  }
  if (student.mealEligibilityFrom) return `From ${student.mealEligibilityFrom}`;
  return `Until ${student.mealEligibilityUntil}`;
}

function StudentCard({ student, isSuperAdmin, onEdit, onAccountAction, onLifecycleAction }) {
  const archived = student.status === 'ARCHIVED';

  return (
    <Card data-testid={`student-card-${student.studentId}`} className={archived ? 'border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{student.displayName}</CardTitle>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{student.studentId}</p>
          </div>
          <Badge variant={archived ? 'secondary' : 'taking'}>{archived ? 'Archived' : 'Active'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <CalendarDays className="h-4 w-4 text-teal-600" /> Student profile
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-500">
            <dt>Profile email</dt><dd className="truncate text-right text-slate-800 dark:text-slate-200">{student.email || 'Not set'}</dd>
            <dt>Phone</dt><dd className="text-right text-slate-800 dark:text-slate-200">{student.phone || 'Not set'}</dd>
            <dt>Meal eligibility</dt><dd className="text-right text-slate-800 dark:text-slate-200">{eligibilitySummary(student)}</dd>
            <dt>Roster order</dt><dd className="text-right text-slate-800 dark:text-slate-200">{student.rosterOrder}</dd>
          </dl>
          {archived && (
            <div className="rounded-md bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <p><span className="font-semibold">Archived:</span> {displayDateTime(student.archivedAt)}</p>
              <p className="mt-1"><span className="font-semibold">Reason:</span> {student.archivedReason || 'Not recorded'}</p>
            </div>
          )}
        </section>

        <section className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <h3 className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="h-4 w-4 text-teal-600" /> Login account
          </h3>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Status</span>
            <Badge variant={!student.account.exists ? 'secondary' : student.account.active ? 'taking' : 'destructive'}>
              {!student.account.exists ? 'Not configured' : student.account.active ? 'Login active' : 'Login disabled'}
            </Badge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-500">
            <dt>Email</dt><dd className="truncate text-right text-slate-800 dark:text-slate-200">{student.account.email || 'Not set'}</dd>
            <dt>Last login</dt><dd className="text-right text-slate-800 dark:text-slate-200">{displayDateTime(student.account.lastLoginAt)}</dd>
          </dl>
        </section>

        <section className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <h3 className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <House className="h-4 w-4 text-teal-600" /> Hostel
          </h3>
          <div className="flex items-center justify-between text-slate-500"><span>Stay</span><span className="text-slate-800 dark:text-slate-200">{student.stay?.status || 'Not registered'}</span></div>
          <div className="flex items-center justify-between text-slate-500"><span>Room</span><span className="text-slate-800 dark:text-slate-200">{student.room ? `Room ${student.room.roomNumber}` : 'Not assigned'}</span></div>
        </section>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {isSuperAdmin && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onEdit(student)}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
          )}
          {isSuperAdmin && !student.account.exists && (
            <Button size="sm" className="h-7 text-xs" onClick={() => onAccountAction(student, 'provision')}>
              <UserRoundCheck className="mr-1 h-3.5 w-3.5" /> Provision login
            </Button>
          )}
          {isSuperAdmin && student.account.exists && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAccountAction(student, 'email')}><Mail className="mr-1 h-3.5 w-3.5" /> Email</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAccountAction(student, 'password')}><KeyRound className="mr-1 h-3.5 w-3.5" /> Password</Button>
              <Button size="sm" variant={student.account.active ? 'destructive' : 'outline'} className="h-7 text-xs" onClick={() => onAccountAction(student, student.account.active ? 'deactivate' : 'activate')}>
                {student.account.active ? 'Disable login' : 'Enable login'}
              </Button>
            </>
          )}
          {isSuperAdmin && (
            <Button
              size="sm"
              variant={archived ? 'outline' : 'destructive'}
              className="h-7 text-xs"
              onClick={() => onLifecycleAction(student, archived ? 'reactivate' : 'archive')}
            >
              {archived ? <RotateCcw className="mr-1 h-3.5 w-3.5" /> : <Archive className="mr-1 h-3.5 w-3.5" />}
              {archived ? 'Reactivate' : 'Archive'}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
            <Link to="/admin/stays"><BedDouble className="mr-1 h-3.5 w-3.5" /> View Stays</Link>
          </Button>
        </div>
        {!isSuperAdmin && <p className="text-[11px] text-slate-500">Student and credential changes require Super Admin access.</p>}
      </CardContent>
    </Card>
  );
}

export function AdminMembersPage() {
  const auth = useAuth();
  const students = useStudents();
  const [accountSelection, setAccountSelection] = useState(null);
  const [profileDialog, setProfileDialog] = useState({ open: false, student: null });
  const [lifecycleSelection, setLifecycleSelection] = useState(null);
  const isSuperAdmin = auth.role === 'superadmin';
  const activeStudents = students.data.filter((student) => student.status === 'ACTIVE');
  const historicalStudents = students.data.filter((student) => student.status === 'ARCHIVED');
  const nextRosterOrder = useMemo(() => (
    students.data.length === 0
      ? 0
      : Math.max(...students.data.map((student) => student.rosterOrder)) + 10
  ), [students.data]);

  const submitAccountAction = async (payload) => {
    const { student, action } = accountSelection;
    if (action === 'provision') return students.provisionAccount(student.studentId, payload);
    if (action === 'email') return students.changeEmail(student.studentId, payload);
    if (action === 'password') return students.resetPassword(student.studentId, payload);
    return students.setAccountActive(student.studentId, action === 'activate', payload);
  };

  const submitProfile = (payload) => (
    profileDialog.student
      ? students.updateStudent(profileDialog.student.studentId, payload)
      : students.createStudent(payload)
  );

  const submitLifecycle = (payload) => (
    lifecycleSelection.action === 'archive'
      ? students.archiveStudent(lifecycleSelection.student.studentId, payload)
      : students.reactivateStudent(lifecycleSelection.student.studentId, payload)
  );

  const renderCards = (rows) => (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {rows.map((student) => (
        <StudentCard
          key={student.studentId}
          student={student}
          isSuperAdmin={isSuperAdmin}
          onEdit={(selectedStudent) => setProfileDialog({ open: true, student: selectedStudent })}
          onAccountAction={(selectedStudent, action) => setAccountSelection({ student: selectedStudent, action })}
          onLifecycleAction={(selectedStudent, action) => setLifecycleSelection({ student: selectedStudent, action })}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-8 pb-8">
      <PageHeader
        eyebrow="Administration"
        title="Student Management"
        description="Manage dynamic student identities, meal eligibility, login access, and historical roster state independently from Hostel Stays and finances."
      >
        <Badge variant="secondary"><Users className="h-3.5 w-3.5" /> Students: {students.data.length}</Badge>
        {isSuperAdmin && (
          <Button onClick={() => setProfileDialog({ open: true, student: null })}>
            <UserPlus className="mr-2 h-4 w-4" /> Add student
          </Button>
        )}
      </PageHeader>

      {students.loading && students.data.length === 0 && (
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-96 rounded-lg" />)}</div>
      )}
      {students.error && (
        <ErrorState title="Student roster unavailable" message={students.error} actionLabel="Try again" onAction={students.refresh} />
      )}
      {!students.loading && !students.error && (
        <>
          <section className="space-y-3" aria-labelledby="active-students-heading">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="active-students-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">Active students</h2>
                <p className="text-xs text-slate-500">Current roster identities. Login and accommodation remain optional.</p>
              </div>
              <Badge variant="outline">{activeStudents.length}</Badge>
            </div>
            {activeStudents.length > 0
              ? renderCards(activeStudents)
              : <EmptyState title="No active students" message="Add a student when the next verified roster identity is available." icon={Users} />}
          </section>

          <section className="space-y-3" aria-labelledby="historical-students-heading">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="historical-students-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">Historical students</h2>
                <p className="text-xs text-slate-500">Archived identities remain available for historical meals, costs, accounts, and audit records.</p>
              </div>
              <Badge variant="outline">{historicalStudents.length}</Badge>
            </div>
            {historicalStudents.length > 0
              ? renderCards(historicalStudents)
              : <EmptyState title="No archived students" message="Archived identities will appear here without deleting historical references." icon={Archive} />}
          </section>
        </>
      )}

      <StudentDialog
        open={profileDialog.open}
        onOpenChange={(open) => setProfileDialog((current) => ({ ...current, open }))}
        student={profileDialog.student}
        nextRosterOrder={nextRosterOrder}
        onSubmit={submitProfile}
      />
      <StudentLifecycleDialog
        open={Boolean(lifecycleSelection)}
        onOpenChange={(open) => !open && setLifecycleSelection(null)}
        student={lifecycleSelection?.student}
        action={lifecycleSelection?.action}
        onSubmit={submitLifecycle}
      />
      <MemberAccountDialog
        open={Boolean(accountSelection)}
        onOpenChange={(open) => !open && setAccountSelection(null)}
        member={accountSelection?.student}
        action={accountSelection?.action}
        onSubmit={submitAccountAction}
      />
    </div>
  );
}
