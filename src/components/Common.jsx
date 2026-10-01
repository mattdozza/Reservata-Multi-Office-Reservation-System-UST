import { useRef, useState } from "react";
import { awsBackendConfigured } from "../services/awsApi.js";
import { AlertTriangle, CheckCircle2, FileText, Info, Upload, X } from "lucide-react";
import { badgeClass, displayTimestamp, formatDate, tomorrowIso } from "../shared/utils.js";
import { approvalProgress } from "../domain/workflows.js";
import ReservationTimeline from "./ReservationTimeline.jsx";
import ResourcePhoto from "./ResourcePhoto.jsx";

export function Badge({ status, children, className = "" }) {
  return <span className={`badge ${badgeClass(status)} ${className}`.trim()}>{children ?? status}</span>;
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="card-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>;
}

export function Metrics({ items, columns = "metrics-grid" }) {
  return (
    <div className={`grid ${columns}`}>
      {items.map(({ label, value, caption, accent, color }) => (
        <article
          className="card metric-card"
          style={{ "--accent": accent, "--metric-color": color }}
          key={label}
        >
          <small>{label}</small>
          <strong>{value}</strong>
          <p>{caption}</p>
        </article>
      ))}
    </div>
  );
}

export function StatusTiles({ title, subtitle, items, columns }) {
  return (
    <article className="card summary-card">
      <CardHeader title={title} subtitle={subtitle} />
      <div className={`summary-tiles ${columns === 2 ? "tiles-2col" : ""}`.trim()}>
        {items.map((item) => (
          <div className="summary-tile" style={{ "--metric-color": item.color }} key={item.label}>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

export function StatusTileGrid({ title, subtitle, items }) {
  return (
    <article className="card status-tile-card">
      <CardHeader title={title} subtitle={subtitle} />
      <div className="status-tile-grid">
        {items.map((item) => (
          <div className="status-tile" key={item.label}>
            <strong className={item.value ? "" : "zero"}>{item.value}</strong>
            <small style={{ color: item.color }}>{item.label}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

export function StatusBreakdown({ title, subtitle, items }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + (Number(item.value) || 0), 0));
  return (
    <article className="card chart-card">
      <CardHeader title={title} subtitle={subtitle} />
      <div className="status-breakdown">
        <div className="status-stack-track" role="img" aria-label={`${title} breakdown`}>
          {items.filter((item) => item.value > 0).map((item) => (
            <span
              className="status-stack-segment"
              style={{ width: `${(item.value / total) * 100}%`, background: item.color }}
              key={item.label}
            />
          ))}
        </div>
        <ul className="status-legend-list">
          {items.map((item) => (
            <li className={item.value ? "" : "zero"} key={item.label}>
              <span className="status-dot" style={{ background: item.color }} aria-hidden="true" />
              <span className="status-legend-label">{item.label}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export function AvailabilityLegend({ label = "" }) {
  return (
    <div className="availability-legend">
      {label && <span className="availability-legend-title">{label}</span>}
      <ul>
        <li><span className="availability-swatch available" aria-hidden="true" />Available</li>
        <li><span className="availability-swatch unavailable" aria-hidden="true" />Unavailable</li>
      </ul>
    </div>
  );
}

export function ChartSummary({ title, subtitle, items }) {
  const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));
  return (
    <article className="card chart-card">
      <CardHeader title={title} subtitle={subtitle} />
      <div className="chart-list">
        {items.map((item) => (
          <div className="chart-row" key={item.label}>
            <span>{item.label}</span>
            <div className="chart-track"><b style={{ width: `${Math.max(6, (Number(item.value) || 0) / max * 100)}%` }} /></div>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

export function DetailModal({ title, subtitle, onClose, children, className = "" }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`modal-panel ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <CardHeader
          title={title}
          subtitle={subtitle}
          action={<button className="icon-button" aria-label="Close details" onClick={onClose} type="button"><X size={17} /></button>}
        />
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  tone = "primary",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  details = [],
  onConfirm,
  onCancel
}) {
  const actionClass = tone === "success" ? "success-button" : tone === "danger" ? "danger-button" : "primary-button";
  const icon = tone === "success" ? <CheckCircle2 size={22} /> : tone === "danger" ? <AlertTriangle size={22} /> : <Info size={22} />;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-heading">
          <div className={`confirm-icon confirm-${tone}`} aria-hidden="true">{icon}</div>
          <CardHeader title={title} subtitle={message} />
        </div>
        {!!details.length && (
          <div className="confirm-details">
            {details.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}
        <div className="confirm-actions">
          <button className="secondary-button" onClick={onCancel} type="button">{cancelLabel}</button>
          <button className={actionClass} onClick={onConfirm} type="button">{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

export function DetailGrid({ items }) {
  return (
    <div className="detail-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <label className="field-label">{label}</label>
          <div className="detail-box">{value === "" || value == null ? "None" : value}</div>
        </div>
      ))}
    </div>
  );
}

export function ReservationDetails({ store, reservation }) {
  const payment = store.data.payments.find((item) => item.id === reservation.paymentId)
    || store.data.payments.filter((item) => item.reservationId === reservation.id).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
  const resource = store.data.resources.find((item) => item.id === reservation.resourceId);
  return (
    <>
      {resource?.photoKey && <ResourcePhoto resource={resource} />}
      <DetailGrid items={[
        ["Request ID", reservation.id],
        ["Requester", reservation.requester],
        ["Resource", reservation.resourceName],
        ["Office", reservation.office],
        ["Schedule", `${formatDate(reservation.date)} ${reservation.start}-${reservation.end}`],
        ["Warning", reservation.status === "Expired" ? reservation.expiryReason || "Reservation expired before final confirmation." : store.isReservationOverdue(reservation) ? "Scheduled time has passed without final confirmation or rejection." : "None"],
        ["Quantity", reservation.quantity],
        ["Payment", reservation.requiresPayment ? payment?.status || "Required" : "Not required"],
        ["Decision reason", reservation.rejectionReason || "None"],
        ["Cancellation / expiry reason", reservation.cancellationReason || reservation.expiryReason || reservation.overrideReason || "None"],
        ["Purpose", reservation.purpose]
      ]} />
      <ApprovalTrail reservation={reservation} />
      {payment && (
        <div className="detail-section">
          <h3>Payment</h3>
          <DetailGrid items={[
            ["Payment ID", payment.id],
            ["Amount", `PHP ${payment.amount}`],
            ["Receipt", payment.receipt],
            ["Status", payment.status],
            ["Receipt deadline", payment.paymentDeadlineAt ? displayTimestamp(payment.paymentDeadlineAt) : "Not assigned"],
            ["Receipt note", payment.rejectionReason || "None"]
          ]} />
          <ReceiptPreview payment={payment} />
        </div>
      )}
      {!!reservation.supportingDocuments?.length && (
        <div className="detail-section">
          <h3>Supporting Documents</h3>
          {reservation.supportingDocuments.map((document) => (
            <div className="document-row" key={document.id || document.name}>
              <FileText size={18} aria-hidden="true" />
              <div>
                <strong>{document.name}</strong>
                <p className="detail-note">{document.status || "Submitted"} · {document.uploadedAt || "Uploaded"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <ReservationTimeline store={store} reservation={reservation} />
    </>
  );
}

function receiptPayload(file) {
  if (!file || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) return Promise.reject(new Error("Choose a JPG, PNG, or PDF file."));
  const maximum = awsBackendConfigured ? 5_000_000 : 700_000;
  if (!file.size || file.size > maximum) return Promise.reject(new Error(`Choose a file smaller than ${awsBackendConfigured ? "5 MB" : "700 KB"}.`));
  if (file.size > 700_000) return Promise.resolve(file);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      file.previewData = reader.result;
      resolve(file);
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size = 0) {
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)} MB`;
  if (size >= 1_000) return `${Math.round(size / 1_000)} KB`;
  return `${size} bytes`;
}

export function ReceiptPreview({ payment }) {
  if (!payment?.receiptPreview) {
    return <p className="detail-note">No receipt preview is available yet.</p>;
  }
  if (payment.receiptType === "application/pdf") {
    return <iframe className="receipt-preview" title={`${payment.id} receipt preview`} src={payment.receiptPreview} />;
  }
  return <img className="receipt-preview receipt-image" src={payment.receiptPreview} alt={`${payment.id} receipt preview`} />;
}

function isUpcoming(reservation) {
  return new Date(`${reservation.date}T${reservation.start || "00:00"}`).getTime() > Date.now();
}

function requesterCanChange(reservation) {
  return ["Under Owner Review", "Under Additional Review", "For Payment", "Confirmed"].includes(reservation.status) && isUpcoming(reservation);
}

function ReasonPromptModal({ title, message, confirmLabel, details, onConfirm, onCancel }) {
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

function RescheduleModal({ item, onConfirm, onCancel }) {
  const [slot, setSlot] = useState({ date: item.date || tomorrowIso(), start: item.start || "08:00", end: item.end || "09:00" });
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-label="Reschedule reservation" onMouseDown={(event) => event.stopPropagation()}>
        <CardHeader title="Reschedule reservation" subtitle="The request will return to owner review after the schedule changes." />
        <div className="confirm-details">
          <div><span>Request</span><strong>{item.resourceName}</strong></div>
          <div><span>Current schedule</span><strong>{formatDate(item.date)} {item.start}-{item.end}</strong></div>
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor={`reschedule-date-${item.id}`}>Date</label><input id={`reschedule-date-${item.id}`} className="input" type="date" min={tomorrowIso()} value={slot.date} onChange={(event) => setSlot((current) => ({ ...current, date: event.target.value }))} required /></div>
          <div className="field"><label htmlFor={`reschedule-start-${item.id}`}>Start time</label><input id={`reschedule-start-${item.id}`} className="input" type="time" value={slot.start} onChange={(event) => setSlot((current) => ({ ...current, start: event.target.value }))} required /></div>
          <div className="field"><label htmlFor={`reschedule-end-${item.id}`}>End time</label><input id={`reschedule-end-${item.id}`} className="input" type="time" value={slot.end} onChange={(event) => setSlot((current) => ({ ...current, end: event.target.value }))} required /></div>
        </div>
        <div className="confirm-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="primary-button" onClick={() => onConfirm(slot)} disabled={!slot.date || !slot.start || !slot.end || slot.start >= slot.end} type="button">Request Reschedule</button>
        </div>
      </section>
    </div>
  );
}

export function ReservationRows({ store, items, onUpload, onDocumentUpload, onCancel, onReschedule }) {
  const [selected, setSelected] = useState(null);
  const [pendingReceipt, setPendingReceipt] = useState(null);
  const [pendingDocument, setPendingDocument] = useState(null);
  const [cancellation, setCancellation] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const uploadLock = useRef(false);

  async function chooseUpload(event, item, setter) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError("");
    try { setter({ item, file: await receiptPayload(file) }); }
    catch (error) { setUploadError(error.message); }
  }

  async function confirmUpload(kind) {
    if (uploadLock.current) return;
    uploadLock.current = true; setUploadBusy(true); setUploadError("");
    const current = kind === "receipt" ? pendingReceipt : pendingDocument;
    try {
      const saved = await (kind === "receipt" ? onUpload : onDocumentUpload)(current.item.id, current.file);
      if (saved === false) setUploadError("Upload failed. Your file is still selected. Please try again.");
      else if (kind === "receipt") setPendingReceipt(null);
      else setPendingDocument(null);
    } catch (error) { setUploadError(error.message); }
    finally { uploadLock.current = false; setUploadBusy(false); }
  }
  if (!items.length) return <EmptyState>No reservation requests yet.</EmptyState>;

  return (
    <>
      {uploadError && !pendingReceipt && !pendingDocument && <p className="field-error" role="alert">{uploadError}</p>}
      {items.map((item) => (
        <div className="list-item" key={item.id}>
          <div>
            <Badge status={item.status} />
            {store.isReservationOverdue(item) && <Badge status="Overdue Review" className="overdue-badge">Overdue</Badge>}
            <h3 className="item-title">{item.resourceName}</h3>
            <p>
              {item.requester} · {item.office} · {formatDate(item.date)} {item.start}-{item.end}
            </p>
            <p>{item.purpose}</p>
            <ApprovalTrail reservation={item} compact />
          </div>
          <div className="split-actions">
            <button className="secondary-button" onClick={() => setSelected(item)} type="button">View Details</button>
            {store.session.activeRole === "requester" && requesterCanChange(item) && onReschedule && (
              <button className="secondary-button" onClick={() => setReschedule(item)} type="button">Reschedule</button>
            )}
            {store.session.activeRole === "requester" && requesterCanChange(item) && onCancel && (
              <button className="secondary-button" onClick={() => setCancellation(item)} type="button">Cancel</button>
            )}
            {store.session.activeRole === "requester" && !["Rejected", "Cancelled", "Completed", "Expired", "No Show"].includes(item.status) && onDocumentUpload && (
              <label className="secondary-button file-button">
                Upload Document
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(event) => chooseUpload(event, item, setPendingDocument)}
                />
              </label>
            )}
            {store.session.activeRole === "requester" && item.status === "For Payment" && (
              <label className="warning-button file-button">
                Upload Receipt
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(event) => chooseUpload(event, item, setPendingReceipt)}
                />
              </label>
            )}
          </div>
        </div>
      ))}
      {selected && (
        <DetailModal title={selected.resourceName} subtitle={`${selected.id} · ${selected.status}`} onClose={() => setSelected(null)}>
          <ReservationDetails store={store} reservation={selected} />
        </DetailModal>
      )}
      {pendingReceipt && (
        <DetailModal title="Upload receipt?" subtitle={`${pendingReceipt.item.resourceName} · ${pendingReceipt.item.id}`} onClose={() => { if (!uploadLock.current) setPendingReceipt(null); }}>
          <div className="receipt-confirm">
            <div className="receipt-file-summary">
              <FileText size={20} aria-hidden="true" />
              <div>
                <strong>{pendingReceipt.file.name}</strong>
                <p>{pendingReceipt.file.type || "Unknown file type"} · {formatFileSize(pendingReceipt.file.size)}</p>
              </div>
            </div>
            <ReceiptPreview payment={{
              id: pendingReceipt.item.id,
              receiptPreview: pendingReceipt.file.previewData,
              receiptType: pendingReceipt.file.type
            }} />
            <div className="split-actions form-actions">
              <button className="secondary-button" disabled={uploadBusy} onClick={() => setPendingReceipt(null)} type="button">Cancel</button>
              <button
                className="primary-button icon-text-button"
                disabled={uploadBusy}
                onClick={() => confirmUpload("receipt")}
                type="button"
              >
                <Upload size={16} /> {uploadBusy ? "Uploading..." : "Upload Receipt"}
              </button>
            </div>
            {uploadError && <p className="field-error" role="alert">{uploadError}</p>}
          </div>
        </DetailModal>
      )}
      {pendingDocument && (
        <DetailModal title="Upload supporting document?" subtitle={`${pendingDocument.item.resourceName} · ${pendingDocument.item.id}`} onClose={() => { if (!uploadLock.current) setPendingDocument(null); }}>
          <div className="receipt-confirm">
            <div className="receipt-file-summary">
              <FileText size={20} aria-hidden="true" />
              <div>
                <strong>{pendingDocument.file.name}</strong>
                <p>{pendingDocument.file.type || "Unknown file type"} · {formatFileSize(pendingDocument.file.size)}</p>
              </div>
            </div>
            <ReceiptPreview payment={{
              id: pendingDocument.item.id,
              receiptPreview: pendingDocument.file.previewData,
              receiptType: pendingDocument.file.type
            }} />
            <div className="split-actions form-actions">
              <button className="secondary-button" disabled={uploadBusy} onClick={() => setPendingDocument(null)} type="button">Cancel</button>
              <button
                className="primary-button icon-text-button"
                disabled={uploadBusy}
                onClick={() => confirmUpload("document")}
                type="button"
              >
                <Upload size={16} /> {uploadBusy ? "Uploading..." : "Upload Document"}
              </button>
            </div>
            {uploadError && <p className="field-error" role="alert">{uploadError}</p>}
          </div>
        </DetailModal>
      )}
      {cancellation && (
        <ReasonPromptModal
          title="Cancel this reservation?"
          message="This closes the request, releases the schedule, and notifies the resource-owning office."
          confirmLabel="Cancel Reservation"
          details={[
            ["Request", cancellation.resourceName],
            ["Schedule", `${formatDate(cancellation.date)} ${cancellation.start}-${cancellation.end}`]
          ]}
          onCancel={() => setCancellation(null)}
          onConfirm={async (reason) => {
            const current = cancellation;
            setCancellation(null);
            await onCancel(current.id, reason);
          }}
        />
      )}
      {reschedule && (
        <RescheduleModal
          item={reschedule}
          onCancel={() => setReschedule(null)}
          onConfirm={async (slot) => {
            const current = reschedule;
            setReschedule(null);
            await onReschedule(current.id, slot);
          }}
        />
      )}
    </>
  );
}

export function ApprovalTrail({ reservation, compact = false }) {
  const steps = reservation.approvalSteps || [];
  if (!steps.length) return null;
  const progress = approvalProgress(reservation);
  return (
    <div className={`approval-trail ${compact ? "compact" : ""}`}>
      <p className="approval-summary">{progress.completed} of {progress.total} approval steps completed</p>
      <div className="approval-step-list" aria-label="Approval route">
        {steps.map((step) => (
          <div className={`approval-step approval-step-${step.status.toLowerCase()}`} key={step.id}>
            <span className={`step-dot step-${step.status.toLowerCase()}`} aria-hidden="true" />
            <span>
              <strong>{step.name}</strong>
              <small>
                {step.office} · {step.status}
                {step.decidedBy && ` · ${step.decidedBy}`}
                {step.decidedAt && ` · ${displayTimestamp(step.decidedAt)}`}
              </small>
              {step.reason && <em>{step.reason}</em>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResourceMiniRows({ items, onSelect }) {
  if (!items.length) return <EmptyState>No resources found.</EmptyState>;
  return items.map((item) => {
    const body = (
      <>
        <div>
          <h3 className="item-title">{item.name}</h3>
          <p>{item.type} · {item.office}</p>
        </div>
        <Badge status={item.status} />
      </>
    );
    if (!onSelect) return <div className="list-item resource-mini-row" key={item.id}>{body}</div>;
    return (
      <button
        className="list-item resource-mini-row resource-mini-button"
        onClick={() => onSelect(item)}
        aria-label={`Request ${item.name}, ${item.type} at ${item.office}`}
        type="button"
        key={item.id}
      >
        {body}
      </button>
    );
  });
}

export function ActivityRows({ store, limit = 50 }) {
  const items = store.visibleActivity.slice(0, limit);
  if (!items.length) return <EmptyState>No activity records for this role.</EmptyState>;
  return items.map((item, index) => (
    <div className="list-item" key={`${item.time}-${item.action}-${index}`}>
      <div>
        <h3>{item.action}</h3>
        <p>{item.actor} · {item.target} · {displayTimestamp(item.time)}{item.details ? ` · ${item.details}` : ""}</p>
      </div>
    </div>
  ));
}

export function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <img className="brand-logo loading-brand-logo" src="/images/logo2.svg" alt="University of Santo Tomas seal" />
      <strong>Loading RESERVATA...</strong>
    </main>
  );
}
