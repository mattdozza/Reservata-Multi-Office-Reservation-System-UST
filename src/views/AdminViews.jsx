import { useState } from "react";
import { ActivityRows, Badge, CardHeader, EmptyState } from "../components/Common.jsx";
import { downloadCsv, sortBy } from "../utils.js";

const ROLE_OPTIONS = ["Requester", "Office Admin", "Super Admin", "OSG Admin", "OSG Requester"];
export function OfficeRows({ store, onNavigate, onEdit, onArchive }) {
  const configured = store.data.offices?.length
    ? store.data.offices
    : [...new Set(store.data.resources.map((item) => item.office))].map((name) => ({ id: name, name, status: "Active" }));
  const offices = onEdit || onArchive ? configured : configured.filter((item) => item.status !== "Inactive");
  if (!offices.length) return <EmptyState>No offices configured.</EmptyState>;

  return offices.map((office) => {
    const resourceCount = store.data.resources.filter((resource) => resource.office === office.name && resource.status !== "Archived").length;
    const administratorCount = store.data.people.filter((person) => person.office === office.name && person.role.includes("Admin")).length;
    return (
      <div className="list-item" key={office.id}>
        <div>
          <Badge status={office.status}>{office.status}</Badge>
          <h3 className="item-title">{office.name}</h3>
          <p>{resourceCount} resources · {administratorCount} administrator account{administratorCount === 1 ? "" : "s"}</p>
        </div>
        <div className="split-actions">
          {onNavigate && <button className="secondary-button" onClick={() => onNavigate("resources")} type="button">View Coverage</button>}
          {onEdit && <button className="secondary-button" onClick={() => onEdit(office)} type="button">Edit</button>}
          {onArchive && <button className="danger-button" onClick={() => onArchive(office.id)} type="button">Archive</button>}
        </div>
      </div>
    );
  });
}

export function OfficesView({ store, onAction, onNavigate }) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("Active");

  async function submit(event) {
    event.preventDefault();
    const saved = await onAction(() => store.saveOffice({ name, status }, selected?.id), selected ? "Office updated." : "Office created.");
    if (saved) { setName(""); setStatus("Active"); setSelected(null); }
  }

  function edit(office) {
    setSelected(office);
    setName(office.name);
    setStatus(office.status);
  }

  return (
    <>
      <form className="toolbar office-editor" onSubmit={submit}>
        <div><strong>{selected ? "Edit office" : "Add office"}</strong><p className="toolbar-copy">Resource ownership and administrator assignment.</p></div>
        <div className="toolbar-group">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Office name" aria-label="Office name" required />
          <select className="select" aria-label="Office status" value={status} onChange={(event) => setStatus(event.target.value)}><option>Active</option><option>Inactive</option></select>
          <button className="primary-button" type="submit">{selected ? "Save Office" : "Add Office"}</button>
          {selected && <button className="secondary-button" onClick={() => { setSelected(null); setName(""); setStatus("Active"); }} type="button">Cancel</button>}
        </div>
      </form>
      <div className="toolbar">
        <input className="input user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search offices" aria-label="Search offices" />
      </div>
      <article className="card">
        <OfficeRows
          store={{
            ...store,
            data: {
              ...store.data,
              offices: store.data.offices.filter((office) => `${office.name} ${office.status}`.toLowerCase().includes(query.trim().toLowerCase()))
            }
          }}
          onNavigate={onNavigate}
          onEdit={edit}
          onArchive={(id) => window.confirm("Archive this office? Active resources must be transferred or archived first.") && onAction(() => store.archiveOffice(id), "Office archived.")}
        />
      </article>
    </>
  );
}

export function UsersView({ store, onAction }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [draft, setDraft] = useState({
    name: "",
    email: "",
    office: store.data.offices.find((office) => office.status === "Active")?.name || "All Offices",
    role: "Requester",
    status: "Active"
  });
  const normalized = query.trim().toLowerCase();
  const people = sortBy(store.data.people.filter((person) =>
    `${person.name} ${person.email} ${person.office} ${person.role}`.toLowerCase().includes(normalized)
  ), sort);
  const officeOptions = [
    "All Offices",
    ...store.data.offices.filter((office) => office.status === "Active").map((office) => office.name)
  ];

  async function submit(event) {
    event.preventDefault();
    const saved = await onAction(() => store.createUser(draft), "SSO account provisioned.");
    if (saved) {
      setDraft({
        name: "",
        email: "",
        office: store.data.offices.find((office) => office.status === "Active")?.name || "All Offices",
        role: "Requester",
        status: "Active"
      });
    }
  }

  function update(field, value) {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "role" && value === "Super Admin") next.office = "All Offices";
      if (field === "role" && value === "OSG Admin") next.office = "OSG";
      if (field === "role" && value === "Office Admin" && next.office === "All Offices") {
        next.office = store.data.offices.find((office) => office.status === "Active")?.name || "";
      }
      return next;
    });
  }

  return (
    <>
      <form className="card form-card user-create-form" onSubmit={submit} noValidate>
        <CardHeader title="Provision SSO account" subtitle="Only Super Admins can register a UST SSO identity for RESERVATA access." />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="new-user-name">Full name</label>
            <input id="new-user-name" className="input" value={draft.name} onChange={(event) => update("name", event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="new-user-email">UST SSO email</label>
            <input
              id="new-user-email"
              className="input"
              type="email"
              inputMode="email"
              title="Use a UST SSO email ending in @ust.edu.ph"
              value={draft.email}
              onChange={(event) => update("email", event.target.value.trim().toLowerCase())}
              placeholder="name@ust.edu.ph"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-user-office">Office</label>
            <select id="new-user-office" className="select" value={draft.office} onChange={(event) => update("office", event.target.value)} required>
              {officeOptions.map((office) => <option key={office} value={office}>{office}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-user-role">Role</label>
            <select id="new-user-role" className="select" value={draft.role} onChange={(event) => update("role", event.target.value)} required>
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-user-status">Account status</label>
            <select id="new-user-status" className="select" value={draft.status} onChange={(event) => update("status", event.target.value)} required>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
        </div>
        <div className="split-actions form-actions">
          <button className="primary-button" type="submit">Create Account</button>
        </div>
      </form>
      <div className="toolbar">
        <input
          className="input user-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search users, roles, or offices"
          aria-label="Search users"
        />
        <div className="toolbar-group">
          <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort users">
            <option value="name">Sort by name</option>
            <option value="office">Sort by office</option>
            <option value="role">Sort by role</option>
            <option value="status">Sort by status</option>
          </select>
          <button className="secondary-button" onClick={() => downloadCsv("reservata-users.csv", people.map((person) => ({
            name: person.name,
            email: person.email,
            office: person.office,
            role: person.role,
            status: person.status
          })))} disabled={!people.length} type="button">Export CSV</button>
        </div>
      </div>
      <article className="card table-wrap">
        <table>
          <thead><tr><th>User</th><th>Office</th><th>Role</th><th>Account Status</th></tr></thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.email}>
                <td><strong>{person.name}</strong><br /><small>{person.email}</small></td>
                <td>{person.office}</td>
                <td>
                  <select
                    aria-label={`Role for ${person.name}`}
                    className="input role-select"
                    disabled={person.email === store.currentUser.email}
                    onChange={(event) => onAction(() => store.updateUserRole(person.email, event.target.value), "User role updated.")}
                    value={person.role}
                  >
                    {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`Account status for ${person.name}`}
                    className="input role-select"
                    disabled={person.email === store.currentUser.email}
                    onChange={(event) => {
                      const nextStatus = event.target.value;
                      if (nextStatus === "Inactive" && !window.confirm(`Deactivate ${person.name}'s account?`)) return;
                      onAction(() => store.updateUserStatus(person.email, nextStatus), "User access updated.");
                    }}
                    value={person.status}
                  >
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!people.length && <EmptyState>No matching users found.</EmptyState>}
      </article>
    </>
  );
}

export function ActivityView({ store }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("time");
  const normalized = query.trim().toLowerCase();
  const visibleActivity = sortBy(store.visibleActivity.filter((item) =>
    `${item.action} ${item.actor} ${item.target} ${item.time} ${item.details || ""}`.toLowerCase().includes(normalized)
  ), sort, sort === "time" ? "desc" : "asc");
  const scopedStore = {
    ...store,
    get visibleActivity() {
      return visibleActivity;
    }
  };
  return (
    <article className="card">
      <CardHeader
        title="Audit trail"
        subtitle="Reservation, payment, user, and visitor actions"
        action={<button className="secondary-button" onClick={() => downloadCsv("reservata-audit-trail.csv", visibleActivity.map((item) => ({
          action: item.action,
          actor: item.actor,
          target: item.target,
          details: item.details || "",
          time: item.time
        })))} disabled={!visibleActivity.length} type="button">Export CSV</button>}
      />
      <div className="toolbar list-toolbar">
        <input className="input resource-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audit trail" aria-label="Search audit trail" />
        <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort audit trail">
          <option value="time">Sort by time</option>
          <option value="action">Sort by action</option>
          <option value="actor">Sort by actor</option>
          <option value="target">Sort by target</option>
        </select>
      </div>
      <ActivityRows store={scopedStore} />
    </article>
  );
}

export function ProfileView({ store }) {
  const user = store.currentUser;
  return (
    <>
      <article className="hero profile-hero">
        <span className="big-avatar">{user.initials}</span>
        <div><span className="eyebrow">{user.roleLabel}</span><h2>{user.name}</h2><p>{user.email}</p></div>
      </article>
      <article className="card profile-details">
        <div className="detail-grid">
          <div><label className="field-label">Full Name</label><div className="detail-box">{user.name}</div></div>
          <div><label className="field-label">Email</label><div className="detail-box">{user.email}</div></div>
          <div><label className="field-label">Role</label><div className="detail-box">{user.roleLabel}</div></div>
          <div><label className="field-label">Office / Scope</label><div className="detail-box">{user.office}</div></div>
        </div>
      </article>
    </>
  );
}
