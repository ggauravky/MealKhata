import { BedDouble, House, KeyRound, Mail, ShieldCheck, UserRoundCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { MemberAccountDialog } from '../components/members/MemberAccountDialog.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useMembers } from '../hooks/useMembers.js';

function displayDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString('en-IN');
}

export function AdminMembersPage() {
  const auth = useAuth();
  const members = useMembers();
  const [selection, setSelection] = useState(null);
  const isSuperAdmin = auth.role === 'superadmin';

  const submitAction = async (payload) => {
    const { member, action } = selection;
    if (action === 'provision') return members.provisionAccount(member.memberId, payload);
    if (action === 'email') return members.changeEmail(member.memberId, payload);
    if (action === 'password') return members.resetPassword(member.memberId, payload);
    return members.setAccountActive(member.memberId, action === 'activate', payload);
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        eyebrow="Administration"
        title="Member Management"
        description="Canonical login accounts linked to the three stable member identities. Account access and Hostel Stays are managed independently."
      >
        <Badge variant="secondary"><Users className="h-3.5 w-3.5" /> Members: 3</Badge>
      </PageHeader>

      {members.loading && members.data.length === 0 && (
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-72 rounded-lg" />)}</div>
      )}
      {members.error && (
        <ErrorState title="Member accounts unavailable" message={members.error} actionLabel="Try again" onAction={members.refresh} />
      )}
      {!members.error && members.data.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          {members.data.map((member) => (
            <Card key={member.memberId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{member.name}</CardTitle>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">{member.memberId}</p>
                  </div>
                  <Badge variant={!member.account.exists ? 'secondary' : member.account.active ? 'taking' : 'destructive'}>
                    {!member.account.exists ? 'Not configured' : member.account.active ? 'Login active' : 'Login disabled'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100"><ShieldCheck className="h-4 w-4 text-teal-600" /> Account</h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-500">
                    <dt>Email</dt><dd className="truncate text-right text-slate-800 dark:text-slate-200">{member.account.email || 'â€”'}</dd>
                    <dt>Last login</dt><dd className="text-right text-slate-800 dark:text-slate-200">{displayDate(member.account.lastLoginAt)}</dd>
                  </dl>
                </section>
                <section className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <h3 className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100"><House className="h-4 w-4 text-teal-600" /> Hostel</h3>
                  <div className="flex items-center justify-between text-slate-500"><span>Stay</span><span className="text-slate-800 dark:text-slate-200">{member.stay?.status || 'Not registered'}</span></div>
                  <div className="flex items-center justify-between text-slate-500"><span>Room</span><span className="text-slate-800 dark:text-slate-200">{member.room ? `Room ${member.room.roomNumber}` : 'â€”'}</span></div>
                </section>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {isSuperAdmin && !member.account.exists && <Button size="sm" className="h-7 text-xs" onClick={() => setSelection({ member, action: 'provision' })}><UserRoundCheck className="mr-1 h-3.5 w-3.5" /> Provision</Button>}
                  {isSuperAdmin && member.account.exists && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelection({ member, action: 'email' })}><Mail className="mr-1 h-3.5 w-3.5" /> Email</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelection({ member, action: 'password' })}><KeyRound className="mr-1 h-3.5 w-3.5" /> Password</Button>
                      <Button size="sm" variant={member.account.active ? 'destructive' : 'outline'} className="h-7 text-xs" onClick={() => setSelection({ member, action: member.account.active ? 'deactivate' : 'activate' })}>
                        {member.account.active ? 'Disable login' : 'Enable login'}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 text-xs" asChild><Link to="/admin/stays"><BedDouble className="mr-1 h-3.5 w-3.5" /> View Stay</Link></Button>
                </div>
                {!isSuperAdmin && <p className="text-[11px] text-slate-500">Credential changes require Super Admin access.</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <MemberAccountDialog
        open={Boolean(selection)}
        onOpenChange={(open) => !open && setSelection(null)}
        member={selection?.member}
        action={selection?.action}
        onSubmit={submitAction}
      />
    </div>
  );
}
