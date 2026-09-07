import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ApprovalTrail, Badge, CardHeader, ConfirmModal, DetailGrid, DetailModal, EmptyState, ReceiptPreview, ReservationRows } from "../components/Common.jsx";
import { compareDateTime, displayTimestamp, downloadCsv, formatDate, sortBy, todayIso, tomorrowIso } from "../utils.js";
import { buildApprovalSteps, pendingApprovalSteps } from "../workflows.js";
export { ResourcesView } from "./reservations/ResourcesView.jsx";

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function paymentRoutingText(reservation, office) {
  if (!reservation.requiresPayment) return "No payment verification required";
  if (reservation.office === office) return `${reservation.office} verifies payment after approvals`;
  return `${reservation.office} verifies payment as the resource-owning office`;
}

function approvalSuccessMessage(reservation, stepId) {
  const routeCompleted = reservation.requiresPayment && (reservation.approvalSteps || [])
    .every((step) => step.id === stepId || ["Approved", "Skipped"].includes(step.status));
  if (routeCompleted) return `Approval recorded. Payment verification is now routed to ${reservation.office}, the resource-owning office.`;
  return "Approval recorded and route advanced.";
}

export function NewReservationView({ store, selectedResourceId, onAction, onNavigate }) {
  const available = store.data.resources.filter(
    (item) => item.status === "Available" && ["Equipment", "Facility", "Vehicle"].includes(item.type)
  );
  const [resourceId, setResourceId] = useState(selectedResourceId || available[0]?.id || "");
  const [slot, setSlot] = useState({ date: tomorrowIso(), start: "08:00", end: "09:00", quantity: "1" });
  const requirementOptions = store.requirementOptions;
  const requirementKey = requirementOptions.map((option) => option.id).join("|");
  const [requirements, setRequirements] = useState(() => Object.fromEntries(requirementOptions.map((option) => [option.id, false])));
  const selected = available.find((item) => item.id === resourceId) || available[0];
  const template = store.data.approvalTemplates.find((item) => item.id === selected?.workflowTemplateId && item.status === "Active")
    || store.data.approvalTemplates.find((item) => item.id === "WF-BASIC");
  const previewSteps = selected ? buildApprovalSteps(template, selected, requirements, "PREVIEW") : [];
  const localAvailability = store.resourceAvailability(resourceId, slot.date, slot.start, slot.end);
  const [remoteAvailability, setRemoteAvailability] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const availability = remoteAvailability || localAvailability;
  const slotOptions = availability.slots?.length ? availability.slots : store.reservationSlotOptions(resourceId, slot.date, slot.start, slot.end);
  const alternatives = availability.alternatives || [];
  const upcoming = resourceId ? store.upcomingReservations(resourceId, 5) : [];

  useEffect(() => {
    setRequirements((current) => ({
      ...Object.fromEntries(requirementOptions.map((option) => [option.id, false])),
      ...current
    }));
  }, [requirementKey]);

  function updateSlot(field, value) {
    setSlot((current) => ({ ...current, [field]: value }));
  }

  function selectSlot(option) {
    setSlot((current) => ({ ...current, date: option.date, start: option.start, end: option.end }));
  }

  useEffect(() => {
    let active = true;
    setRemoteAvailability(null);
    if (!resourceId || !slot.date || !slot.start || !slot.end) return () => { active = false; };
    setCheckingAvailability(true);
    store.fetchResourceAvailability(resourceId, slot.date, slot.start, slot.end)
      .then((result) => {
        if (active) setRemoteAvailability(result);
      })
      .catch((error) => {
        if (active) {
          setRemoteAvailability({ ...localAvailability, message: error.message || localAvailability.message });
        }
      })
      .finally(() => {
        if (active) setCheckingAvailability(false);
      });
    return () => { active = false; };
  }, [resourceId, slot.date, slot.start, slot.end]);

  async function submit(event) {
    event.preventDefault();
    const saved = await onAction(() => store.submitReservation(formValues(event.currentTarget)), "Reservation request submitted.");
    if (saved) onNavigate("myRequests");
  }

  return (
    <div className="grid two-col">
      <form className="card form-card" onSubmit={submit}>
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="resourceId">Resource</label>
            <select id="resourceId" name="resourceId" className="select" value={resourceId} onChange={(event) => setResourceId(event.target.value)} required>
              {available.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.type}{item.requiresPayment ? ` · PHP ${item.fee}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field"><label htmlFor="date">Date</label><input id="date" name="date" className="input" type="date" min={tomorrowIso()} value={slot.date} onChange={(event) => updateSlot("date", event.target.value)} required /></div>
          <div className="field"><label htmlFor="start">Start time</label><input id="start" name="start" className="input" type="time" value={slot.start} onChange={(event) => updateSlot("start", event.target.value)} required /></div>
          <div className="field"><label htmlFor="end">End time</label><input id="end" name="end" className="input" type="time" value={slot.end} onChange={(event) => updateSlot("end", event.target.value)} required /></div>
          <div className="field"><label htmlFor="quantity">Quantity / attendees</label><input id="quantity" name="quantity" className="input" type="number" min="1" max={selected?.capacity || undefined} value={slot.quantity} onChange={(event) => updateSlot("quantity", event.target.value)} /></div>
          <fieldset className="field span-2 requirement-fields">
            <legend>Additional requirements</legend>
            {requirementOptions.map((option) => (
              <label className="check-field" key={option.id} title={option.help}>
                <input
                  checked={Boolean(requirements[option.id])}
                  name={option.id}
                  onChange={(event) => setRequirements((current) => ({ ...current, [option.id]: event.target.checked }))}
                  type="checkbox"
                />
                <span><strong>{option.label}</strong><small>{option.help}</small></span>
              </label>
            ))}
          </fieldset>
          <div className="field span-2"><label htmlFor="purpose">Purpose</label><textarea id="purpose" name="purpose" className="textarea" required placeholder="Describe the activity, class, event, or office purpose." /></div>
        </div>
        <div className="split-actions form-actions"><button className="primary-button" type="submit" disabled={!available.length || availability.status !== "available"}>Submit Request</button></div>
      </form>
      <aside className="stack">
        <section className="card">
          <CardHeader title="Live availability" subtitle={selected ? `${selected.name} · capacity ${selected.capacity}` : "Select a resource"} />
          <div className={`availability-panel availability-${availability.status}`}>
            <Badge status={availability.status === "available" ? "Available" : availability.status === "conflict" ? "Unavailable" : "Pending"}>
              {availability.status}
            </Badge>
            <strong>{availability.message}</strong>
            {checkingAvailability && <p>Checking latest availability...</p>}
            <p>Earliest allowed date: {formatDate(tomorrowIso())}</p>
            {!!availability.conflicts.length && availability.conflicts.map((item) => (
              <p key={item.id}>{formatDate(item.date)} {item.start}-{item.end} · {item.status}</p>
            ))}
          </div>
          <div className="slot-schedule">
            <h3>{formatDate(slot.date)} time slots</h3>
            <div className="slot-grid">
              {slotOptions.map((option) => {
                const selectedSlot = option.date === slot.date && option.start === slot.start && option.end === slot.end;
                return (
                  <button
                    className={`slot-option slot-${option.status} ${selectedSlot ? "selected" : ""}`}
                    disabled={option.status !== "available"}
                    key={`${option.date}-${option.start}-${option.end}`}
                    onClick={() => selectSlot(option)}
                    type="button"
                  >
                    <span>{option.start}-{option.end}</span>
                    <small>{option.status}</small>
                  </button>
                );
              })}
            </div>
          </div>
          {availability.status !== "available" && (
            <div className="slot-schedule">
              <h3>Suggested alternatives</h3>
              {alternatives.length ? (
                <div className="slot-grid">
                  {alternatives.map((option) => (
                    <button
                      className="slot-option slot-available"
                      key={`alt-${option.date}-${option.start}-${option.end}`}
                      onClick={() => selectSlot(option)}
                      type="button"
                    >
                      <span>{formatDate(option.date)}</span>
                      <small>{option.start}-{option.end}</small>
                    </button>
                  ))}
                </div>
              ) : <p className="slot-note">No alternatives are available in the next listed booking window.</p>}
            </div>
          )}
          <div className="mini-schedule">
            <h3>Upcoming bookings</h3>
            {upcoming.length ? upcoming.map((item) => (
              <p key={item.id}>{formatDate(item.date)} {item.start}-{item.end} · {item.resourceName} · {item.status}</p>
            )) : <p>No upcoming bookings for this resource.</p>}
          </div>
        </section>
        <section className="card">
          <CardHeader title={template?.name || "Approval route"} subtitle="Generated from the selected resource and requirements." />
          <div className="timeline">
            {previewSteps.map((step) => <div className="timeline-item" key={step.id}><strong>{step.name}</strong><small>{step.office} · Sequence {step.sequence}</small></div>)}
            {selected?.requiresPayment && <div className="timeline-item"><strong>Payment verification</strong><small>{selected.office} · after operational approvals</small></div>}
          </div>
        </section>
      </aside>
    </div>
  );
}

export function ReservationsView({ store, onAction }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const upload = (id, file) => onAction(() => store.uploadReceipt(id, file), "Receipt uploaded for verification.");
  const uploadDocument = (id, file) => onAction(() => store.uploadSupportingDocument(id, file), "Supporting document uploaded.");
  const cancel = (id, reason) => onAction(() => store.cancelReservation(id, reason), "Reservation cancelled.");
  const reschedule = (id, slot) => onAction(() => store.rescheduleReservation(id, slot), "Reservation reschedule submitted for approval.");
  const items = store.myReservations().filter((item) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = `${item.resourceName} ${item.office} ${item.purpose} ${item.status}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    return matchesQuery && matchesStatus;
  });
  const statusOptions = ["All", ...new Set(store.myReservations().map((item) => item.status))];

  return (
    <article className="card">
      <CardHeader
        title="Reservation requests"
        subtitle="Status, payment, and approval tracking"
        action={<button className="secondary-button" onClick={() => downloadCsv("reservata-my-requests.csv", items.map((item) => ({
          id: item.id,
          resource: item.resourceName,
          office: item.office,
          date: item.date,
          time: `${item.start}-${item.end}`,
          status: item.status,
          purpose: item.purpose
        })))} disabled={!items.length} type="button">Export CSV</button>}
      />
      {!!store.overdueReservations.length && (
        <OverdueNotice
          count={store.overdueReservations.length}
          message="Some reservation schedules already passed without a final confirmation or rejection. Follow up with the assigned office before marking the request complete."
        />
      )}
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests" aria-label="Search reservation requests" />
        <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter request status">
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <ReservationRows store={store} items={items} onUpload={upload} onDocumentUpload={uploadDocument} onCancel={cancel} onReschedule={reschedule} />
    </article>
  );
}

export function ApprovalRows({ items, office, onApprove, onReject }) {
  const [selected, setSelected] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [rejection, setRejection] = useState(null);
  const tasks = items.flatMap((reservation) => pendingApprovalSteps(reservation, office).map((step) => ({ reservation, step })));
  if (!tasks.length) return <EmptyState>No approval steps are assigned to this office. Completed and forwarded routes remain visible in the tracker below.</EmptyState>;
  return (
    <>
      {tasks.map(({ reservation: item, step }) => (
        <div className="list-item approval-task" key={`${item.id}-${step.id}`}>
          <div>
            <Badge status={item.status} />
            {item.isOverdue && <Badge status="Overdue Review" className="overdue-badge">Overdue</Badge>}
            <h3 className="item-title">{item.resourceName}</h3>
            <p>{item.requester} · {formatDate(item.date)} · {item.purpose}</p>
            <p className="approval-assignment"><strong>{step.name}</strong> · {step.office}</p>
            {item.requiresPayment && item.office !== office && (
              <p className="approval-route-note">Payment verification belongs to {item.office}, because it owns {item.resourceName}.</p>
            )}
            <ApprovalTrail reservation={item} />
          </div>
          {onApprove && (
            <div className="split-actions">
              <button className="secondary-button" onClick={() => setSelected(item)} type="button">View Details</button>
              <button
                className="success-button"
                onClick={() => setConfirmation({
                  title: "Approve and forward?",
                  message: "This records your approval and moves the request to the next step in the route.",
                  tone: "success",
                  confirmLabel: "Approve Request",
                  details: [
                    ["Request", item.resourceName],
                    ["Requester", item.requester],
                    ["Current step", step.name],
                    ["Next status", item.requiresPayment ? "Next office or payment stage" : "Next office or confirmation"],
                    ["Payment route", paymentRoutingText(item, office)]
                  ],
                  action: () => onApprove(item.id, step.id, item)
                })}
                type="button"
              >
                Approve &amp; Forward
              </button>
              <button
                className="secondary-button"
                onClick={() => setRejection({ item, step })}
                type="button"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
      {confirmation && (
        <ConfirmModal
          {...confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            const action = confirmation.action;
            setConfirmation(null);
            await action();
          }}
        />
      )}
      {selected && (
        <DetailModal title={selected.resourceName} subtitle={`${selected.id} · ${selected.status}`} onClose={() => setSelected(null)}>
          <DetailGrid items={[
            ["Requester", selected.requester],
            ["Office", selected.office],
            ["Schedule", `${formatDate(selected.date)} ${selected.start}-${selected.end}`],
            ["Decision reason", selected.rejectionReason || "None"],
            ["Purpose", selected.purpose],
            ["Payment", paymentRoutingText(selected, office)]
          ]} />
          <ApprovalTrail reservation={selected} />
        </DetailModal>
      )}
      {rejection && (
        <ReasonModal
          title="Reject this request?"
          message="This stops the remaining approval route and notifies the requester."
          confirmLabel="Reject Request"
          details={[
            ["Request", rejection.item.resourceName],
            ["Requester", rejection.item.requester],
            ["Current step", rejection.step.name]
          ]}
          onCancel={() => setRejection(null)}
          onConfirm={async (reason) => {
            const current = rejection;
            setRejection(null);
            await onReject(current.item.id, current.step.id, reason);
          }}
        />
      )}
    </>
  );
}

function ReasonModal({ title, message, confirmLabel, details, onConfirm, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-heading">
          <div className="confirm-icon confirm-danger" aria-hidden="true"><AlertTriangle size={22} /></div>
          <CardHeader title={title} subtitle={message} />
        </div>
        <div className="confirm-details">
          {details.map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
        <label className="field reason-field">
          <span>Reason / comment</span>
          <textarea className="textarea" value={reason} onChange={(event) => setReason(event.target.value)} minLength="8" required />
        </label>
        <div className="confirm-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="danger-button" onClick={() => onConfirm(reason)} disabled={reason.trim().length < 8} type="button">{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function ApprovalRouteRows({ items }) {
  const [selected, setSelected] = useState(null);
  const routed = items.filter((item) => item.approvalSteps?.length);
  if (!routed.length) return <EmptyState>No routed reservation requests yet.</EmptyState>;

  return (
    <>
      {routed.map((item) => (
        <div className="list-item approval-route-item" key={item.id}>
          <div>
            <Badge status={item.status} />
            {item.isOverdue && <Badge status="Overdue Review" className="overdue-badge">Overdue</Badge>}
            <h3 className="item-title">{item.resourceName}</h3>
            <p>{item.requester} · {formatDate(item.date)} · {item.purpose}</p>
            <ApprovalTrail reservation={item} />
          </div>
          <div className="split-actions"><button className="secondary-button" onClick={() => setSelected(item)} type="button">View Details</button></div>
        </div>
      ))}
      {selected && (
        <DetailModal title={selected.resourceName} subtitle={`${selected.id} · ${selected.status}`} onClose={() => setSelected(null)}>
          <DetailGrid items={[
            ["Requester", selected.requester],
            ["Office", selected.office],
            ["Schedule", `${formatDate(selected.date)} ${selected.start}-${selected.end}`],
            ["Purpose", selected.purpose],
            ["Payment", paymentRoutingText(selected, selected.office)]
          ]} />
          <ApprovalTrail reservation={selected} />
        </DetailModal>
      )}
    </>
  );
}

export function ApprovalsView({ store, onAction }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const filtered = store.officeReservations.map((item) => ({ ...item, isOverdue: store.isReservationOverdue(item) })).filter((item) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = `${item.resourceName} ${item.requester} ${item.purpose} ${item.status}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    return matchesQuery && matchesStatus;
  });
  const statusOptions = ["All", ...new Set(store.officeReservations.map((item) => item.status))];
  return (
    <div className="stack">
      <article className="card">
        <CardHeader
          title="Requests awaiting office action"
          subtitle="Decisions automatically activate the next required office or payment stage."
          action={<button className="secondary-button" onClick={() => downloadCsv("reservata-approval-routes.csv", filtered.map((item) => ({
            id: item.id,
            resource: item.resourceName,
            requester: item.requester,
            office: item.office,
            status: item.status,
            purpose: item.purpose
          })))} disabled={!filtered.length} type="button">Export CSV</button>}
        />
        {!!store.overdueReservations.length && (
          <OverdueNotice
            count={store.overdueReservations.length}
            message="These requests are past their scheduled end time and still unresolved. Review, approve, or reject them with a comment."
          />
        )}
        <div className="toolbar list-toolbar">
          <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search approval routes" aria-label="Search approval routes" />
          <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter approval status">
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <ApprovalRows
          items={store.actionableReservations.map((item) => ({ ...item, isOverdue: store.isReservationOverdue(item) })).filter((item) => filtered.some((route) => route.id === item.id))}
          office={store.officeScope}
          onApprove={(id, stepId, reservation) => onAction(() => store.approveReservation(id, stepId), approvalSuccessMessage(reservation, stepId))}
          onReject={(id, stepId, reason) => onAction(() => store.rejectReservation(id, stepId, reason), "Reservation rejected.")}
        />
      </article>
      <article className="card">
        <CardHeader title="Approval route tracker" subtitle="Full approval routes stay visible after your decision is recorded." />
        <ApprovalRouteRows items={filtered} />
      </article>
    </div>
  );
}

export function PaymentsView({ store, onAction }) {
  const [confirmation, setConfirmation] = useState(null);
  const [rejection, setRejection] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("reservationId");
  const paymentReservation = (payment) => store.data.reservations.find((item) => item.id === payment.reservationId);
  const items = sortBy(store.officePayments.filter((item) => {
    const reservation = paymentReservation(item);
    const normalized = query.trim().toLowerCase();
    const matchesQuery = `${item.id} ${item.requester} ${item.receipt} ${item.status} ${reservation?.resourceName || ""}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    return matchesQuery && matchesStatus;
  }), sort);
  const statusOptions = ["All", ...new Set(store.officePayments.map((item) => item.status))];
  return (
    <article className="card">
      <CardHeader
        title="Receipt verification"
        subtitle={`Only payments assigned to ${store.officeScope} appear here. Supporting approval offices do not verify another office's payment.`}
        action={<button className="secondary-button" onClick={() => downloadCsv("reservata-payments.csv", items.map((item) => ({
          id: item.id,
          reservation: item.reservationId,
          requester: item.requester,
          amount: item.amount,
          receipt: item.receipt,
          status: item.status,
          reason: item.rejectionReason || ""
        })))} disabled={!items.length} type="button">Export CSV</button>}
      />
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payments" aria-label="Search payments" />
        <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter payment status">
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort payments">
          <option value="reservationId">Sort by reservation</option>
          <option value="requester">Sort by requester</option>
          <option value="status">Sort by status</option>
        </select>
      </div>
      {items.map((item) => (
        <div className="list-item" key={item.id}>
          <div>
            <Badge status={item.status === "Pending Verification" ? "For Payment" : item.status}>{item.status}</Badge>
            <h3 className="item-title">{item.id} · PHP {item.amount}</h3>
            <p>{item.requester} · {item.receipt} · Payment office: {item.office}</p>
            {item.rejectionReason && <p className="decision-note">Reason: {item.rejectionReason}</p>}
            <ReceiptPreview payment={item} />
          </div>
          {item.status === "Pending Verification" && (
            <div className="split-actions">
              <button
                className="success-button"
                onClick={() => {
                  const reservation = paymentReservation(item);
                  setConfirmation({
                    title: "Verify this payment?",
                    message: "This confirms the receipt and finalizes the reservation.",
                    tone: "success",
                    confirmLabel: "Verify Payment",
                    details: [
                      ["Payment", item.id],
                      ["Amount", `PHP ${item.amount}`],
                      ["Receipt", item.receipt],
                      ["Requester", item.requester],
                      ["Reservation", reservation?.resourceName || item.reservationId],
                      ["Payment office", item.office]
                    ],
                    action: () => onAction(() => store.verifyPayment(item.id, true), "Payment verified and reservation confirmed.")
                  });
                }}
                type="button"
              >
                Verify
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  const reservation = paymentReservation(item);
                  setRejection({ item, reservation });
                }}
                type="button"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
      {!items.length && <EmptyState>No payment records match the current filters.</EmptyState>}
      {confirmation && (
        <ConfirmModal
          {...confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            const action = confirmation.action;
            setConfirmation(null);
            await action();
          }}
        />
      )}
      {rejection && (
        <ReasonModal
          title="Reject this receipt?"
          message="This rejects the payment proof and notifies the requester with your comment."
          confirmLabel="Reject Receipt"
          details={[
            ["Payment", rejection.item.id],
            ["Amount", `PHP ${rejection.item.amount}`],
            ["Requester", rejection.item.requester],
            ["Reservation", rejection.reservation?.resourceName || rejection.item.reservationId],
            ["Payment office", rejection.item.office]
          ]}
          onCancel={() => setRejection(null)}
          onConfirm={async (reason) => {
            const current = rejection;
            setRejection(null);
            await onAction(() => store.verifyPayment(current.item.id, false, reason), "Payment receipt rejected.");
          }}
        />
      )}
    </article>
  );
}

function canManageReservationStatus(store, reservation) {
  if (store.session.activeRole === "superAdmin") return true;
  return store.session.activeRole === "officeAdmin" && reservation.office === store.officeScope;
}

function reservationStarted(reservation) {
  return new Date(`${reservation.date}T${reservation.start || "00:00"}`).getTime() <= Date.now();
}

function reservationEnded(reservation) {
  return new Date(`${reservation.date}T${reservation.end || reservation.start || "00:00"}`).getTime() <= Date.now();
}

export function CalendarView({ store, onAction }) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [resourceId, setResourceId] = useState("All");
  const [status, setStatus] = useState("All");
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [statusAction, setStatusAction] = useState(null);
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDay + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const events = store.data.reservations
    .filter((item) => item.date?.startsWith(month))
    .filter((item) => resourceId === "All" || item.resourceId === resourceId)
    .filter((item) => status === "All" || item.status === status)
    .map((item) => ({ ...item, isOverdue: store.isReservationOverdue(item) }))
    .sort((left, right) => compareDateTime(left.date, left.start, right.date, right.start));
  const dayEvents = events.filter((item) => item.date === selectedDate);
  const statusOptions = ["All", ...new Set(store.data.reservations.map((item) => item.status))];

  return (
    <div className="grid two-col calendar-layout">
      <article className="card">
        <CardHeader title="Reservation calendar" subtitle="Confirmed and in-progress reservations by day" />
        <div className="toolbar list-toolbar">
          <input className="input status-filter" type="month" value={month} onChange={(event) => { setMonth(event.target.value); setSelectedDate(`${event.target.value}-01`); }} aria-label="Calendar month" />
          <select className="select status-filter" value={resourceId} onChange={(event) => setResourceId(event.target.value)} aria-label="Filter calendar resource">
            <option value="All">All resources</option>
            {store.data.resources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter calendar status">
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="calendar">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className="calendar-head" key={day}>{day}</div>)}
          {cells.map((day, index) => {
            if (!day) return <div className="calendar-day muted" key={`blank-${index}`} />;
            const date = `${month}-${String(day).padStart(2, "0")}`;
            const eventsForDay = events.filter((item) => item.date === date);
            return (
              <button className={`calendar-day calendar-button ${date === selectedDate ? "selected" : ""}`} onClick={() => setSelectedDate(date)} type="button" key={date}>
                <strong>{day}</strong>
                {eventsForDay.slice(0, 3).map((event) => <Badge status={event.status} className="event-pill" key={event.id}>{event.resourceName}</Badge>)}
                {eventsForDay.length > 3 && <small>{eventsForDay.length - 3} more</small>}
              </button>
            );
          })}
        </div>
      </article>
      <article className="card">
        <CardHeader
          title={formatDate(selectedDate)}
          subtitle={`${dayEvents.length} reservation${dayEvents.length === 1 ? "" : "s"} scheduled`}
          action={<button className="secondary-button" onClick={() => downloadCsv("reservata-calendar.csv", events.map((item) => ({
            id: item.id,
            resource: item.resourceName,
            requester: item.requester,
            date: item.date,
            time: `${item.start}-${item.end}`,
            status: item.status
          })))} disabled={!events.length} type="button">Export CSV</button>}
        />
        {dayEvents.map((item) => (
          <div className="list-item" key={item.id}>
            <div>
              <Badge status={item.status} />
              {item.isOverdue && <Badge status="Overdue Review" className="overdue-badge">Overdue</Badge>}
              <h3 className="item-title">{item.resourceName}</h3>
              <p>{item.start}-{item.end} · {item.requester} · {item.office}</p>
              <p>{item.purpose}</p>
            </div>
            {canManageReservationStatus(store, item) && onAction && (
              <div className="split-actions">
                {item.status === "Confirmed" && !reservationStarted(item) && (
                  <button className="secondary-button" onClick={() => setStatusAction({ item, status: "Cancelled", label: "Cancel Reservation" })} type="button">Cancel</button>
                )}
                {item.status === "Confirmed" && reservationStarted(item) && !reservationEnded(item) && (
                  <button className="success-button" onClick={() => onAction(() => store.updateReservationLifecycleStatus(item.id, "In Use"), "Reservation marked in use.")} type="button">Start Use</button>
                )}
                {(item.status === "In Use" || (item.status === "Confirmed" && reservationEnded(item))) && (
                  <button className="success-button" onClick={() => onAction(() => store.updateReservationLifecycleStatus(item.id, "Completed"), "Reservation completed.")} type="button">Complete</button>
                )}
                {item.status === "Confirmed" && reservationStarted(item) && (
                  <button className="secondary-button" onClick={() => setStatusAction({ item, status: "No Show", label: "Mark No Show" })} type="button">No Show</button>
                )}
                {!["Rejected", "Cancelled", "Completed", "Expired", "No Show"].includes(item.status) && (
                  <button className="secondary-button" onClick={() => setStatusAction({ item, status: "Expired", label: "Expire Request" })} type="button">Expire</button>
                )}
              </div>
            )}
          </div>
        ))}
        {!dayEvents.length && <EmptyState>No reservations for the selected day.</EmptyState>}
        {statusAction && (
          <ReasonModal
            title={`${statusAction.label}?`}
            message="This updates the reservation lifecycle and notifies the requester."
            confirmLabel={statusAction.label}
            details={[
              ["Request", statusAction.item.resourceName],
              ["Status", statusAction.status],
              ["Requester", statusAction.item.requester]
            ]}
            onCancel={() => setStatusAction(null)}
            onConfirm={async (reason) => {
              const current = statusAction;
              setStatusAction(null);
              await onAction(() => store.updateReservationLifecycleStatus(current.item.id, current.status, reason), `Reservation marked ${current.status}.`);
            }}
          />
        )}
      </article>
    </div>
  );
}

export function NotificationsView({ store, onAction }) {
  const [query, setQuery] = useState("");
  const [readFilter, setReadFilter] = useState("All");
  const [selected, setSelected] = useState(null);
  const items = store.visibleNotifications.filter((item) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = `${item.message} ${item.type || ""}`.toLowerCase().includes(normalized);
    const matchesRead = readFilter === "All" || (readFilter === "Unread" ? item.unread : !item.unread);
    return matchesQuery && matchesRead;
  });
  return (
    <article className="card">
      <CardHeader
        title="Notifications"
        subtitle="Status changes and action reminders"
        action={<button className="secondary-button" onClick={() => onAction(() => store.markNotificationsRead(), "Notifications marked as read.")} disabled={!items.some((item) => item.unread)} type="button">Mark All Read</button>}
      />
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search alerts" aria-label="Search notifications" />
        <select className="select status-filter" value={readFilter} onChange={(event) => setReadFilter(event.target.value)} aria-label="Filter read status">
          <option>All</option>
          <option>Unread</option>
          <option>Read</option>
        </select>
      </div>
      {items.map((item) => (
        <button
          className={`notification-item ${item.unread ? "unread" : ""}`}
          key={item.id}
          onClick={async () => {
            setSelected({ ...item, unread: false });
            await onAction(() => store.markNotificationRead(item.id));
          }}
          type="button"
        >
          <div>
            <Badge status={item.unread ? "Pending" : "Verified"}>{item.unread ? "Unread" : "Read"}</Badge>
            <h3 className="item-title">{item.message}</h3>
            <p>{item.type || "System"}{item.time ? ` · ${displayTimestamp(item.time)}` : ""}</p>
          </div>
        </button>
      ))}
      {!items.length && <EmptyState>No notifications match the current filters.</EmptyState>}
      {selected && (
        <DetailModal className="notification-modal" title={selected.type || "Notification"} subtitle={displayTimestamp(selected.time) || "System alert"} onClose={() => setSelected(null)}>
          <div className="notification-detail">
            <Badge status={selected.unread ? "Pending" : "Verified"}>{selected.unread ? "Unread" : "Read"}</Badge>
            <p>{selected.message}</p>
          </div>
        </DetailModal>
      )}
    </article>
  );
}

function OverdueNotice({ count, message }) {
  return (
    <div className="overdue-notice" role="status">
      <Badge status="Overdue Review">{count} overdue</Badge>
      <p>{message}</p>
    </div>
  );
}
