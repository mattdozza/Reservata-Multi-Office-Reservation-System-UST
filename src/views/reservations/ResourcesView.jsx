import { useEffect, useState } from "react";
import ResourcePhoto from "../../components/ResourcePhoto.jsx";
import { Badge } from "../../components/Common.jsx";
import { sortBy, tomorrowIso } from "../../shared/utils.js";

const RESOURCE_TYPES = ["Equipment", "Vehicle", "Visitor Service"];
const CATEGORY_ORDER = ["Equipment", "Vehicle", "Visitor Service"];
const RESOURCE_STATUS_FILTERS = ["Available", "Unavailable"];
// Four columns by two rows per page.
const RESOURCE_PAGE_SIZE = 8;

export function ResourcesView({ store, onAction, onNavigate, onReserve }) {
  const [filter, setFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [office, setOffice] = useState("All");
  const [capacity, setCapacity] = useState("");
  const [payment, setPayment] = useState("All");
  const [schedule, setSchedule] = useState({ date: "", start: "08:00", end: "09:00" });
  const [availabilityOnly, setAvailabilityOnly] = useState(false);
  const [availability, setAvailability] = useState({});
  const [page, setPage] = useState(1);
  const scheduleValid = schedule.date >= tomorrowIso() && schedule.start && schedule.end && schedule.start < schedule.end;
  const role = store.session.activeRole;
  const isStudent = role === "requester" && store.currentUser.requesterType === "Student";
  const allowedTypes = role === "requester"
    ? (isStudent ? ["Equipment"] : ["Equipment", "Vehicle"])
    : null;
  const typeOptions = allowedTypes ?? RESOURCE_TYPES;

  const resources = (() => {
    let items = [...store.data.resources];
    if (allowedTypes) items = items.filter((item) => allowedTypes.includes(item.type));
    if (role === "officeAdmin") items = store.officeResources;
    const normalized = query.trim().toLowerCase();
    items = items.filter((item) => {
      const matchesType = filter === "All" || item.type === filter;
      const matchesStatus = statusFilter === "All" || (statusFilter === "Available" ? item.status === "Available" : item.status !== "Available");
      const matchesQuery = `${item.name} ${item.office} ${item.location} ${item.assetTag || ""} ${item.serialNumber || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(normalized);
      return matchesType && matchesStatus && matchesQuery
        && (office === "All" || item.office === office)
        && (!capacity || Number(item.capacity) >= Number(capacity))
        && (payment === "All" || Boolean(item.requiresPayment) === (payment === "Paid"));
    });
    if (sort === "status") items = sortBy(items, "status");
    else if (sort === "office") items = sortBy(items, "office");
    else items = sortBy(items, "name");
    return items;
  })();
  const resourceKey = resources.map((item) => `${item.id}:${item.status}`).join("|");
  const scheduleKey = `${schedule.date}/${schedule.start}/${schedule.end}`;
  useEffect(() => {
    let active = true;
    setAvailability({});
    if (!scheduleValid) return () => { active = false; };
    async function check() {
      for (let index = 0; index < resources.length && active; index += 4) {
        const results = await Promise.allSettled(resources.slice(index, index + 4).map(async (resource) => [resource.id, await store.fetchResourceAvailability(resource.id, schedule.date, schedule.start, schedule.end)]));
        if (!active) return;
        setAvailability((current) => ({ ...current, ...Object.fromEntries(results.map((result, offset) => [resources[index + offset].id, { key: scheduleKey, status: result.status === "fulfilled" ? result.value[1].status : "error" }])) }));
      }
    }
    check();
    return () => { active = false; };
  }, [resourceKey, scheduleKey, scheduleValid, store]);
  useEffect(() => {
    setPage(1);
  }, [filter, statusFilter, query, office, capacity, payment, availabilityOnly, sort, schedule.date, schedule.start, schedule.end]);
  const visible = availabilityOnly && scheduleValid ? resources.filter((resource) => availability[resource.id]?.key === scheduleKey && availability[resource.id]?.status === "available") : resources;
  const pageCount = Math.max(1, Math.ceil(visible.length / RESOURCE_PAGE_SIZE));
  const activePage = Math.min(Math.max(page, 1), pageCount);
  const pagedItems = visible.slice((activePage - 1) * RESOURCE_PAGE_SIZE, activePage * RESOURCE_PAGE_SIZE);
  const clearFilters = () => {
    setOffice("All");
    setCapacity("");
    setPayment("All");
    setSchedule({ date: "", start: "08:00", end: "09:00" });
    setAvailabilityOnly(false);
    setQuery("");
    setFilter("All");
    setStatusFilter("All");
  };
  const filtersActive = Boolean(query.trim()) || filter !== "All" || statusFilter !== "All" || office !== "All"
    || Boolean(capacity) || payment !== "All" || availabilityOnly || Boolean(schedule.date);
  const groupedCategories = (() => {
    const extraTypes = [...new Set(pagedItems.map((item) => item.type))].filter((type) => !CATEGORY_ORDER.includes(type)).sort();
    return [...CATEGORY_ORDER, ...extraTypes]
      .map((type) => ({ type, items: pagedItems.filter((item) => item.type === type) }))
      .filter((group) => group.items.length);
  })();

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-group resource-filter-bar">
          <input
            className="input resource-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search resources"
            aria-label="Search resources"
          />
          <select className="select resource-filter-select" value={office} onChange={(event) => setOffice(event.target.value)} aria-label="Filter by office">
            <option value="All">All Offices</option>
            {[...new Set(store.data.resources.map((item) => item.office))].sort().map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="select resource-filter-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by type">
            <option value="All">All Types</option>
            {typeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select className="select resource-filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter resource status">
            <option value="All">All Statuses</option>
            {RESOURCE_STATUS_FILTERS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          {role !== "requester" && (
            <select className="select status-filter" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort resources">
              <option value="name">Sort by name</option>
              <option value="office">Sort by office</option>
              <option value="status">Sort by status</option>
            </select>
          )}
          {role !== "requester" && (
            <button className="secondary-button" type="button" onClick={clearFilters} disabled={!filtersActive}>Clear filters</button>
          )}
          {role === "officeAdmin" && (
            <button className="primary-button" onClick={() => onNavigate("officeSettings")} type="button">
              Manage Resources
            </button>
          )}
        </div>
      </div>
      {role !== "requester" && (
        <div className="resource-filter-panel">
          <div className="field"><label htmlFor="browse-capacity">Minimum capacity</label><input id="browse-capacity" className="input" type="number" min="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></div>
          <div className="field"><label htmlFor="browse-payment">Payment</label><select id="browse-payment" className="select" value={payment} onChange={(event) => setPayment(event.target.value)}><option>All</option><option>Free</option><option>Paid</option></select></div>
          <div className="field"><label htmlFor="browse-date">Reservation date</label><input id="browse-date" className="input" type="date" min={tomorrowIso()} value={schedule.date} onChange={(event) => setSchedule((current) => ({ ...current, date: event.target.value }))} /></div>
          <div className="field"><label htmlFor="browse-start">Start time</label><input id="browse-start" className="input" type="time" value={schedule.start} onChange={(event) => setSchedule((current) => ({ ...current, start: event.target.value }))} /></div>
          <div className="field"><label htmlFor="browse-end">End time</label><input id="browse-end" className="input" type="time" value={schedule.end} onChange={(event) => setSchedule((current) => ({ ...current, end: event.target.value }))} /></div>
          <label className="check-field"><input type="checkbox" checked={availabilityOnly} disabled={!scheduleValid} onChange={(event) => setAvailabilityOnly(event.target.checked)} /><span>Available for this schedule only</span></label>
          {schedule.date && !scheduleValid && <p className="field-error">Choose tomorrow or later, with an end time after the start time.</p>}
        </div>
      )}
      {groupedCategories.map((group) => (
        <section className="resource-category" key={group.type}>
          <h2 className="resource-category-heading">
            {group.type}
            <span>{group.items.length} {group.items.length === 1 ? "resource" : "resources"}</span>
          </h2>
          <div className="grid resource-grid">
            {group.items.map((resource) => (
              <article className="card resource-card" key={resource.id}>
                <ResourcePhoto resource={resource} />
                <div className="resource-body">
                  <Badge status={resource.status} />
                  <h3>{resource.name}</h3>
                  <p>{resource.requiresPayment ? `Payment required: PHP ${Number(resource.fee || 0).toLocaleString()}` : "Free to reserve"}</p>
                  {scheduleValid && <p className="schedule-availability" role="status">{availability[resource.id]?.key !== scheduleKey ? "Checking this schedule..." : availability[resource.id].status === "available" ? "Available for this schedule" : availability[resource.id].status === "error" ? "Schedule could not be checked" : "Unavailable for this schedule"}</p>}
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
                      onClick={() => onReserve(resource.id, scheduleValid ? schedule : null)}
                      disabled={resource.status !== "Available" || Boolean(schedule.date && (!scheduleValid || availability[resource.id]?.key !== scheduleKey || availability[resource.id]?.status !== "available"))}
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
          </div>
        </section>
      ))}
      {!visible.length && <div className="empty-state card">{scheduleValid && resources.some((resource) => availability[resource.id]?.key !== scheduleKey) ? "Checking resource availability..." : "No matching resources found."}</div>}
      {!!visible.length && (
        <nav className="resource-pagination" aria-label="Resource pages">
          <button className="secondary-button" disabled={activePage === 1} onClick={() => setPage(activePage - 1)} type="button">Previous</button>
          <div className="resource-pagination-pages">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
              <button
                className={`resource-pagination-number ${number === activePage ? "active" : ""}`}
                aria-current={number === activePage ? "page" : undefined}
                onClick={() => setPage(number)}
                type="button"
                key={number}
              >
                {number}
              </button>
            ))}
          </div>
          <button className="secondary-button" disabled={activePage === pageCount} onClick={() => setPage(activePage + 1)} type="button">Next</button>
        </nav>
      )}
    </>
  );
}
