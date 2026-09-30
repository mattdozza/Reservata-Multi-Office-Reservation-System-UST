import { ActivityView, OfficesView, ProfileView, UsersView } from "./admin/AdminViews.jsx";
import DashboardView from "./dashboard/DashboardViews.jsx";
import {
  ApprovalsView,
  CalendarView,
  NewReservationView,
  NotificationsView,
  PaymentsView,
  ReservationsView,
  ResourcesView
} from "./reservations/ReservationViews.jsx";
import { RequesterCalendarView } from "./reservations/RequesterCalendarView.jsx";
import { OfficeSettingsView, WorkflowsView } from "./settings/SettingsViews.jsx";
import {
  ArrivalsView,
  NewVisitorView,
  ParkingView,
  VisitorRecordsView,
  VisitorRequestsView
} from "./visitors/VisitorViews.jsx";

export default function ViewRouter({ store, selectedResourceId, selectedSchedule, onAction, onNavigate, onReserve }) {
  const props = { store, onAction, onNavigate, onReserve };
  const views = {
    dashboard: <DashboardView {...props} />,
    resources: <ResourcesView {...props} />,
    newRequest: <NewReservationView {...props} selectedResourceId={selectedResourceId} selectedSchedule={selectedSchedule} />,
    myRequests: <ReservationsView {...props} />,
    calendar: store.session.activeRole === "requester" ? <RequesterCalendarView {...props} /> : <CalendarView {...props} />,
    notifications: <NotificationsView {...props} />,
    approvalQueue: <ApprovalsView {...props} />,
    eventReviews: <ApprovalsView {...props} />,
    payments: <PaymentsView {...props} />,
    activity: <ActivityView {...props} />,
    offices: <OfficesView {...props} />,
    users: <UsersView {...props} />,
    officeSettings: <OfficeSettingsView {...props} />,
    workflows: <WorkflowsView {...props} />,
    visitorRequests: <VisitorRequestsView {...props} />,
    parking: <ParkingView {...props} />,
    arrivals: <ArrivalsView {...props} />,
    visitorRecords: <VisitorRecordsView {...props} />,
    newVisitor: <NewVisitorView {...props} />,
    profile: <ProfileView {...props} />
  };
  return views[store.session.activeView] || views.dashboard;
}
