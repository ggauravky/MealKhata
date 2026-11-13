import { CalendarClock, KeyRound, ShieldCheck, UserCog, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { ChangePasswordDialog } from '../components/settings/ChangePasswordDialog.jsx';
import { StaffAccountDialog } from '../components/settings/StaffAccountDialog.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useStaffAccounts } from '../hooks/useStaffAccounts.js';

const AUDIT_LABELS = {
  SUPERADMIN_INITIALIZED: 'Super Admin set up',
  ADMIN_CREATED: 'Admin added',
  ADMIN_PASSWORD_RESET: 'Admin password reset',
  ADMIN_ACTIVATED: 'Admin enabled',
  ADMIN_DEACTIVATED: 'Admin disabled',
  ADMIN_PROFILE_UPDATED: 'Admin renamed',
  PASSWORD_CHANGED: 'Password changed',
  SYSTEM_SETTINGS_UPDATED: 'Settings changed',
};

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function AccountRow({ account, onAction }) {
  const isSuperAdmin = account.role === 'superadmin';
  return (
    <li data-testid={`staff-account-${account.email}`} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{account.displayName}</span>
          <Badge variant={isSuperAdmin ? 'default' : 'secondary'}>{isSuperAdmin ? 'Super Admin' : 'Admin'}</Badge>
          {!account.active && <Badge variant="skip">Disabled</Badge>}
        </div>
        <p className="mt-0.5 break-all text-xs text-slate-500">{account.email}</p>
        <p className="text-[11px] text-slate-400">Last sign-in: {formatDateTime(account.lastLoginAt)}</p>
      </div>
      {!isSuperAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onAction('password', account)}>
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Reset password
          </Button>
          {account.active ? (
            <Button size="sm" variant="outline" onClick={() => onAction('deactivate', account)}>Disable</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => onAction('activate', account)}>Enable</Button>
          )}
        </div>
      )}
    </li>
  );
}

export function AdminSettingsPage() {
  useDocumentTitle('Settings');
  const { role } = useAuth();
  const isSuperAdmin = role === 'superadmin';
  const staff = useStaffAccounts({ enabled: isSuperAdmin });
  const [dialog, setDialog] = useState({ open: false, action: 'create', account: null });
  const [passwordOpen, setPasswordOpen] = useState(false);

  const openDialog = (action, account = null) => setDialog({ open: true, action, account });

  const submitDialog = async (values) => {
    const { action, account } = dialog;
    const currentPassword = values.currentPassword;
    if (action === 'create') {
      await staff.createAdmin({ email: values.email, displayName: values.displayName,
        newPassword: values.newPassword, currentPassword });
    } else if (action === 'password') {
      await staff.resetAdminPassword(account.userId, { newPassword: values.newPassword, currentPassword });
    } else if (action === 'activate' || action === 'deactivate') {
      await staff.setAdminActive(account.userId, action === 'activate', { currentPassword });
    } else if (action === 'settings') {
      await staff.updateSettings({ financialStartDate: values.financialStartDate,
        expectedRevision: staff.settings?.revision ?? 0, currentPassword });
    }
  };

  const admins = staff.accounts;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Super Admin"
        title="Settings & access"
        description="Manage administrator accounts, your own password and system-wide settings."
      >
        <Button variant="outline" onClick={() => setPasswordOpen(true)}>
          <KeyRound className="h-4 w-4" aria-hidden="true" /> Change my password
        </Button>
      </PageHeader>

      {!isSuperAdmin ? (
        <EmptyState icon={ShieldCheck} title="Super Admin only"
          message="Administrator accounts and system settings can only be changed by the Super Admin." />
      ) : staff.error ? (
        <ErrorState title="Settings unavailable" message={staff.error} actionLabel="Retry" onAction={staff.refresh} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2"><UserCog className="h-4 w-4" aria-hidden="true" /> Administrators</CardTitle>
                <Button size="sm" onClick={() => openDialog('create')}>
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add admin
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {staff.loading ? (
                <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {admins.map((account) => <AccountRow key={account.userId} account={account} onAction={openDialog} />)}
                </ul>
              )}
              {!staff.loading && admins.every((account) => account.role === 'superadmin') && (
                <p className="mt-2 text-xs text-slate-500">No administrators yet. Admins can run daily operations without access to account management.</p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" aria-hidden="true" /> System</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {staff.loading || !staff.settings ? <Skeleton className="h-16" /> : (
                  <>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Financial start date</span>
                      <span data-testid="financial-start-date" className="font-semibold">{staff.settings.financialStartDate ?? 'Not set'}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Timezone</span>
                      <span className="font-semibold">{staff.settings.timezone}</span>
                    </div>
                    {staff.settings.financialStartDateLocked ? (
                      <p className="text-xs text-slate-500">The start date is locked because records already exist.</p>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => openDialog('settings')}>Change start date</Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Recent account activity</CardTitle></CardHeader>
              <CardContent>
                {staff.loading ? <Skeleton className="h-20" /> : staff.audit.length === 0 ? (
                  <p className="text-xs text-slate-500">No activity yet.</p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {staff.audit.map((event) => (
                      <li key={event.auditId} className="flex justify-between gap-3">
                        <span className="font-medium">{AUDIT_LABELS[event.event] ?? event.event}</span>
                        <span className="shrink-0 text-slate-500">{formatDateTime(event.occurredAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <StaffAccountDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        action={dialog.action}
        account={dialog.account}
        settings={staff.settings}
        onSubmit={submitDialog}
      />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}
