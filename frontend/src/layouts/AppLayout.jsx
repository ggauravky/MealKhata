import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { BrandMark } from '../components/layout/BrandMark.jsx';
import { DesktopNav } from '../components/layout/DesktopNav.jsx';
import { AccountMenu } from '../components/layout/AccountMenu.jsx';
import { ThemeToggle } from '../components/common/ThemeToggle.jsx';
import { MobileNav } from '../components/layout/MobileNav.jsx';
import { IosInstallPrompt } from '../components/pwa/IosInstallPrompt.jsx';
import { OfflineBanner } from '../components/pwa/OfflineBanner.jsx';
import { UpdateAvailableBanner } from '../components/pwa/UpdateAvailableBanner.jsx';
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
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0f1115] dark:text-slate-100 flex flex-col font-sans transition-colors duration-150">
        <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#171a1f]/90">
          <div className="mx-auto flex h-14 max-w-[1160px] items-center justify-between px-4 sm:px-6">
            <BrandMark />
            <DesktopNav />
            <div className="flex items-center gap-1 md:hidden">
              <ThemeToggle />
              <AccountMenu mobile />
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={location.pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 w-full mx-auto max-w-[1160px] px-4 sm:px-6 py-6 pb-24 md:pb-12"
          >
            <OfflineBanner />
            <UpdateAvailableBanner />
            <IosInstallPrompt />
            <ReminderBanner />
            <Outlet />
          </motion.main>
        </AnimatePresence>

        <MobileNav />
      </div>
    </ReminderProvider>
  );
}
