import ManagedForm from "../../components/ManagedForm.jsx";
import ResourcePhoto from "../../components/ResourcePhoto.jsx";
import ReservationTimeline from "../../components/ReservationTimeline.jsx";
import { readReservationDraft, reservationDraftKey } from "../../domain/reservations/drafts.js";
import { MONTH_LABELS, monthCells, shiftMonth, WEEKDAY_LABELS } from "../../domain/reservations/requesterCalendar.js";
import { reservationErrors } from "../../domain/reservations/validation.js";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, ImageOff, Search } from "lucide-react";
import { ApprovalTrail, AvailabilityLegend, Badge, CardHeader, ConfirmModal, DetailGrid, DetailModal, EmptyState, PaymentInstructionsModal, ReceiptPreview, ReservationRows } from "../../components/Common.jsx";
import { VISITOR_CAPABLE_REQUESTER_TYPES } from "../../config.js";
import { compareDateTime, displayTimestamp, downloadCsv, formatDate, formatTime, sortBy, todayIso, tomorrowIso } from "../../shared/utils.js";
import { approvalProgress, pendingApprovalSteps } from "../../domain/workflows.js";
import { BLOCKING_RESERVATION_STATUSES, effectivePaymentDeadlineHours, fromMinutes, resourceBlockedDate, resourceOperatingWindow, toMinutes } from "../../store/shared.js";
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

/** Peso amount for the request form fee panel and booking summary. */
function pesoAmount(value) {
  const amount = Number(value);
  return `₱${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function NewReservationView({ store, selectedResourceId, selectedSchedule, onAction, onNavigate }) {
  const draftKey = reservationDraftKey(store.currentUser.email);
  const [restored] = useState(() => readReservationDraft(draftKey));
  const [draftChanged, setDraftChanged] = useState(false);
  const [purpose, setPurpose] = useState(restored?.purpose || "");
  const [showErrors, setShowErrors] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState(null);
  const allowedTypes = store.currentUser.requesterType === "Student" ? ["Equipment"] : ["Equipment", "Vehicle"];
  const available = store.data.resources.filter(
    (item) => allowedTypes.includes(item.type)
  );
  const [resourceId, setResourceId] = useState(selectedResourceId || restored?.resourceId || "");
  const [driverChoice, setDriverChoice] = useState(restored?.driverChoice || "Without Driver");
  const [slot, setSlot] = useState(selectedSchedule ? { ...selectedSchedule, quantity: restored?.slot.quantity || "1" } : restored?.slot || { date: "", start: "", end: "", quantity: "1" });
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [monthYear, monthNumber] = month.split("-").map(Number);
  const cells = monthCells(month);
  const selected = available.find((item) => item.id === resourceId);
  const errors = reservationErrors({ ...slot, purpose }, selected);
  // The owning office sets these on the resource, so the request form mirrors them exactly.
  const operatingWindow = resourceOperatingWindow(selected);
  const windowStart = fromMinutes(operatingWindow.start);
  const windowEnd = fromMinutes(operatingWindow.end);
  const blockedOnDate = resourceBlockedDate(selected, slot.date);
  const timeChosen = Boolean(slot.start && slot.end);
  // Only compare against the office window once both times exist, so the empty form shows no errors.
  const outsideWindow = Boolean(selected && timeChosen)
    && (toMinutes(slot.start) < operatingWindow.start
      || toMinutes(slot.end) > operatingWindow.end);

  useEffect(() => {
    if (!draftChanged) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ resourceId, slot, purpose, driverChoice }));
    } catch { /* Draft persistence is best effort; the unsaved-changes guard still protects the form. */ }
  }, [draftChanged, draftKey, resourceId, slot, purpose]);

  const localAvailability = store.resourceAvailability(resourceId, slot.date, slot.start, slot.end);
  const [remoteAvailability, setRemoteAvailability] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const availability = remoteAvailability || localAvailability;
  const slotOptions = availability.slots?.length ? availability.slots : store.reservationSlotOptions(resourceId, slot.date, slot.start, slot.end);
  const dateTooEarly = Boolean(slot.date) && slot.date < tomorrowIso();
  const dateMissing = !slot.date || dateTooEarly;
  const earliestDate = formatDate(tomorrowIso());
  const slotScheduleDate = slotOptions[0]?.date || slot.date;
  // Day colouring needs a window even before a time is picked, so fall back to the office's bookable hours.
  const dayProbeStart = slot.start || windowStart;
  const dayProbeEnd = slot.end || windowEnd;

  function updateSlot(field, value) {
    setSlot((current) => ({ ...current, [field]: value }));
  }

  // Keep the chosen schedule inside the office-configured hours without the requester having to guess.
  useEffect(() => {
    if (!selected) return;
    const window = resourceOperatingWindow(selected);
    setSlot((current) => {
      const start = toMinutes(current.start);
      const end = toMinutes(current.end);
      if (start === null || end === null) return current;
      if (start >= window.start && end <= window.end && end > start) return current;
      const span = Math.min(Math.max(end - start, 30), window.end - window.start);
      return {
        ...current,
        start: fromMinutes(window.start),
        end: fromMinutes(window.start + span)
      };
    });
  }, [selected?.id, selected?.openTime, selected?.closeTime]);

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
    const paid = Boolean(selected.requiresPayment);
    const existingIds = new Set(store.data.reservations.map((item) => item.id));
    const saved = await onAction(() => store.submitReservation(formValues(event.currentTarget)), "Reservation request submitted.");
    if (!saved) return false;
    localStorage.removeItem(draftKey);
    setDraftChanged(false);
    // Paid requests pause on the payment instructions before leaving the page.
    if (paid) {
      const created = store.data.reservations.find((item) => !existingIds.has(item.id));
      setPaymentNotice({
        resource: selected,
        deadlineHours: effectivePaymentDeadlineHours(selected, store.settings),
        reservationId: created?.id || ""
      });
      return true;
    }
    onNavigate("myRequests");
    return true;
  }

  return (
    <div className="grid two-col request-layout">
      <ManagedForm className="card form-card" onSubmit={submit} onChange={() => setDraftChanged(true)}>
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
            {selected?.requiresPayment && (
              <div className="field span-2">
                <div className="fee-notice">
                  <span className="fee-notice-badge">Fee required</span>
                  <strong className="fee-notice-amount">{pesoAmount(selected.fee)}</strong>
                  <p>Pay after your request is approved — you&apos;ll be asked to upload proof of payment, and the reservation is confirmed once the office verifies it.</p>
                </div>
              </div>
            )}
            <div className="field span-2">
              <span className="field-label">Date</span>
              <input id="date" name="date" type="hidden" value={slot.date} readOnly />
              <p className="field-help field-hint-chip">{slot.date ? formatDate(slot.date) : "Pick a date from the calendar."}</p>
              {dateTooEarly && <small className="field-error">Showing slots for the earliest valid date instead: {formatDate(tomorrowIso())}.</small>}
              {blockedOnDate && <small className="field-error">{selected.name} is closed on this date{blockedOnDate.reason ? ` (${blockedOnDate.reason})` : ""}. Choose another date.</small>}
              {!blockedOnDate && selected?.blockedDates?.length ? (
                <small className="field-help">Office-closed dates: {selected.blockedDates.map((item) => `${formatDate(item.date)}${item.reason ? ` (${item.reason})` : ""}`).join(", ")}.</small>
              ) : null}
            </div>

          <div className="field span-2">
            <label htmlFor="start">Start time</label>
            <input id="start" name="start" className="input" type="time" min={windowStart} max={windowEnd} step={300} value={slot.start} onChange={(event) => updateSlot("start", event.target.value)} required />
          </div>
            <div className="field span-2">
              <label htmlFor="end">End time</label>
              <input id="end" name="end" className="input" type="time" min={windowStart} max={windowEnd} step={300} value={slot.end} onChange={(event) => updateSlot("end", event.target.value)} required />
            </div>
            <div className="field span-2"><label htmlFor="quantity">Quantity</label><input id="quantity" name="quantity" className="input" type="number" min="1" max={selected?.capacity || undefined} value={slot.quantity} onChange={(event) => updateSlot("quantity", event.target.value)} /></div>
            {selected?.type === "Vehicle" && (
              <div className="field span-2">
                <label htmlFor="driverChoice">Driver</label>
                <select id="driverChoice" name="driverChoice" className="select" value={driverChoice} onChange={(event) => setDriverChoice(event.target.value)}>
                  <option>With Driver</option>
                  <option>Without Driver</option>
                </select>
              </div>
            )}
            <div className="field span-2"><label htmlFor="purpose">Purpose</label><textarea id="purpose" name="purpose" className="textarea" minLength={10} value={purpose} onChange={(event) => setPurpose(event.target.value)} required placeholder="Describe the activity, class, event, or office purpose." />{showErrors && errors.purpose && <small className="field-error">{errors.purpose}</small>}</div>
          </div>
          {showErrors && Object.entries(errors).filter(([field]) => field !== "purpose").map(([field, message]) => <p className="field-error" key={field}><a href={`#${field}`}>{message}</a></p>)}
          {timeChosen && slot.start >= slot.end && <p className="field-error" role="alert">End time must be after start time.</p>}
          {outsideWindow && (
            <p className="field-error" role="alert">
              {selected.name} can only be booked {windowStart} to {windowEnd}, the hours set by {selected.office}.
            </p>
          )}
          <div className="split-actions form-actions request-submit-actions">
            <button className="primary-button" type="submit" disabled={!selected || checkingAvailability || availability.status !== "available" || outsideWindow || Boolean(blockedOnDate)}>
              {checkingAvailability ? "Checking availability..." : "Submit Request"}
            </button>
          </div>
          {(dateMissing || !timeChosen) && <p className="submit-hint">Choose a date and time slot to continue.</p>}
          {blockedOnDate && <p className="submit-hint">This date is closed by the office. Pick another date to continue.</p>}
        </ManagedForm>
      <section className="card request-calendar-card">
        <CardHeader title="Availability calendar" subtitle={selected ? `Bookable hours set by ${selected.office}: ${windowStart} to ${windowEnd}` : "Choose a resource to see its bookable calendar."} />
        {selected && (
          <div className="availability-calendar-surface request-calendar-surface">
            <div className="availability-calendar-nav">
              <button className="icon-button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" type="button"><ChevronLeft aria-hidden="true" size={18} /></button>
              <strong>{MONTH_LABELS[monthNumber - 1]} {monthYear}</strong>
              <button className="icon-button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" type="button"><ChevronRight aria-hidden="true" size={18} /></button>
            </div>
            <div className="mini-calendar request-calendar-grid">
              {WEEKDAY_LABELS.map((day) => <div className="mini-calendar-head" key={day}>{day}</div>)}
              {cells.map((cell) => {
                if (!cell.inMonth) return <div className="mini-calendar-day muted" key={cell.key}>{cell.day}</div>;
                const blocked = resourceBlockedDate(selected, cell.date);
                const past = cell.date < tomorrowIso();
                const isSelected = cell.date === slot.date;
                const dayReservations = store.resourceConflicts(selected.id, cell.date, dayProbeStart, dayProbeEnd);
                const stateClass = past ? "muted" : blocked ? "blocked" : dayReservations.length ? "unavailable" : "available";
                return (
                  <button
                    className={`mini-calendar-day ${stateClass} ${isSelected ? "selected" : ""}`}
                    onClick={() => { if (!past && !blocked) updateSlot("date", cell.date); }}
                    disabled={past || Boolean(blocked)}
                    aria-label={`${formatDate(cell.date)}, ${blocked ? "blocked" : dayReservations.length ? "unavailable" : "available"}`}
                    type="button"
                    key={cell.key}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
            <ul className="mini-calendar-legend">
              <li><span className="mini-calendar-legend-swatch available" aria-hidden="true" />Available</li>
              <li><span className="mini-calendar-legend-swatch unavailable" aria-hidden="true" />Booked</li>
              <li><span className="mini-calendar-legend-swatch blocked" aria-hidden="true" />Blocked</li>
            </ul>
          <div className="request-slot-panel">
              {dateMissing ? (
                <p className="request-slot-hint">Select a date to see time slots</p>
              ) : (
                <>
                  <div className={`availability-panel ${selected ? `availability-${availability.status}` : ""}`}>
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
                    <h3>{formatDate(slotScheduleDate)} time slots</h3>
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
                            <span>{formatTime(option.start)}–{formatTime(option.end)}</span>
                            <small>{option.status === "available" ? "Available" : "Booked"}</small>
                          </button>
                        );
                      })}
                    </div>
                    <AvailabilityLegend />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {!selected && <EmptyState>Choose a resource above to see its bookable calendar.</EmptyState>}
      </section>
      {paymentNotice && (
        <PaymentInstructionsModal
          resource={paymentNotice.resource}
          deadlineHours={paymentNotice.deadlineHours}
          instructions={store.settings.paymentInstructions}
          steps={store.settings.paymentSteps}
          reservationId={paymentNotice.reservationId}
          onClose={() => {
            setPaymentNotice(null);
            onNavigate("myRequests");
          }}
        />
      )}
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
            {item.resourceConflict && <Badge status="Unavailable" className="overdue-badge">Resource conflict</Badge>}
            <h3 className="item-title">{item.resourceName}</h3>
            <p>{item.requester} · {formatDate(item.date)} · {item.purpose}</p>
            <p className="approval-assignment"><strong>{step.name}</strong> · {step.office}</p>
            {(() => {
              const queue = store?.fcfsFor(item);
              if (!queue) return null;
              return (
                <p className="fcfs-queue-note">
                  Competing requests for this schedule: <strong>{queue.position} of {queue.total}</strong> in First-Come, First-Served order.
                  {queue.position > 1 ? " Approve the earlier request first." : " This is the earliest request and may be confirmed."}
                </p>
              );
            })()}
            {item.resourceConflict && (
              <p className="approval-route-note">{item.resourceConflictReason} Review this request before deciding.</p>
            )}
            {item.requiresPayment && item.office !== office && (
              <p className="approval-route-note">Payment verification belongs to {item.office}, because it owns {item.resourceName}.</p>
            )}
            <ApprovalTrail reservation={item} />
            {(() => {
              const resource = store?.data.resources.find((candidate) => candidate.id === item.resourceId);
              if (!resource || resource.type !== "Vehicle" || resource.driver !== "With Driver" || item.driverChoice !== "With Driver") return null;
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

function currentApprovalStep(reservation) {
  const steps = reservation.approvalSteps || [];
  return steps.find((step) => step.status === "Pending")
    || [...steps].reverse().find((step) => ["Approved", "Rejected", "Skipped"].includes(step.status))
    || steps[0];
}

function ApprovalRouteTable({ store, items }) {
  const [selected, setSelected] = useState(null);
  if (!items.length) return <EmptyState>No approval routes match this search.</EmptyState>;

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Resource</th><th>Requester</th><th>Date</th><th>Progress</th><th>Status</th><th /></tr></thead>
          <tbody>
            {items.map((item) => {
              const progress = approvalProgress(item);
              const step = currentApprovalStep(item);
              return (
                <tr key={item.id}>
                  <td>
                    <strong>{item.resourceName}</strong>
                    {step && (
                      <p className="table-subtext route-step-line">
                        <span className={`step-dot step-${step.status.toLowerCase()}`} aria-hidden="true" />
                        {step.name ? `${step.name}, ` : ""}{step.office}, {step.status.toLowerCase()}{step.decidedBy ? ` (${step.decidedBy})` : ""}
                      </p>
                    )}
                  </td>
                  <td>
                    <strong>{item.requester}</strong>
                    <p className="table-subtext">{item.purpose}</p>
                  </td>
                  <td>{formatDate(item.date)}</td>
                  <td>
                    {progress.total ? (
                      <div className="route-progress">
                        <div className="chart-track"><b style={{ width: `${(progress.completed / progress.total) * 100}%` }} /></div>
                        <span>{progress.completed} of {progress.total}</span>
                      </div>
                    ) : <button className="link-button" onClick={() => setSelected(item)} type="button">Open details</button>}
                  </td>
                  <td><Badge status={item.status} /></td>
                  <td><button className="secondary-button" onClick={() => setSelected(item)} type="button">View Details</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const actionItems = store.actionableReservations.map((item) => ({ ...item, isOverdue: store.isReservationOverdue(item) })).filter((item) => filtered.some((route) => route.id === item.id));
  const pendingCount = actionItems.reduce((total, item) => total + pendingApprovalSteps(item, store.officeScope).length, 0);
  return (
    <div className="stack">
      <article className="card toolbar-card">
        <div className="toolbar">
          <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search approval routes" aria-label="Search approval routes" />
          <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter approval status">
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button className="secondary-button" onClick={() => downloadCsv("reservata-approval-routes.csv", filtered.map((item) => ({
            id: item.id,
            resource: item.resourceName,
            requester: item.requester,
            office: item.office,
            status: item.status,
            purpose: item.purpose
          })))} disabled={!filtered.length} type="button">Export CSV</button>
        </div>
      </article>
      <article className={`card action-queue-card ${pendingCount ? "" : "clear"}`.trim()}>
        <CardHeader
          title="Needs your action"
          subtitle="Approving forwards the request to the next required office or payment stage."
          action={pendingCount ? <Badge status="Pending">{pendingCount} pending</Badge> : null}
        />
        {!!store.overdueReservations.length && (
          <OverdueNotice
            count={store.overdueReservations.length}
            message="These requests are past their scheduled end time and still unresolved. Review, approve, or reject them with a comment."
          />
        )}
        <ApprovalRows store={store}
          items={actionItems}
          office={store.officeScope}
          onApprove={(id, stepId, reservation) => onAction(() => store.approveReservation(id, stepId), approvalSuccessMessage(reservation, stepId))}
          onReject={(id, stepId, reason) => onAction(() => store.rejectReservation(id, stepId, reason), "Reservation rejected.")}
          onAction={onAction}
        />
      </article>
      <article className="card">
        <CardHeader title="All approval routes" subtitle="Full routes stay visible after your decision is recorded." />
        <ApprovalRouteTable store={store} items={filtered} />
      </article>
    </div>
  );
}

const PAYMENT_STATUS_LABELS = {
  "Awaiting Receipt": "Awaiting receipt",
  "Pending Verification": "Pending review",
  Verified: "Verified",
  Rejected: "Rejected",
  Expired: "Expired",
  Cancelled: "Cancelled"
};

const PAYMENT_BADGE_TONES = {
  "Awaiting Receipt": "awaiting-receipt",
  "Pending Verification": "pending",
  Verified: "verified",
  Rejected: "rejected",
  Expired: "expired",
  Cancelled: "cancelled"
};

function formatPeso(amount) {
  const value = Number(amount);
  return `PHP ${Number.isFinite(value) ? value.toLocaleString("en-PH") : "0"}`;
}

export function PaymentsView({ store, onAction }) {
  const [confirmation, setConfirmation] = useState(null);
  const [rejection, setRejection] = useState(null);
  const [reopen, setReopen] = useState(null);
  const [expanded, setExpanded] = useState("");
  const [preview, setPreview] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("requester");
  const paymentReservation = (payment) => store.data.reservations.find((item) => item.id === payment.reservationId);
  const scoped = store.officePayments;
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = scoped.filter((item) => {
      const reservation = paymentReservation(item);
      const matchesQuery = `${item.id} ${item.requester} ${item.receipt} ${item.status} ${reservation?.resourceName || ""}`.toLowerCase().includes(normalized);
      const matchesStatus = status === "All" || item.status === status;
      return matchesQuery && matchesStatus;
    });
    return sortBy(filtered, sort);
  }, [scoped, query, status, sort, store.data.reservations]);
  const statusOptions = ["All", ...new Set(scoped.map((item) => item.status))];
  const canReopen = (item) => item.status === "Verified";
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
        })))} disabled={!items.length} type="button"><Download size={16} /> Export CSV</button>}
      />
      <div className="toolbar list-toolbar payment-toolbar">
        <div className="search-field">
          <Search size={16} aria-hidden="true" />
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by payment ID, requester or file" aria-label="Search payments" />
        </div>
        <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter payment status">
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort payments">
          <option value="requester">Sort by requester</option>
          <option value="id">Sort by payment ID</option>
          <option value="amount">Sort by amount</option>
          <option value="status">Sort by status</option>
        </select>
      </div>
      <p className="payment-count">{items.length} {items.length === 1 ? "payment" : "payments"}</p>
      {items.map((item) => {
        const reservation = paymentReservation(item);
        const tone = PAYMENT_BADGE_TONES[item.status] || "archived";
        const label = PAYMENT_STATUS_LABELS[item.status] || item.status;
        const isOpen = expanded === item.id;
        return (
          <div className="payment-row" key={item.id}>
            <div className="payment-row-main">
              <div className="payment-row-thumb">
                {item.receiptPreview && item.receiptType !== "application/pdf"
                  ? <img src={item.receiptPreview} alt={`${item.id} receipt thumbnail`} />
                  : <span className="payment-row-thumb-empty"><ImageOff size={18} aria-hidden="true" />No receipt preview yet</span>}
              </div>
              <div className="payment-row-identity">
                <div className="payment-row-title">
                  <h3>{item.id}</h3>
                  <Badge status={tone}>{label}</Badge>
                </div>
                <dl className="payment-row-meta">
                  <div><dt>Requester</dt><dd>{item.requester}</dd></div>
                  <div><dt>Receipt file</dt><dd>{item.receipt}</dd></div>
                  <div><dt>Payment office</dt><dd>{item.office || "Not specified"}</dd></div>
                </dl>
              </div>
              <div className="payment-row-amount">
                <span>Amount</span>
                <strong>{formatPeso(item.amount)}</strong>
              </div>
            </div>
            {item.rejectionReason && <p className="decision-note">Reason: {item.rejectionReason}</p>}
            <div className="payment-row-actions">
              <button className="secondary-button icon-text-button" onClick={() => setPreview(item)} type="button"><Eye size={16} /> View receipt</button>
              <button className="secondary-button icon-text-button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? "" : item.id)} type="button">
                View details <ChevronDown size={16} className={isOpen ? "chevron-open" : ""} />
              </button>
              <div className="payment-row-actions-right">
                {canReopen(item) && (
                  <button className="secondary-button" onClick={() => setReopen({ item, reservation })} type="button">Reopen review</button>
                )}
                {item.status === "Pending Verification" && (
                  <>
                    <button className="secondary-button danger-outline" onClick={() => setRejection({ item, reservation })} type="button">Reject</button>
                    <button className="success-button" onClick={() => {
                      setConfirmation({
                        title: "Approve this payment?",
                        message: "This confirms the receipt and finalizes the reservation.",
                        tone: "success",
                        confirmLabel: "Approve",
                        details: [
                          ["Payment", item.id],
                          ["Amount", formatPeso(item.amount)],
                          ["Receipt", item.receipt],
                          ["Requester", item.requester],
                          ["Reservation", reservation?.resourceName || item.reservationId],
                          ["Payment office", item.office || "Not specified"]
                        ],
                        action: () => onAction(() => store.verifyPayment(item.id, true), "Payment approved and reservation confirmed.")
                      });
                    }} type="button">Approve</button>
                  </>
                )}
              </div>
            </div>
            {isOpen && (
              <div className="payment-row-details">
                <DetailGrid items={[
                  ["Payment ID", item.id],
                  ["Reservation", reservation?.resourceName || item.reservationId],
                  ["Requester", item.requester],
                  ["Amount", formatPeso(item.amount)],
                  ["Receipt file", item.receipt],
                  ["Payment office", item.office || "Not specified"],
                  ["Status", label],
                  ["Uploaded", item.uploadedAt || ""],
                  ["Decided", item.verifiedAt || ""],
                  ["Decided by", item.verifiedBy || ""],
                  ["Rejection reason", item.rejectionReason || ""],
                  ["Reservation status", reservation?.status || ""]
                ]} />
              </div>
            )}
          </div>
        );
      })}
      {!items.length && <EmptyState>No payment records match the current filters.</EmptyState>}
      {preview && (
        <DetailModal title={`${preview.id} receipt`} subtitle={preview.receipt} onClose={() => setPreview(null)}>
          <ReceiptPreview payment={preview} />
        </DetailModal>
      )}
      {reopen && (
        <ConfirmModal
          title="Reopen this verification?"
          message="The payment returns to pending review and its reservation returns to For Payment."
          confirmLabel="Reopen review"
          details={[
            ["Payment", reopen.item.id],
            ["Amount", formatPeso(reopen.item.amount)],
            ["Requester", reopen.item.requester],
            ["Receipt", reopen.item.receipt],
            ["Reservation", reopen.reservation?.resourceName || reopen.item.reservationId]
          ]}
          onCancel={() => setReopen(null)}
          onConfirm={async () => {
            const current = reopen;
            setReopen(null);
            await onAction(() => store.reopenPayment(current.item.id), "Payment returned to pending review.");
          }}
        />
      )}
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
  // Availability is only meaningful for one resource at a time; "All" mixes every resource together.
  const bookedDays = useMemo(() => {
    const booked = new Set();
    if (resourceId === "All") return booked;
    for (const item of store.data.reservations) {
      if (item.resourceId === resourceId && BLOCKING_RESERVATION_STATUSES.includes(item.status)) booked.add(item.date);
    }
    return booked;
  }, [resourceId, store.data.reservations]);
  const showAvailability = resourceId !== "All";
  const dayAvailabilityClass = (date) => (showAvailability ? (bookedDays.has(date) ? "day-unavailable" : "day-available") : "");

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
              <button className={`calendar-day calendar-button ${dayAvailabilityClass(cell.date)} ${cell.date === selectedDate ? "selected" : ""}`} onClick={() => setSelectedDate(cell.date)} type="button" key={cell.key}>
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
        {showAvailability && (
          <>
            <div className="calendar-side-divider" />
            <AvailabilityLegend label="Resource availability" />
          </>
        )}
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
