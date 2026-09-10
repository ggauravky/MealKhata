import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AuthActions } from '../components/auth/AuthActions.jsx';
import { BrandMark } from '../components/layout/BrandMark.jsx';
import { DesktopNav } from '../components/layout/DesktopNav.jsx';
import { MobileNav } from '../components/layout/MobileNav.jsx';
import { ReminderBanner } from '../components/reminders/ReminderBanner.jsx';
import { ReminderProvider } from '../context/ReminderProvider.jsx';
import { connectSocket, disconnectSocket, socket } from '../lib/socket.js';

export function AppLayout() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const logConnection = () => {
      if (import.meta.env.DEV) {
        console.info('MealKhata socket connected');
      }
    };

    const logDisconnection = () => {
      if (import.meta.env.DEV) {
        console.info('MealKhata socket disconnected');
      }
    };

    socket.on('connect', logConnection);
    socket.on('disconnect', logDisconnection);
    connectSocket();

    return () => {
      socket.off('connect', logConnection);
      socket.off('disconnect', logDisconnection);
      disconnectSocket();
    };
  }, []);

  return (
    <ReminderProvider>
      <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <BrandMark />
          <DesktopNav />
          <div className="mobile-auth-actions">
            <AuthActions mobile />
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          className="app-content"
          key={location.pathname}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <ReminderBanner />
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <MobileNav />
      </div>
    </ReminderProvider>
  );
}
