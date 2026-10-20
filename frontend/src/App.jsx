import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/auth/ProtectedRoute.jsx';
import { AppLayout } from './layouts/AppLayout.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { LoadingState } from './components/ui/LoadingState.jsx';

const AdminPage = lazy(() => import('./pages/AdminPage.jsx').then((module) => ({ default: module.AdminPage })));
const AdminRoomFeesPage = lazy(() => import('./pages/AdminRoomFeesPage.jsx').then((module) => ({ default: module.AdminRoomFeesPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage.jsx').then((module) => ({ default: module.CalendarPage })));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage.jsx').then((module) => ({ default: module.PaymentsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx').then((module) => ({ default: module.ReportsPage })));
const RoomFeesPage = lazy(() => import('./pages/RoomFeesPage.jsx').then((module) => ({ default: module.RoomFeesPage })));

export default function App() {
  return (
    <Suspense fallback={<LoadingState label="Loading page" />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="room-fees" element={<RoomFeesPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin/room-fees" element={<AdminRoomFeesPage />} />
          </Route>
        </Route>
        <Route path="login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
