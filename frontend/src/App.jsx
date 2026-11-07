import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/auth/ProtectedRoute.jsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.jsx';
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
const ExpensesPage = lazy(() => import('./pages/ExpensesPage.jsx').then((module) => ({ default: module.ExpensesPage })));
const AdminExpensesPage = lazy(() => import('./pages/AdminExpensesPage.jsx').then((module) => ({ default: module.AdminExpensesPage })));
const MyStayPage = lazy(() => import('./pages/MyStayPage.jsx').then((module) => ({ default: module.MyStayPage })));
const AdminStaysPage = lazy(() => import('./pages/AdminStaysPage.jsx').then((module) => ({ default: module.AdminStaysPage })));
const AdminMembersPage = lazy(() => import('./pages/AdminMembersPage.jsx').then((module) => ({ default: module.AdminMembersPage })));

export default function App() {
  return (
    <Suspense fallback={<LoadingState label="Loading page" />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="room-fees" element={<RoomFeesPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="my-stay" element={<ErrorBoundary><MyStayPage /></ErrorBoundary>} />
          <Route element={<ProtectedRoute />}>
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin/room-fees" element={<AdminRoomFeesPage />} />
            <Route path="admin/expenses" element={<AdminExpensesPage />} />
            <Route path="admin/stays" element={<AdminStaysPage />} />
            <Route path="admin/members" element={<AdminMembersPage />} />
          </Route>
        </Route>
        <Route path="login" element={<LoginPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
