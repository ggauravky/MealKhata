import { ChevronDown, Download, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { usePwa } from '../../hooks/usePwa.js';
import { getRoleLabel } from '../../lib/constants.js';
import { MemberAvatar } from '../ui/avatar.jsx';
import { Button } from '../ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.jsx';

export function AccountMenu({ mobile = false }) {
  const auth = useAuth();
  const { canInstall, installApp } = usePwa();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const handleLogout = async () => {
    setSubmitting(true);
    try {
      await auth.logout();
      navigate('/login');
    } catch {
      // Ignored
    } finally {
      setSubmitting(false);
    }
  };

  if (auth.loading) {
    return (
      <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
    );
  }

  if (!auth.authenticated) {
    return (
      <Button
        variant="outline"
        size="sm"
        asChild
        className="text-xs font-medium text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800"
      >
        <Link to="/login">
          <LogIn className="h-3.5 w-3.5" />
          <span>Sign in</span>
        </Link>
      </Button>
    );
  }

  const displayName = auth.displayName || (auth.role === 'superadmin' ? 'Super Admin' : 'Admin');
  const roleLabel = getRoleLabel(auth.role);
  const canAccessAdmin = auth.role === 'admin' || auth.role === 'superadmin';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 gap-2 text-xs font-medium rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <MemberAvatar
            memberId={auth.memberId || auth.role}
            name={displayName}
            size="sm"
          />
          {!mobile && (
            <span className="max-w-[100px] truncate text-slate-800 dark:text-slate-200">
              {displayName}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
            {displayName}
          </span>
          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
            {roleLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {canAccessAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin" className="flex items-center gap-2 cursor-pointer">
              <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <span>Admin panel</span>
            </Link>
          </DropdownMenuItem>
        )}

        {canInstall && (
          <DropdownMenuItem
            onClick={() => installApp()}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Download className="h-4 w-4 text-slate-500" />
            <span>Install app</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleLogout}
          disabled={submitting}
          className="flex items-center gap-2 text-red-600 dark:text-red-400 focus:text-red-700 dark:focus:text-red-300 focus:bg-red-50 dark:focus:bg-red-950/40 cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          <span>{submitting ? 'Signing out...' : 'Sign out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
