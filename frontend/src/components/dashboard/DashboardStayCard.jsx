import { ArrowRight, BedDouble, ChevronRight, House, LogOut, ShieldCheck, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { useAdminStays, useMyStay } from '../../hooks/useStays.js';
import { Button } from '../ui/button.jsx';
import { Card, CardContent } from '../ui/card.jsx';
import { StayStatusBadge } from '../stays/StayStatusBadge.jsx';

export function DashboardStayCard() {
  const auth = useAuth();

  if (!auth.authenticated || auth.role === 'viewer') {
    return null;
  }

  const isMember = auth.role === 'member';
  const isAdminOrSuper = auth.role === 'admin' || auth.role === 'superadmin';

  if (isMember) {
    return <MemberDashboardStayWidget />;
  }

  if (isAdminOrSuper) {
    return <AdminDashboardStayWidget />;
  }

  return null;
}

function MemberDashboardStayWidget() {
  const { data } = useMyStay();
  const stay = data?.stay;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs hover:border-teal-300 dark:hover:border-teal-700/60 transition-colors">
      <CardContent className="p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-teal-50 dark:bg-teal-950/70 flex items-center justify-center text-teal-700 dark:text-teal-300 shrink-0">
            <House className="h-5 w-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                My Hostel Stay
              </span>
              {stay && <StayStatusBadge status={stay.status} />}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {stay
                ? `Joined ${stay.joinedOn} • Room ${stay.initialRoomId || '—'}`
                : 'Hostel stay record not yet configured.'}
            </p>
          </div>
        </div>

        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-teal-700 dark:text-teal-400 hover:text-teal-800 shrink-0">
          <Link to="/my-stay" className="flex items-center gap-1">
            <span>View Journey</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function AdminDashboardStayWidget() {
  const { stays = [] } = useAdminStays();
  const activeCount = stays.filter((s) => s.status === 'ACTIVE').length;
  const requestCount = stays.filter((s) => s.status === 'CHECKOUT_REQUESTED' || s.status === 'CHECKOUT_PENDING').length;

  return (
    <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs hover:border-teal-300 dark:hover:border-teal-700/60 transition-colors">
      <CardContent className="p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-teal-50 dark:bg-teal-950/70 flex items-center justify-center text-teal-700 dark:text-teal-300 shrink-0">
            <House className="h-5 w-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Hostel Lifecycle & Stays
              </span>
              {requestCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px] font-semibold">
                  {requestCount} checkout request{requestCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {activeCount} active resident{activeCount === 1 ? '' : 's'} • Security deposits & clearance
            </p>
          </div>
        </div>

        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-teal-700 dark:text-teal-400 hover:text-teal-800 shrink-0">
          <Link to="/admin/stays" className="flex items-center gap-1">
            <span>Manage</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
