import {
  BedDouble,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Layers,
  Send,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader.jsx';
import { AdminFeePlansTab } from '../components/roomFees/admin/AdminFeePlansTab.jsx';
import { AdminMonthlyChargesTab } from '../components/roomFees/admin/AdminMonthlyChargesTab.jsx';
import { AdminOverviewTab } from '../components/roomFees/admin/AdminOverviewTab.jsx';
import { AdminPaymentsTab } from '../components/roomFees/admin/AdminPaymentsTab.jsx';
import { AdminRoomsTab } from '../components/roomFees/admin/AdminRoomsTab.jsx';
import { AdminSettingsTab } from '../components/roomFees/admin/AdminSettingsTab.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardHeader } from '../components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import {
  useAdminRoomFeeSummary,
  useMemberFeePlans,
  useRoomPaymentSettings,
  useRooms,
} from '../hooks/useRoomFees.js';
import { useServerToday } from '../hooks/useServerToday.js';
import { addLogicalMonths, formatLogicalMonth, isValidLogicalMonth } from '../lib/logicalMonth.js';
import { getIndiaCurrentLogicalMonth } from '../lib/logicalDate.js';

const VALID_TABS = ['overview', 'rooms', 'plans', 'charges', 'payments', 'settings'];

export function AdminRoomFeesPage() {
  useDocumentTitle('Room Fee Administration');
  const auth = useAuth();
  const serverToday = useServerToday();
  const [searchParams, setSearchParams] = useSearchParams();

  const queryMonth = searchParams.get('month');
  const currentLogicalMonth = serverToday.date ? serverToday.date.slice(0, 7) : getIndiaCurrentLogicalMonth();
  const month = isValidLogicalMonth(queryMonth) ? queryMonth : currentLogicalMonth;

  const tabQuery = searchParams.get('tab');
  const activeTab = VALID_TABS.includes(tabQuery) ? tabQuery : 'overview';

  const setActiveTab = (newTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', newTab);
    setSearchParams(next);
  };

  const setMonth = (newMonth) => {
    const next = new URLSearchParams(searchParams);
    next.set('month', newMonth);
    setSearchParams(next);
  };

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
  } = useAdminRoomFeeSummary(month);

  const {
    rooms,
    loading: roomsLoading,
    error: roomsError,
    refresh: refreshRooms,
  } = useRooms();

  const {
    plans,
    loading: plansLoading,
    error: plansError,
    memberErrors: plansMemberErrors,
    refresh: refreshPlans,
  } = useMemberFeePlans(['gaurav', 'nikhil', 'devansh'], month);

  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
    refresh: refreshSettings,
  } = useRoomPaymentSettings();

  const handleRefreshAll = () => {
    refreshSummary();
    refreshRooms();
    refreshPlans();
    refreshSettings();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Room Fee Administration"
          description="Manage rooms, individual pricing, monthly charges, and verified payment records."
        />
        <div className="flex items-center gap-1.5 self-start sm:self-center">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setMonth(addLogicalMonths(month, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs font-medium"
            onClick={() => setMonth(currentLogicalMonth)}
          >
            Current
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setMonth(addLogicalMonths(month, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 rounded-sm border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ml-1 cursor-pointer"
            aria-label="Select month"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-full justify-start h-auto p-1 bg-slate-100 dark:bg-slate-900/60 flex-nowrap min-w-max">
            <TabsTrigger value="overview" className="gap-1.5 py-2 px-3">
              <Layers className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="rooms" className="gap-1.5 py-2 px-3">
              <BedDouble className="h-4 w-4" />
              <span>Rooms</span>
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-1.5 py-2 px-3">
              <Users className="h-4 w-4" />
              <span>Fee Plans</span>
            </TabsTrigger>
            <TabsTrigger value="charges" className="gap-1.5 py-2 px-3">
              <Send className="h-4 w-4" />
              <span>Monthly Charges</span>
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5 py-2 px-3">
              <CircleDollarSign className="h-4 w-4" />
              <span>Payments</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 py-2 px-3">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <AdminOverviewTab
            summary={summary}
            month={month}
            onSwitchTab={setActiveTab}
            loading={summaryLoading}
            error={summaryError}
            onRefresh={refreshSummary}
          />
        </TabsContent>

        <TabsContent value="rooms">
          <AdminRoomsTab
            rooms={rooms}
            onRefresh={handleRefreshAll}
            role={auth.role}
            loading={roomsLoading}
            error={roomsError}
          />
        </TabsContent>

        <TabsContent value="plans">
          <AdminFeePlansTab
            plans={plans}
            rooms={rooms}
            onRefresh={handleRefreshAll}
            loading={plansLoading}
            error={plansError}
            memberErrors={plansMemberErrors}
            targetMonth={month}
            role={auth.role}
          />
        </TabsContent>

        <TabsContent value="charges">
          <AdminMonthlyChargesTab
            month={month}
            summary={summary}
            onRefresh={handleRefreshAll}
            role={auth.role}
            loading={summaryLoading}
            error={summaryError}
          />
        </TabsContent>

        <TabsContent value="payments">
          <AdminPaymentsTab
            month={month}
            summary={summary}
            onRefresh={handleRefreshAll}
            role={auth.role}
          />
        </TabsContent>

        <TabsContent value="settings">
          <AdminSettingsTab
            settings={settings}
            onRefresh={handleRefreshAll}
            loading={settingsLoading}
            error={settingsError}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
