import { ActivityView, OfficesView, ProfileView, UsersView } from "./AdminViews.jsx";
import DashboardView from "./DashboardViews.jsx";
import {
  ApprovalsView,
  CalendarView,
  NewReservationView,
  NotificationsView,
  PaymentsView,
  ReservationsView,
  ResourcesView
} from "./ReservationViews.jsx";
import { OfficeSettingsView, WorkflowsView } from "./SettingsViews.jsx";
import {
  ArrivalsView,
  MyVisitorRequestsView,
  NewVisitorView,
  ParkingView,
  VisitorRecordsView,
  VisitorRequestsView
} from "./VisitorViews.jsx";

export default function ViewRouter({ store, selectedResourceId, onAction, onNavigate, onReserve }) {
  const props = { store, onAction, onNavigate, onReserve };
  const views = {
    dashboard: <DashboardView {...props} />,
    resources: <ResourcesView {...props} />,
    newRequest: <NewReservationView {...props} selectedResourceId={selectedResourceId} />,
    myRequests: <ReservationsView {...props} />,
    calendar: <CalendarView {...props} />,
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
    myVisitorRequests: <MyVisitorRequestsView {...props} />,
    profile: <ProfileView {...props} />
  };
  return views[store.session.activeView] || views.dashboard;
}
