import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge, CardHeader, DetailGrid, DetailModal, EmptyState } from "../components/Common.jsx";
import { downloadCsv, formatDate, sortBy, todayIso } from "../utils.js";

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function VisitorDetails({ item }) {
  return (
    <DetailGrid items={[
      ["Visitor / group", item.visitor],
      ["Organization", item.organization],
      ["Requester", item.requester],
      ["Schedule", `${formatDate(item.date)} ${item.time}`],
      ["Guests", item.guests],
      ["Vehicles", item.cars],
      ["Plate numbers", item.plate],
      ["Parking", item.parking || "Unassigned"],
      ["Decision reason", item.rejectionReason || "None"],
      ["Purpose", item.purpose]
    ]} />
  );
}

export function VisitorRows({ items, onApprove, onDecline }) {
  const [selected, setSelected] = useState(null);
  const [rejection, setRejection] = useState(null);
  if (!items.length) return <EmptyState>No visitor requests found.</EmptyState>;
  return (
    <>
      {items.map((item) => (
        <div className="list-item" key={item.id}>
          <div>
            <Badge status={item.status} />
            <h3 className="item-title">{item.visitor}</h3>
            <p>{item.organization} · {formatDate(item.date)} {item.time} · {item.guests} guests · {item.cars} vehicle(s)</p>
            <p>{item.purpose} · Plate: {item.plate || "None"}</p>
            {item.rejectionReason && <p className="decision-note">Reason: {item.rejectionReason}</p>}
          </div>
          <div className="split-actions">
            <button className="secondary-button" onClick={() => setSelected(item)} type="button">View Details</button>
            {item.status === "Pending" && onApprove && (
              <>
                <button className="success-button" onClick={() => window.confirm(`Approve visitor request for ${item.visitor}?`) && onApprove(item.id)} type="button">Approve</button>
                <button className="secondary-button" onClick={() => setRejection(item)} type="button">Decline</button>
              </>
            )}
          </div>
        </div>
      ))}
      {selected && (
        <DetailModal title={selected.visitor} subtitle={`${selected.id} · ${selected.status}`} onClose={() => setSelected(null)}>
          <VisitorDetails item={selected} />
        </DetailModal>
      )}
      {rejection && (
        <VisitorReasonModal
          visitor={rejection}
          onCancel={() => setRejection(null)}
          onConfirm={async (reason) => {
            const current = rejection;
            setRejection(null);
            await onDecline(current.id, reason);
          }}
        />
      )}
    </>
  );
}

function VisitorReasonModal({ visitor, onConfirm, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-label="Decline visitor request" onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-heading">
          <div className="confirm-icon confirm-danger" aria-hidden="true"><AlertTriangle size={22} /></div>
          <CardHeader title="Decline visitor request?" subtitle="The requester will see this comment in their tracking view." />
        </div>
        <div className="confirm-details">
          <div><span>Visitor</span><strong>{visitor.visitor}</strong></div>
          <div><span>Requester</span><strong>{visitor.requester}</strong></div>
          <div><span>Schedule</span><strong>{formatDate(visitor.date)} {visitor.time}</strong></div>
        </div>
        <label className="field reason-field">
          <span>Reason / comment</span>
          <textarea className="textarea" value={reason} onChange={(event) => setReason(event.target.value)} minLength="8" required />
        </label>
        <div className="confirm-actions">
          <button className="secondary-button" onClick={onCancel} type="button">Cancel</button>
          <button className="danger-button" onClick={() => onConfirm(reason)} disabled={reason.trim().length < 8} type="button">Decline Request</button>
        </div>
      </section>
    </div>
  );
}

export function VisitorRequestsView({ store, onAction }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("date");
  const items = sortBy(store.data.visitors.filter((item) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = `${item.visitor} ${item.organization} ${item.purpose} ${item.status}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    return matchesQuery && matchesStatus;
  }), sort);
  const statusOptions = ["All", ...new Set(store.data.visitors.map((item) => item.status))];
  return (
    <article className="card">
      <CardHeader
        title="Visitor requests"
        subtitle="Review guest, gate pass, and parking needs."
        action={<button className="secondary-button" onClick={() => downloadCsv("reservata-visitor-requests.csv", items.map((item) => ({
          id: item.id,
          visitor: item.visitor,
          organization: item.organization,
          date: item.date,
          time: item.time,
          status: item.status,
          parking: item.parking || "",
          purpose: item.purpose
        })))} disabled={!items.length} type="button">Export CSV</button>}
      />
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visitors" aria-label="Search visitor requests" />
        <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter visitor status">
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort visitor requests">
          <option value="date">Sort by date</option>
          <option value="visitor">Sort by visitor</option>
          <option value="status">Sort by status</option>
        </select>
      </div>
      <VisitorRows
        items={items}
        onApprove={(id) => onAction(() => store.approveVisitor(id, true), "Visitor request approved.")}
        onDecline={(id, reason) => onAction(() => store.approveVisitor(id, false, reason), "Visitor request declined.")}
      />
    </article>
  );
}

export function ParkingView({ store, onAction }) {
  const bays = Array.from({ length: 20 }, (_, index) => {
    const id = `${String.fromCharCode(65 + Math.floor(index / 5))}${(index % 5) + 1}`;
    return { id, visitor: store.data.visitors.find((item) => String(item.parking || "").includes(id)) };
  });
  const open = bays.filter((bay) => !bay.visitor).length;

  return (
    <article className="card">
      <CardHeader title="Main Gate visitor parking" subtitle={`${open} bays open`} />
      <div className="parking-grid parking-content">
        {bays.map((bay) => (
          <button
            className={`parking-bay ${bay.visitor ? "occupied" : ""}`}
            onClick={() => onAction(() => store.allocateBay(bay.id), `Bay ${bay.id} allocated.`)}
            disabled={Boolean(bay.visitor)}
            type="button"
            key={bay.id}
          >
            <small>Bay {bay.id}</small>
            <strong>{bay.visitor ? "Allocated" : "Available"}</strong>
            <small>{bay.visitor ? bay.visitor.visitor : "Select to assign"}</small>
          </button>
        ))}
      </div>
    </article>
  );
}

export function ArrivalRows({ items, onCheckIn }) {
  if (!items.length) return <EmptyState>No visitor arrivals scheduled.</EmptyState>;
  return items.map((item) => (
    <div className="list-item" key={item.id}>
      <div>
        <Badge status={item.status} />
        <h3 className="item-title">{item.visitor}</h3>
        <p>{item.organization} · {item.time} · Parking {item.parking || "Unassigned"}</p>
      </div>
      {item.status === "Approved" && onCheckIn && (
        <div className="split-actions"><button className="success-button" onClick={() => window.confirm(`Check in ${item.visitor}?`) && onCheckIn(item.id)} type="button">Check In</button></div>
      )}
    </div>
  ));
}

export function ArrivalsView({ store, onAction }) {
  const [query, setQuery] = useState("");
  const items = store.data.visitors.filter((item) =>
    `${item.visitor} ${item.organization} ${item.parking} ${item.status}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <article className="card">
      <CardHeader title="Arrival monitor" subtitle="Validate arrival when visitors reach campus." />
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search arrivals" aria-label="Search arrivals" />
      </div>
      <ArrivalRows items={items} onCheckIn={(id) => onAction(() => store.checkInVisitor(id), "Visitor arrival recorded.")} />
    </article>
  );
}

export function VisitorRecordsView({ store }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("date");
  const items = sortBy(store.data.visitors.filter((item) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = `${item.visitor} ${item.organization} ${item.purpose} ${item.status}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    return matchesQuery && matchesStatus;
  }), sort);
  const statusOptions = ["All", ...new Set(store.data.visitors.map((item) => item.status))];
  return (
    <article className="card">
      <CardHeader
        title="Visitor records"
        subtitle="Searchable guest log for OSG monitoring."
        action={<button className="secondary-button" onClick={() => downloadCsv("reservata-visitor-records.csv", items.map((item) => ({
          id: item.id,
          visitor: item.visitor,
          organization: item.organization,
          date: item.date,
          time: item.time,
          status: item.status,
          parking: item.parking || "",
          purpose: item.purpose
        })))} disabled={!items.length} type="button">Export CSV</button>}
      />
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records" aria-label="Search visitor records" />
        <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter visitor record status">
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort visitor records">
          <option value="date">Sort by date</option>
          <option value="visitor">Sort by visitor</option>
          <option value="status">Sort by status</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Visitor</th><th>Organization</th><th>Purpose</th><th>Status</th><th>Parking</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}><td>{item.visitor}</td><td>{item.organization}</td><td>{item.purpose}</td><td><Badge status={item.status} /></td><td>{item.parking || "Unassigned"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <EmptyState>No visitor records match the current filters.</EmptyState>}
    </article>
  );
}

export function NewVisitorView({ store, onAction, onNavigate }) {
  async function submit(event) {
    event.preventDefault();
    const saved = await onAction(() => store.submitVisitor(formValues(event.currentTarget)), "Visitor access request submitted to OSG.");
    if (saved) onNavigate("myVisitorRequests");
  }

  return (
    <form className="card form-card" onSubmit={submit}>
      <div className="form-grid">
        <div className="field"><label htmlFor="visitor">Visitor / group name</label><input id="visitor" name="visitor" className="input" required /></div>
        <div className="field"><label htmlFor="organization">Organization</label><input id="organization" name="organization" className="input" required /></div>
        <div className="field"><label htmlFor="visitDate">Visit date</label><input id="visitDate" name="visitDate" className="input" type="date" min={todayIso()} required /></div>
        <div className="field"><label htmlFor="visitTime">Arrival time</label><input id="visitTime" name="visitTime" className="input" type="time" required /></div>
        <div className="field"><label htmlFor="guests">Guest count</label><input id="guests" name="guests" className="input" type="number" min="1" defaultValue="1" required /></div>
        <div className="field"><label htmlFor="cars">Vehicle count</label><input id="cars" name="cars" className="input" type="number" min="0" defaultValue="0" /></div>
        <div className="field span-2"><label htmlFor="plate">Plate numbers</label><input id="plate" name="plate" className="input" placeholder="Optional" /></div>
        <div className="field span-2"><label htmlFor="visitorPurpose">Purpose</label><textarea id="visitorPurpose" name="visitorPurpose" className="textarea" required /></div>
      </div>
      <div className="split-actions form-actions"><button className="primary-button" type="submit">Submit to OSG</button></div>
    </form>
  );
}

export function MyVisitorRequestsView({ store }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const mine = store.data.visitors.filter((item) => item.requester === store.currentUser.name);
  const items = mine.filter((item) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = `${item.visitor} ${item.organization} ${item.purpose} ${item.status}`.toLowerCase().includes(normalized);
    const matchesStatus = status === "All" || item.status === status;
    return matchesQuery && matchesStatus;
  });
  const statusOptions = ["All", ...new Set(mine.map((item) => item.status))];
  return (
    <article className="card">
      <CardHeader
        title="Visitor access requests"
        subtitle="Your OSG submissions"
        action={<button className="secondary-button" onClick={() => downloadCsv("reservata-my-visitor-requests.csv", items.map((item) => ({
          id: item.id,
          visitor: item.visitor,
          organization: item.organization,
          date: item.date,
          time: item.time,
          status: item.status,
          reason: item.rejectionReason || ""
        })))} disabled={!items.length} type="button">Export CSV</button>}
      />
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search my visitor requests" aria-label="Search my visitor requests" />
        <select className="select status-filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter visitor request status">
          {statusOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <VisitorRows items={items} />
    </article>
  );
}
