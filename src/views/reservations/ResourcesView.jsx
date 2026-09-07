import { useState } from "react";
import { Badge } from "../../components/Common.jsx";
import { sortBy } from "../../utils.js";

const RESOURCE_TYPES = ["All", "Facility", "Vehicle", "Equipment", "Visitor Service"];
const RESOURCE_STATUSES = ["All", "Available", "Reserved", "In Use", "Under Maintenance", "Unavailable", "Archived"];

export function ResourcesView({ store, onAction, onNavigate, onReserve }) {
  const [filter, setFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const role = store.session.activeRole;

  const resources = (() => {
    let items = [...store.data.resources];
    if (role === "requester") items = items.filter((item) => ["Equipment", "Facility", "Vehicle"].includes(item.type));
    if (role === "officeAdmin") items = store.officeResources;
    const normalized = query.trim().toLowerCase();
    items = items.filter((item) => {
      const matchesType = filter === "All" || item.type === filter;
      const matchesStatus = statusFilter === "All" || item.status === statusFilter;
      const matchesQuery = `${item.name} ${item.office} ${item.location} ${item.assetTag || ""} ${item.serialNumber || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(normalized);
      return matchesType && matchesStatus && matchesQuery;
    });
    if (sort === "status") items = sortBy(items, "status");
    else if (sort === "office") items = sortBy(items, "office");
    else items = sortBy(items, "name");
    return items;
  })();

  return (
    <>
      <div className="toolbar">
        <div className="tabs" aria-label="Filter resources">
          {RESOURCE_TYPES.map((item) => (
            <button className={`tab ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)} type="button" key={item}>
              {item}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <input
            className="input resource-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search resources"
            aria-label="Search resources"
          />
          <select className="select status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter resource status">
            {RESOURCE_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort resources">
            <option value="name">Sort by name</option>
            <option value="office">Sort by office</option>
            <option value="status">Sort by status</option>
          </select>
          {role === "officeAdmin" && (
            <button className="primary-button" onClick={() => onNavigate("officeSettings")} type="button">
              Manage Resources
            </button>
          )}
        </div>
      </div>
      <div className="grid four-col">
        {resources.map((resource) => (
          <article className="card resource-card" key={resource.id}>
            <div className="resource-art">{resource.type}</div>
            <div className="resource-body">
              <Badge status={resource.status} />
              <h3>{resource.name}</h3>
              <p>
                {resource.office} · {resource.location}<br />
                {resource.assetTag && <>Tag: {resource.assetTag}<br /></>}
                Capacity: {resource.capacity}
                {resource.requiresPayment && ` · Fee: PHP ${resource.fee}`}
              </p>
              {resource.tags?.length ? (
                <div className="tag-list">
                  {resource.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              ) : null}
              {role === "requester" ? (
                <button
                  className="primary-button"
                  onClick={() => onReserve(resource.id)}
                  disabled={resource.status !== "Available"}
                  type="button"
                >
                  Reserve
                </button>
              ) : role === "officeAdmin" ? (
                <button className="secondary-button" onClick={() => onAction(() => store.cycleResourceStatus(resource.id), "Resource status updated.")} type="button">
                  Update Status
                </button>
              ) : <span className="read-only-label">View only</span>}
            </div>
          </article>
        ))}
        {!resources.length && <div className="empty-state card">No matching resources found.</div>}
      </div>
    </>
  );
}
