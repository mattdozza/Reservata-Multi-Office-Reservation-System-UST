import { ActivityRows, Badge, CardHeader, ChartSummary, EmptyState, Metrics, ReservationRows, ResourceMiniRows, StatusTiles } from "../../components/Common.jsx";
import { OfficeRows } from "../admin/AdminViews.jsx";
import { ApprovalRows } from "../reservations/ReservationViews.jsx";
import { ArrivalRows, VisitorRows } from "../visitors/VisitorViews.jsx";
import { formatDate } from "../../shared/utils.js";
import { CheckCircle2 } from "lucide-react";

const COLORS = {
  blue: { accent: "#1a7d9d", color: "#1a7d9d" },
  yellow: { accent: "#ffbd19", color: "#8b5b00" },
  green: { accent: "#167852", color: "#167852" },
  purple: { accent: "#6652b6", color: "#6652b6" }
};

function metric(label, value, caption, palette) {
  return { label, value, caption, ...COLORS[palette] };
}

function openParking(store) {
  const used = store.data.visitors
    .filter((item) => item.parking)
    .reduce((total, item) => total + Math.max(1, Number(item.cars || 1)), 0);
  return Math.max(0, 20 - used);
}

function approvalSuccessMessage(reservation, stepId) {
  const routeCompleted = reservation.requiresPayment && (reservation.approvalSteps || [])
    .every((step) => step.id === stepId || ["Approved", "Skipped"].includes(step.status));
  if (routeCompleted) return `Approval recorded. Payment verification is now routed to ${reservation.office}, the resource-owning office.`;
  return "Approval recorded and route advanced.";
}

function reservationTime(reservation) {
  return new Date(`${reservation.date}T${reservation.start || "00:00"}`).getTime();
}

function reservationEndTime(reservation) {
  return new Date(`${reservation.date}T${reservation.end || reservation.start || "00:00"}`).getTime();
}

function RequesterDashboard({ store, onNavigate, onAction, onReserve }) {
  const mine = store.myReservations();
  const active = mine.filter((item) => !["Rejected", "Cancelled", "Confirmed", "Completed", "Expired", "No Show"].includes(item.status));
  const overdue = active.filter((item) => store.isReservationOverdue(item));
  const outgoing = mine
    .filter((item) => !["Rejected", "Cancelled", "Completed", "Expired", "No Show"].includes(item.status))
    .filter((item) => reservationEndTime(item) >= Date.now())
    .sort((left, right) => reservationTime(left) - reservationTime(right));
  const requesterStatus = [
    { label: "Pending", value: active.length, color: COLORS.blue.color },
    { label: "Payment Required", value: mine.filter((item) => item.status === "For Payment").length, color: COLORS.yellow.color },
    { label: "Approved", value: mine.filter((item) => item.status === "Confirmed").length, color: COLORS.green.color },
    { label: "Completed", value: mine.filter((item) => item.status === "Completed").length, color: COLORS.yellow.color },
    { label: "Rejected", value: mine.filter((item) => item.status === "Rejected").length, color: "#b94444" },
    { label: "Cancelled", value: mine.filter((item) => item.status === "Cancelled").length, color: "#6f7481" }
  ];
  return (
    <>
      <div className="hero requester-hero">
        <span className="eyebrow">Requester Workspace</span>
        <h2>Request a room, vehicle, or equipment without guessing the process.</h2>
        <p>Start with available resources, submit the purpose and schedule, then follow the approval route until confirmation.</p>
        <div className="split-actions hero-action">
          <button className="primary-button" onClick={() => onNavigate("resources")} type="button">Browse Resources</button>
          <button className="secondary-button" onClick={() => onNavigate("myRequests")} type="button">Track My Requests</button>
        </div>
      </div>
      <div className="requester-steps section-gap">
        <article className="card"><strong>1</strong><span>Choose an available resource</span></article>
        <article className="card"><strong>2</strong><span>Submit schedule and purpose</span></article>
        <article className="card"><strong>3</strong><span>Track approvals and payment</span></article>
      </div>
      <article className="card section-gap">
        <CardHeader
          title="Outgoing reservations"
          subtitle="Upcoming submitted schedules that have not passed yet"
          action={<button className="secondary-button" onClick={() => onNavigate("myRequests")} type="button">View All</button>}
        />
        <ReservationRows
          store={store}
          items={outgoing.slice(0, 3)}
          onUpload={(id, file) => onAction(() => store.uploadReceipt(id, file), "Receipt uploaded for verification.")}
          onDocumentUpload={(id, file) => onAction(() => store.uploadSupportingDocument(id, file), "Supporting document uploaded.")}
        />
      </article>
      <div className="grid two-col section-gap">
        <article className="card">
          <CardHeader
            title="Requests needing attention"
            subtitle={overdue.length ? `${overdue.length} passed schedule needs office follow-up` : "Active requests, payments, and reviews"}
            action={<button className="secondary-button" onClick={() => onNavigate("myRequests")} type="button">View All</button>}
          />
          <ReservationRows
            store={store}
            items={active.slice(0, 4)}
            onUpload={(id, file) => onAction(() => store.uploadReceipt(id, file), "Receipt uploaded for verification.")}
            onDocumentUpload={(id, file) => onAction(() => store.uploadSupportingDocument(id, file), "Supporting document uploaded.")}
          />
        </article>
        <article className="card"><CardHeader title="Quick availability" subtitle="Available right now — tap to request" /><ResourceMiniRows items={store.data.resources.filter((item) => item.status === "Available").slice(0, 5)} onSelect={(item) => onReserve(item.id)} /></article>
      </div>
      <div className="section-gap">
        <StatusTiles
          title="Request Summary"
          subtitle="Lifetime totals across every reservation you have submitted"
          items={requesterStatus}
        />
      </div>
    </>
  );
}

function AlertStrip({ alerts }) {
  if (!alerts.length) {
    return (
      <div className="alert-strip clear">
        <CheckCircle2 aria-hidden="true" size={18} />
        <span>Nothing is waiting on your office right now. No overdue reviews, stale requests, or receipts to verify.</span>
      </div>
    );
  }
  return (
    <div className="alert-strip">
      {alerts.map((alert) => (
        <button className={`alert-card ${alert.tone}`} onClick={alert.onOpen} type="button" key={alert.label}>
          <strong>{alert.value}</strong>
          <span>{alert.label}</span>
          <small>{alert.hint}</small>
        </button>
      ))}
    </div>
  );
}

const PENDING_STATUSES = ["Under Owner Review", "Under Additional Review", "For Payment"];
const APPROVED_STATUSES = ["Approved", "Confirmed", "In Use"];
const RESOURCE_AVAILABILITY_STATUSES = ["Available", "Reserved", "In Use", "Under Maintenance"];

function OfficeAdminDashboard({ store, onAction, onNavigate }) {
  const reservations = store.officeReservations;
  const countBy = (statuses) => reservations.filter((item) => statuses.includes(item.status)).length;
  const alerts = [
    {
      label: "Overdue reviews",
      value: store.overdueReservations.length,
      hint: "Past schedule, no decision",
      tone: "danger",
      view: "approvalQueue"
    },
    {
      label: "Waiting over 24h",
      value: reservations.filter((item) => item.reviewReminderSentAt).length,
      hint: "Reminder already sent",
      tone: "warning",
      view: "approvalQueue"
    },
    {
      label: "Receipts to verify",
      value: store.officePayments.filter((item) => item.status === "Pending Verification").length,
      hint: "Uploaded, not checked",
      tone: "info",
      view: "payments"
    }
  ].filter((alert) => alert.value > 0).map((alert) => ({ ...alert, onOpen: () => onNavigate(alert.view) }));
  const statusItems = ["Under Owner Review", "Under Additional Review", "For Payment", "Approved", "Confirmed", "In Use", "Completed", "Rejected", "Cancelled", "Expired", "No Show"].map((status) => ({
    label: status,
    value: reservations.filter((item) => item.status === status).length
  }));
  const availabilityItems = RESOURCE_AVAILABILITY_STATUSES.map((status) => ({
    label: status,
    value: store.officeResources.filter((item) => item.status === status).length
  }));
  const mostRequested = store.officeResources
    .map((resource) => ({
      label: resource.name,
      value: reservations.filter((item) => item.resourceId === resource.id).length
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
  const recentRequests = [...reservations]
    .sort((left, right) => reservationTime(right) - reservationTime(left))
    .slice(0, 8);
  return (
    <>
      <AlertStrip alerts={alerts} />
      <Metrics items={[
        metric("Total Requests", reservations.length, "Submitted to your office", "blue"),
        metric("Pending", countBy(PENDING_STATUSES), "Awaiting an office decision", "yellow"),
        metric("Approved", countBy(APPROVED_STATUSES), "Confirmed, in use, or live", "green"),
        metric("Completed", countBy(["Completed"]), "Finished reservations", "purple")
      ]} />
      <div className="grid two-col section-gap">
        <ChartSummary title="Request Status Overview" subtitle="Requests by current status" items={statusItems} />
        <ChartSummary title="Resource Availability" subtitle="Resources by current status" items={availabilityItems} />
      </div>
      <div className="section-gap">
        <ChartSummary title="Most Requested Resources" subtitle="Top resources by request volume" items={mostRequested} />
      </div>
      <div className="section-gap">
        <article className="card table-wrap">
          <CardHeader title="Recent Requests" subtitle="Latest reservations for your office" />
          {recentRequests.length ? (
            <table>
              <thead><tr><th>Resource</th><th>Requester</th><th>Date</th><th>Time</th><th>Status</th></tr></thead>
              <tbody>
                {recentRequests.map((item) => (
                  <tr key={item.id}>
                    <td>{item.resourceName}</td>
                    <td>{item.requester}</td>
                    <td>{formatDate(item.date)}</td>
                    <td>{item.start}-{item.end}</td>
                    <td><Badge status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState>No requests have been submitted for this office yet.</EmptyState>}
        </article>
      </div>
      <div className="section-gap">
        <article className="card">
          <CardHeader title="Approval queue" subtitle={`${store.officeScope} requests assigned to your office`} />
          <ApprovalRows store={store}
            items={store.actionableReservations}
            office={store.officeScope}
            onApprove={(id, stepId, reservation) => onAction(() => store.approveReservation(id, stepId), approvalSuccessMessage(reservation, stepId))}
            onReject={(id, stepId, reason) => onAction(() => store.rejectReservation(id, stepId, reason), "Reservation rejected.")}
            onAction={onAction}
          />
        </article>
      </div>
    </>
  );
}

function SuperAdminDashboard({ store, onNavigate }) {
  const activeResources = store.data.resources.filter((item) => item.status !== "Archived");
  const activeOffices = store.data.offices.filter((item) => item.status === "Active");
  const resourceTypes = ["Equipment", "Vehicle", "Visitor Service"].map((type) => ({
    label: type,
    value: activeResources.filter((item) => item.type === type).length
  }));
  const approvalLoad = activeOffices.map((office) => ({
    label: office.name,
    value: store.data.reservations.filter((item) => item.approvalSteps?.some((step) => step.office === office.name && step.status === "Pending")).length
  }));
  return (
    <>
      <Metrics items={[
        metric("Total Resources", activeResources.length, "Across all offices", "blue"),
        metric("In Review", store.data.reservations.filter((item) => ["Under Owner Review", "Under Additional Review"].includes(item.status)).length, "System-wide", "yellow"),
        metric("Active Users", store.data.people.filter((item) => item.status === "Active").length, "Role-based accounts", "green"),
        metric("Offices", activeOffices.length, "Configured units", "purple")
      ]} />
      <div className="grid two-col section-gap">
        <article className="card"><CardHeader title="Office coverage" subtitle="Resource ownership summary" /><OfficeRows store={store} onNavigate={onNavigate} /></article>
        <article className="card"><CardHeader title="Recent activity" subtitle="System actions" /><ActivityRows store={store} limit={5} /></article>
      </div>
      <div className="grid two-col section-gap">
        <ChartSummary title="Resources by type" items={resourceTypes} />
        <ChartSummary title="Pending approvals by office" items={approvalLoad} />
      </div>
      <div className="section-gap">
        <ChartSummary title="Reservation decisions" items={[
          { label: "Confirmed", value: store.data.reservations.filter((item) => item.status === "Confirmed").length },
          { label: "Completed", value: store.data.reservations.filter((item) => item.status === "Completed").length },
          { label: "Rejected", value: store.data.reservations.filter((item) => item.status === "Rejected").length },
          { label: "Expired", value: store.data.reservations.filter((item) => item.status === "Expired").length },
          { label: "No Show", value: store.data.reservations.filter((item) => item.status === "No Show").length },
          { label: "For Payment", value: store.data.reservations.filter((item) => item.status === "For Payment").length },
          { label: "In Review", value: store.data.reservations.filter((item) => ["Under Owner Review", "Under Additional Review"].includes(item.status)).length }
        ]} />
      </div>
    </>
  );
}

function OsgAdminDashboard({ store, onNavigate, onAction }) {
  const visitorStatus = ["Pending", "Approved", "Rejected", "Arrived"].map((status) => ({
    label: status,
    value: store.data.visitors.filter((item) => item.status === status).length
  }));
  return (
    <>
      <Metrics items={[
        metric("Pending Visitor Requests", store.data.visitors.filter((item) => item.status === "Pending").length, "Needs OSG review", "yellow"),
        metric("Event Reviews", store.actionableApprovalCount, "Conditional OSG approvals", "blue"),
        metric("Arrived", store.data.visitors.filter((item) => item.status === "Arrived").length, "Checked in", "green"),
        metric("Open Parking", openParking(store), "Visitor bays", "purple")
      ]} />
      <div className="grid two-col section-gap">
        <article className="card">
          <CardHeader title="Priority visitor queue" subtitle="Requests awaiting OSG action" />
          <VisitorRows
            items={store.data.visitors}
            onApprove={(id) => onAction(() => store.approveVisitor(id, true), "Visitor request approved.")}
            onDecline={(id, reason) => onAction(() => store.approveVisitor(id, false, reason), "Visitor request declined.")}
          />
        </article>
        <article className="card">
          <CardHeader title="Arrival monitor" subtitle="Today at Main Gate" action={<button className="secondary-button" onClick={() => onNavigate("arrivals")} type="button">Open</button>} />
          <ArrivalRows items={store.data.visitors} onCheckIn={(id) => onAction(() => store.checkInVisitor(id), "Visitor arrival recorded.")} />
        </article>
      </div>
      <div className="section-gap"><ChartSummary title="Visitor requests by status" items={visitorStatus} /></div>
    </>
  );
}


export default function DashboardView(props) {
  const role = props.store.session.activeRole;
  if (role === "officeAdmin") return <OfficeAdminDashboard {...props} />;
  if (role === "superAdmin") return <SuperAdminDashboard {...props} />;
  if (role === "osgAdmin") return <OsgAdminDashboard {...props} />;
  return <RequesterDashboard {...props} />;
}
