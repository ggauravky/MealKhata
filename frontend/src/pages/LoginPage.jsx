import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MealKhataLogo } from '../components/brand/MealKhataLogo.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { ApiError } from '../lib/api.js';
import { getRoleLabel } from '../lib/constants.js';
import { getSafeNextPath } from '../lib/navigation.js';

export function LoginPage() {
  useDocumentTitle('Sign In');
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const session = await auth.login({ email, password });
      const rawNext = searchParams.get('next');
      let destination = '/';
      if (session.role === 'admin' || session.role === 'superadmin') {
        destination = getSafeNextPath(rawNext, '/admin');
      } else {
        const safeNext = getSafeNextPath(rawNext, '/');
        destination = safeNext.startsWith('/admin') ? '/' : safeNext;
      }
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 401
          ? 'Invalid email or password.'
          : 'Login could not be completed. Please try again.',
      );
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setSubmitting(true);
    setError('');

    try {
      await auth.logout();
    } catch {
      setError('Logout could not be completed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen w-full flex flex-col justify-center items-center p-4 bg-slate-50 dark:bg-[#0f1115] relative">
      {/* Subtle brand radial glow */}
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_70%_70%_at_50%_0%,rgba(15,118,110,0.06),transparent)] dark:bg-[radial-gradient(ellipse_70%_70%_at_50%_0%,rgba(20,184,166,0.08),transparent)] pointer-events-none"
        aria-hidden="true"
      />

      <div className="w-full max-w-sm z-10 space-y-6">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to home</span>
          </Link>
        </div>

        <Card className="border-slate-200/90 dark:border-slate-800 shadow-md bg-white dark:bg-[#171a1f]">
          <CardHeader className="text-center items-center pb-4 pt-6 space-y-2">
            <MealKhataLogo variant="mark" size={36} />
            <div>
              <CardTitle className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Welcome back
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sign in to manage your meals and bills.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pb-6">
            {auth.loading ? (
              <LoadingState label="Restoring your session..." />
            ) : auth.authenticated ? (
              <div className="space-y-4 text-center">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3.5 text-xs text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-800">
                  <span className="block font-medium text-slate-800 dark:text-slate-200 mb-0.5">
                    Already signed in
                  </span>
                  <span>
                    Current role: {auth.displayName ? `${auth.displayName} (${getRoleLabel(auth.role)})` : getRoleLabel(auth.role)}
                  </span>
                </div>

                <div className="space-y-2">
                  <Button variant="default" className="w-full" asChild>
                    <Link to={auth.role === 'admin' || auth.role === 'superadmin' ? '/admin' : '/'}>
                      Go to {auth.role === 'admin' || auth.role === 'superadmin' ? 'Admin' : 'Dashboard'}
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleLogout}
                    disabled={submitting}
                  >
                    {submitting ? 'Signing out...' : 'Sign out'}
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label
                    htmlFor="email"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={254}
                    disabled={submitting}
                    required
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="password"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      maxLength={256}
                      disabled={submitting}
                      required
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      disabled={submitting}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  variant="default"
                  className="w-full font-semibold mt-2"
                  disabled={submitting}
                >
                  {submitting ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
          Your session stays securely encrypted in an HttpOnly cookie.
        </p>
      </div>
    </main>
  );
}
