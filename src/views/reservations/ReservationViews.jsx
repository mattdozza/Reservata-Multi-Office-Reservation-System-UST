import ManagedForm from "../../components/ManagedForm.jsx";
import ResourcePhoto from "../../components/ResourcePhoto.jsx";
import ReservationTimeline from "../../components/ReservationTimeline.jsx";
import { readReservationDraft, reservationDraftKey } from "../../domain/reservations/drafts.js";
import { MONTH_LABELS, monthCells, shiftMonth, WEEKDAY_LABELS } from "../../domain/reservations/requesterCalendar.js";
import { reservationErrors } from "../../domain/reservations/validation.js";
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { ApprovalTrail, Badge, CardHeader, ConfirmModal, DetailGrid, DetailModal, EmptyState, ReceiptPreview, ReservationRows } from "../../components/Common.jsx";
import { VISITOR_CAPABLE_REQUESTER_TYPES } from "../../config.js";
import { compareDateTime, displayTimestamp, downloadCsv, formatDate, sortBy, todayIso, tomorrowIso } from "../../shared/utils.js";
import { buildApprovalSteps, pendingApprovalSteps } from "../../domain/workflows.js";
import { VisitorRows } from "../visitors/VisitorViews.jsx";
export { ResourcesView } from "./ResourcesView.jsx";

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

export function NewReservationView({ store, selectedResourceId, selectedSchedule, onAction, onNavigate }) {
  const draftKey = reservationDraftKey(store.currentUser.email);
  const [restored, setRestored] = useState(() => readReservationDraft(draftKey));
  const [draftChanged, setDraftChanged] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [purpose, setPurpose] = useState(restored?.purpose || "");
  const [showErrors, setShowErrors] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const allowedTypes = store.currentUser.requesterType === "Student" ? ["Equipment"] : ["Equipment", "Vehicle"];
  const available = store.data.resources.filter(
    (item) => allowedTypes.includes(item.type)
  );
  const [resourceId, setResourceId] = useState(selectedResourceId || restored?.resourceId || "");
  const [driverChoice, setDriverChoice] = useState(restored?.driverChoice || "Without Driver");
  const [slot, setSlot] = useState(selectedSchedule ? { ...selectedSchedule, quantity: restored?.slot.quantity || "1" } : restored?.slot || { date: tomorrowIso(), start: "08:00", end: "09:00", quantity: "1" });
  const requirementOptions = store.requirementOptions;
  const requirementKey = requirementOptions.map((option) => option.id).join("|");
  const [requirements, setRequirements] = useState(() => Object.fromEntries(requirementOptions.map((option) => [option.id, Boolean(restored?.requirements?.[option.id])])));
  const selected = available.find((item) => item.id === resourceId);
  const errors = reservationErrors({ ...slot, purpose }, selected);

  useEffect(() => {
    if (!draftChanged) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ resourceId, slot, requirements, purpose, driverChoice }));
      setDraftError("");
    } catch { setDraftError("Draft could not be saved on this device. Keep this page open until you submit."); }
  }, [draftChanged, draftKey, resourceId, slot, requirements, purpose]);

  function discardDraft() {
    if (!window.confirm("Discard this reservation draft?")) return;
    localStorage.removeItem(draftKey);
    setDraftChanged(false); setRestored(null); setPurpose(""); setShowErrors(false);
    setResourceId(selectedResourceId || available[0]?.id || "");
    setSlot({ date: tomorrowIso(), start: "08:00", end: "09:00", quantity: "1" });
    setRequirements(Object.fromEntries(requirementOptions.map((option) => [option.id, false])));
    setDriverChoice("Without Driver");
    setDraftVersion((value) => value + 1);
  }
  const template = store.data.approvalTemplates.find((item) => item.id === selected?.workflowTemplateId && item.status === "Active")
    || store.data.approvalTemplates.find((item) => item.id === "WF-BASIC");
  const hasConditionalSteps = (template?.steps || []).some((step) => step.condition && step.condition !== "always");
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
    setDraftChanged(true);
    setSlot((current) => ({ ...current, date: option.date, start: option.start, end: option.end }));
  }

  useEffect(() => {
    let active = true;
    setRemoteAvailability(null);
    setCheckingAvailability(false);
    if (!resourceId || !slot.date || !slot.start || !slot.end) return () => { active = false; };
    setCheckingAvailability(true);
    store.fetchResourceAvailability(resourceId, slot.date, slot.start, slot.end)
      .then((result) => {
        if (active) setRemoteAvailability(result);
      })
      .catch((error) => {
        if (active) {
          setRemoteAvailability({ ...localAvailability, status: "error", message: error.message || "Availability could not be checked. Try again." });
        }
      })
      .finally(() => {
        if (active) setCheckingAvailability(false);
      });
    return () => { active = false; };
  }, [resourceId, slot.date, slot.start, slot.end]);

  async function submit(event) {
    event.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length || !selected || checkingAvailability) return false;
    const saved = await onAction(() => store.submitReservation(formValues(event.currentTarget)), "Reservation request submitted.");
    if (saved) { localStorage.removeItem(draftKey); setDraftChanged(false); onNavigate("myRequests"); }
    return saved;
  }

  return (
    <div className="grid two-col">
      <ManagedForm className="card form-card" onSubmit={submit} resetKey={draftVersion} onChange={() => setDraftChanged(true)}>
        {draftChanged && <div className="draft-notice"><span>{draftError || "Draft saved on this device. Not submitted."}</span><button type="button" className="secondary-button" onClick={discardDraft}>Discard draft</button></div>}
        {!selected && (draftChanged || restored) && <p className="field-error" role="alert">The saved resource is no longer available. Select another resource.</p>}
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="resourceId">Resource</label>
            <select id="resourceId" name="resourceId" className="select" value={resourceId} onChange={(event) => setResourceId(event.target.value)} required>
              <option value="">Choose resource</option>
              {available.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.type}
                </option>
              ))}
            </select>
          </div>
          <div className="field"><label htmlFor="date">Date</label><input id="date" name="date" className="input" type="date" min={tomorrowIso()} value={slot.date} onChange={(event) => updateSlot("date", event.target.value)} required /></div>
          <div className="field"><label htmlFor="quantity">Quantity</label><input id="quantity" name="quantity" className="input" type="number" min="1" max={selected?.capacity || undefined} value={slot.quantity} onChange={(event) => updateSlot("quantity", event.target.value)} /></div>
          <div className="field"><label htmlFor="start">Start time</label><input id="start" name="start" className="input" type="time" value={slot.start} onChange={(event) => updateSlot("start", event.target.value)} required /></div>
          <div className="field"><label htmlFor="end">End time</label><input id="end" name="end" className="input" type="time" value={slot.end} onChange={(event) => updateSlot("end", event.target.value)} required /></div>
          {selected?.type === "Vehicle" && (
            <div className="field">
              <label htmlFor="driverChoice">Driver</label>
              <select id="driverChoice" name="driverChoice" className="select" value={driverChoice} onChange={(event) => setDriverChoice(event.target.value)}>
                <option>With Driver</option>
                <option>Without Driver</option>
              </select>
            </div>
          )}
          {hasConditionalSteps && (
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
          )}
          <div className="field span-2"><label htmlFor="purpose">Purpose</label><textarea id="purpose" name="purpose" className="textarea" minLength={10} value={purpose} onChange={(event) => setPurpose(event.target.value)} required placeholder="Describe the activity, class, event, or office purpose." />{showErrors && errors.purpose && <small className="field-error">{errors.purpose}</small>}</div>
        </div>
        {showErrors && Object.entries(errors).filter(([field]) => field !== "purpose").map(([field, message]) => <p className="field-error" key={field}><a href={`#${field}`}>{message}</a></p>)}
        {slot.start >= slot.end && <p className="field-error" role="alert">End time must be after start time.</p>}
        <div className="split-actions form-actions"><button className="primary-button" type="submit" disabled={!selected || checkingAvailability || availability.status !== "available"}>{checkingAvailability ? "Checking availability..." : "Submit Request"}</button></div>
      </ManagedForm>
      <aside className="stack">
        <section className="card">
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
        {selected?.requiresPayment && (
          <section className="card">
            <CardHeader title="Payment details" subtitle="Fee information for this resource" />
            <div className="detail-box">
              <p><strong>Amount:</strong> PHP {selected.fee}</p>
              <p><strong>Payment office:</strong> {selected.office}</p>
              <p className="detail-note">After your reservation is approved, you will be instructed to upload a payment receipt for verification.</p>
            </div>
          </section>
        )}
        {selected?.type === "Vehicle" && (
          <section className="card">
            <CardHeader title="Driver information" subtitle="Driver assignment for this vehicle" />
            <div className="detail-box">
              <p><strong>Driver requirement:</strong> {selected.driver}</p>
              {selected.driver === "With Driver" && <p className="detail-note">A driver will be assigned by the office during the approval process.</p>}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

export function ReservationsView({ store, onAction }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [type, setType] = useState("All");
  const upload = (id, file) => onAction(() => store.uploadReceipt(id, file), "Receipt uploaded for verification.");
  const uploadDocument = (id, file) => onAction(() => store.uploadSupportingDocument(id, file), "Supporting document uploaded.");
  const cancel = (id, reason) => onAction(() => store.cancelReservation(id, reason), "Reservation cancelled.");
  const reschedule = (id, slot) => onAction(() => store.rescheduleReservation(id, slot), "Reservation reschedule submitted for approval.");
  const isVisitorCapable = VISITOR_CAPABLE_REQUESTER_TYPES.includes(store.currentUser.requesterType);
  const normalized = query.trim().toLowerCase();

  const reservations = store.myReservations();
  const reservationTypes = [...new Set(reservations.map((item) => item.type))];
  const typeOptions = ["All", ...reservationTypes, ...(isVisitorCapable ? ["Visitor"] : [])];

  const items = type === "Visitor" ? [] : reservations.filter((item) => {
    const matchesQuery = `${item.resourceName} ${item.office} ${item.purpose} ${item.status}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    const matchesType = type === "All" || item.type === type;
    return matchesQuery && matchesStatus && matchesType;
  });

  const myVisitorRequests = isVisitorCapable ? store.data.visitors.filter((item) => item.requester === store.currentUser.name) : [];
  const visitorItems = (type === "All" || type === "Visitor") ? myVisitorRequests.filter((item) => {
    const matchesQuery = `${item.visitor} ${item.organization} ${item.purpose} ${item.status}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    return matchesQuery && matchesStatus;
  }) : [];

  const statusOptions = ["All", ...new Set([...reservations.map((item) => item.status), ...myVisitorRequests.map((item) => item.status)])];

  return (
    <article className="card">
      <CardHeader
        title="My Requests"
        subtitle="Reservations and visitor access requests"
        action={null}
      />
      {!!store.overdueReservations.length && (
        <OverdueNotice
          count={store.overdueReservations.length}
          message="Some reservation schedules already passed without a final confirmation or rejection. Follow up with the assigned office before marking the request complete."
        />
      )}
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests" aria-label="Search requests" />
        {typeOptions.length > 2 && (
          <select className="select status-filter" value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by request type">
            {typeOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        )}
        <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter request status">
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      {items.length > 0 && <ReservationRows store={store} items={items} onUpload={upload} onDocumentUpload={uploadDocument} onCancel={cancel} onReschedule={reschedule} />}
      {visitorItems.length > 0 && <VisitorRows items={visitorItems} />}
      {!items.length && !visitorItems.length && <EmptyState>No matching requests found.</EmptyState>}
    </article>
  );
}

export function ApprovalRows({ store, items, office, onApprove, onReject, onAction }) {
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
            {(() => {
              const resource = store?.data.resources.find((candidate) => candidate.id === item.resourceId);
              if (!resource || resource.type !== "Vehicle" || resource.driver !== "With Driver") return null;
              const assignment = store.reservationDriver(item.id);
              const drivers = store.availableDriversForOffice(item.office);
              return (
                <div className="field driver-assignment">
                  <label htmlFor={`driver-select-${item.id}`}>Assigned driver</label>
                  <select
                    id={`driver-select-${item.id}`}
                    className="select"
                    value={assignment?.driverId || ""}
                    onChange={(event) => {
                      const driverId = event.target.value;
                      if (driverId) onAction(() => store.assignDriver(item.id, driverId), "Driver assigned.");
                      else onAction(() => store.unassignDriver(item.id), "Driver unassigned.");
                    }}
                  >
                    <option value="">No driver assigned</option>
                    {assignment && !drivers.some((driver) => driver.id === assignment.driverId) && (
                      <option value={assignment.driverId}>{assignment.driverName}</option>
                    )}
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>{driver.name}</option>
                    ))}
                  </select>
                </div>
              );
            })()}
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
          {store && <ReservationTimeline store={store} reservation={selected} />}
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

function ApprovalRouteRows({ store, items }) {
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
          <ReservationTimeline reservation={selected} payments={store.data.payments} activity={store.data.activity} />
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
        <ApprovalRows store={store}
          items={store.actionableReservations.map((item) => ({ ...item, isOverdue: store.isReservationOverdue(item) })).filter((item) => filtered.some((route) => route.id === item.id))}
          office={store.officeScope}
          onApprove={(id, stepId, reservation) => onAction(() => store.approveReservation(id, stepId), approvalSuccessMessage(reservation, stepId))}
          onReject={(id, stepId, reason) => onAction(() => store.rejectReservation(id, stepId, reason), "Reservation rejected.")}
          onAction={onAction}
        />
      </article>
      <article className="card">
        <CardHeader title="Approval route tracker" subtitle="Full approval routes stay visible after your decision is recorded." />
        <ApprovalRouteRows store={store} items={filtered} />
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

const ADMIN_CALENDAR_LEGEND = [
  { label: "Confirmed", className: "confirmed" },
  { label: "In Use", className: "in-use" },
  { label: "Completed", className: "completed" },
  { label: "Cancelled", className: "cancelled" },
  { label: "Rejected", className: "rejected" },
  { label: "Expired", className: "expired" },
  { label: "No Show", className: "no-show" },
  { label: "Pending", className: "pending" }
];

function statusTone(status) {
  const normalized = String(status || "").toLowerCase().replace(/[\s-]+/g, "-");
  if (["confirmed", "approved", "arrived"].includes(normalized)) return "confirmed";
  if (["in-use", "active", "osg"].includes(normalized)) return "in-use";
  if (["completed", "verified", "available"].includes(normalized)) return "completed";
  if (["cancelled", "failed"].includes(normalized)) return "cancelled";
  if (normalized === "rejected") return "rejected";
  if (["expired", "overdue-review"].includes(normalized)) return "expired";
  if (["no-show"].includes(normalized)) return "no-show";
  if (["pending", "for-payment", "awaiting-receipt", "under-owner-review", "reserved", "office", "under-additional-review"].includes(normalized)) return "pending";
  return "pending";
}

export function CalendarView({ store, onAction }) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [resourceId, setResourceId] = useState("All");
  const [status, setStatus] = useState("All");
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [statusAction, setStatusAction] = useState(null);
  const [year, monthNumber] = month.split("-").map(Number);
  const cells = monthCells(month);
  const baseYear = Number(todayIso().slice(0, 4));
  const years = [...new Set([baseYear - 1, baseYear, baseYear + 1, baseYear + 2, year])].sort((left, right) => left - right);

  function openMonth(next) {
    if (!next) return;
    setMonth(next);
    setSelectedDate(`${next}-01`);
  }

  const events = store.data.reservations
    .filter((item) => item.date?.startsWith(month))
    .filter((item) => resourceId === "All" || item.resourceId === resourceId)
    .filter((item) => status === "All" || item.status === status)
    .map((item) => ({ ...item, isOverdue: store.isReservationOverdue(item) }))
    .sort((left, right) => compareDateTime(left.date, left.start, right.date, right.start));
  const dayEvents = events.filter((item) => item.date === selectedDate);
  const statusOptions = ["All", ...new Set(store.data.reservations.map((item) => item.status))];

  return (
    <div className="grid calendar-layout admin-calendar">
      <article className="card admin-calendar-surface">
        <div className="calendar-nav">
          <button className="icon-button calendar-nav-button" onClick={() => openMonth(shiftMonth(month, -1))} aria-label="Previous month" type="button">
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <div className="calendar-nav-selects">
            <select className="select calendar-nav-select" value={String(monthNumber)} onChange={(event) => openMonth(`${year}-${String(event.target.value).padStart(2, "0")}`)} aria-label="Calendar month">
              {MONTH_LABELS.map((label, index) => <option value={String(index + 1)} key={label}>{label}</option>)}
            </select>
            <select className="select calendar-nav-select" value={String(year)} onChange={(event) => openMonth(`${event.target.value}-${String(monthNumber).padStart(2, "0")}`)} aria-label="Calendar year">
              {years.map((item) => <option value={String(item)} key={item}>{item}</option>)}
            </select>
          </div>
          <button className="icon-button calendar-nav-button" onClick={() => openMonth(shiftMonth(month, 1))} aria-label="Next month" type="button">
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="toolbar calendar-toolbar">
          <select className="select status-filter" value={resourceId} onChange={(event) => setResourceId(event.target.value)} aria-label="Filter calendar resource">
            <option value="All">All resources</option>
            {store.data.resources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter calendar status">
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="calendar">
          {WEEKDAY_LABELS.map((day) => <div className="calendar-head" key={day}>{day}</div>)}
          {cells.map((cell) => {
            if (!cell.inMonth) {
              return <div className="calendar-day muted" key={cell.key}><strong>{cell.day}</strong></div>;
            }
            const eventsForDay = events.filter((item) => item.date === cell.date);
            return (
              <button className={`calendar-day calendar-button ${cell.date === selectedDate ? "selected" : ""}`} onClick={() => setSelectedDate(cell.date)} type="button" key={cell.key}>
                <strong>{cell.day}</strong>
                {eventsForDay.slice(0, 3).map((event) => (
                  <span className={`event-pill calendar-pill ${statusTone(event.status)}`} key={event.id}>{event.resourceName}</span>
                ))}
                {eventsForDay.length > 3 && <small>{eventsForDay.length - 3} more</small>}
              </button>
            );
          })}
        </div>
      </article>
      <article className="card admin-calendar-surface admin-calendar-side">
        <h2 className="calendar-side-title">Legend</h2>
        <ul className="admin-legend">
          {ADMIN_CALENDAR_LEGEND.map((item) => (
            <li key={item.label}>
              <span className={`legend-swatch ${item.className}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
        <div className="calendar-side-divider" />
        <h2 className="calendar-side-title">Selected Day</h2>
        <p className="calendar-side-summary">
          {formatDate(selectedDate)} · {dayEvents.length} reservation{dayEvents.length === 1 ? "" : "s"} scheduled
        </p>
        <div className="calendar-event-rows">
          {dayEvents.map((item) => (
            <div className="calendar-event-row" key={item.id}>
              <span className={`legend-swatch ${statusTone(item.status)}`} aria-hidden="true" />
              <div className="calendar-event-detail">
                <strong>{item.resourceName}</strong>
                <small>{item.start}-{item.end} · {item.requester} · {item.office}</small>
                <small>{item.purpose}</small>
                <div className="calendar-event-actions">
                  <Badge status={item.status} />
                  {item.isOverdue && <Badge status="Overdue Review" className="overdue-badge">Overdue</Badge>}
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
            </div>
          ))}
        </div>
        {!dayEvents.length && <p className="calendar-side-hint">No reservations for the selected day.</p>}
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
