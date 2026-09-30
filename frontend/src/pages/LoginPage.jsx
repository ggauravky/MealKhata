import { ArrowLeft, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandMark } from '../components/layout/BrandMark.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { LoadingState } from '../components/ui/LoadingState.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { ApiError } from '../lib/api.js';
import { getRoleLabel } from '../lib/constants.js';
import { getSafeNextPath } from '../lib/navigation.js';

export function LoginPage() {
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
    <main className="login-page">
      <div className="login-page__topbar">
        <BrandMark compact />
        <Link className="text-link text-link--with-icon" to="/">
          <ArrowLeft size={17} strokeWidth={1.8} aria-hidden="true" />
          Back home
        </Link>
      </div>

      <section className="login-panel" aria-labelledby="login-title">
        <span className="login-panel__icon" aria-hidden="true">
          <LockKeyhole size={25} strokeWidth={1.7} />
        </span>

        {auth.loading ? (
          <LoadingState label="Restoring your session" />
        ) : auth.authenticated ? (
          <div className="signed-in-panel">
            <div className="login-panel__heading">
              <h1 id="login-title">You are already signed in</h1>
              <p>Your current role is {auth.displayName ? `${auth.displayName} (${getRoleLabel(auth.role)})` : getRoleLabel(auth.role)}.</p>
            </div>
            {error && <ErrorState title="Could not sign out" message={error} />}
            <div className="login-panel__actions">
              {(auth.role === 'admin' || auth.role === 'superadmin') ? (
                <Link className="button button--primary button--full" to="/admin">
                  Go to Admin
                </Link>
              ) : (
                <Link className="button button--primary button--full" to="/">
                  Go to Today&apos;s Meals
                </Link>
              )}
              <button
                className="button button--quiet button--full"
                type="button"
                onClick={handleLogout}
                disabled={submitting}
              >
                {submitting ? 'Signing out' : 'Logout'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="login-panel__heading">
              <h1 id="login-title">Sign in</h1>
              <p>Sign in to your MealKhata account.</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
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
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="password-input">
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
                  />
                  <button
                    className="password-input__toggle"
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={submitting}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>

              {error && (
                <ErrorState
                  title={error === 'Invalid email or password.' ? 'Login failed' : 'Unable to log in'}
                  message={error}
                  compact
                />
              )}

              <button className="button button--primary button--full" type="submit" disabled={submitting}>
                {submitting ? 'Signing in' : 'Login'}
              </button>
            </form>

            <p className="login-panel__note">Your session stays in a secure HttpOnly cookie.</p>
          </>
        )}
      </section>
    </main>
  );
}
