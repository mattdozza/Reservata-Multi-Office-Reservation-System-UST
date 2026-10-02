import ManagedForm from "../../components/ManagedForm.jsx";
import { useEffect, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Edit3, Plus, Save, Trash2, Upload } from "lucide-react";
import { Badge, CardHeader, EmptyState } from "../../components/Common.jsx";
import { PageTabs, TabPanel } from "../../components/PageTabs.jsx";
import ResourcePhoto from "../../components/ResourcePhoto.jsx";
import { prepareResourcePhoto } from "../../services/resourcePhotos.js";
import { MONTH_LABELS, monthCells, shiftMonth, WEEKDAY_LABELS } from "../../domain/reservations/requesterCalendar.js";
import { formatDate, todayIso, tomorrowIso } from "../../shared/utils.js";
import {
  allowedResourceTypes,
  effectivePaymentDeadlineHours,
  generateAssetTag,
  MAX_PAYMENT_DEADLINE_HOURS,
  MIN_PAYMENT_DEADLINE_HOURS,
  normalizeBlockedDates
} from "../../store/shared.js";

const RESOURCE_TYPES = ["Equipment", "Vehicle", "Visitor Service"];
const RESOURCE_STATUSES = [
  "Available",
  "Reserved",
  "In Use",
  "Under Maintenance",
  "Unavailable",
  "Archived",
];

function resourceDraft(resource, store) {
  const defaultType = (store && allowedResourceTypes(store.officeScope)?.[0]) || "Equipment";
  return resource ? structuredClone(resource) : {
    name: "",
    assetTag: store ? generateAssetTag(store.data.resources, store.officeScope, defaultType) : "",
    type: defaultType,
    location: "",
    serialNumber: "",
    tags: [],
    capacity: 1,
    status: "Available",
    requiresPayment: false,
    fee: 0,
    paymentDeadlineHours: "",
    driver: "Not applicable",
    openTime: "",
    closeTime: "",
    blockedDates: [],
    workflowTemplateId: "WF-BASIC",
    slotDuration: 60,
    minBookingHours: 1,
    maxBookingHours: 4,
    bufferMinutes: 0,
    maxAdvanceDays: 30,
  };
}

function ownerTierStep() {
  return { id: "OWNER", name: "Resource Owner Review", office: "$OWNER", sequence: 1, approvingBodyId: "" };
}

function emptyTierBuilder() {
  return { open: false, workflowId: "", name: "", steps: [ownerTierStep()] };
}

function isMaintenanceBlock(block) {
  return Boolean(block) && block.reason.trim().toLowerCase() === "maintenance";
}

const DAY_STATUS_LEGEND = [
  { key: "today", label: "Today" },
  { key: "available", label: "Available" },
  { key: "unavailable", label: "Unavailable" },
  { key: "blocked", label: "Blocked" },
  { key: "maintenance", label: "Maintenance" },
];

function AvailabilityCalendarCard({ store, resource, resourceId, onAction, onDraftBlockedDatesChange }) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState("");
  const cells = monthCells(month);
  const blockedByDate = new Map((resource.blockedDates || []).map((item) => [item.date, item]));
  const minDate = tomorrowIso();
  const selectedBlock = selectedDate ? blockedByDate.get(selectedDate) : null;
  const reservationsOn = (date) => (resourceId ? store.resourceReservationsOnDate(resourceId, date) : []);
  const selectedReservations = selectedDate ? reservationsOn(selectedDate) : [];
  const [monthYear, monthNumber] = month.split("-").map(Number);
  const activeChoice = selectedBlock ? (isMaintenanceBlock(selectedBlock) ? "maintenance" : "blocked") : "available";

  function selectDate(date) {
    if (date < minDate) return;
    setSelectedDate(date);
  }

  async function applyStatus(choice) {
    if (choice === activeChoice) return;
    if (!resourceId) {
      const current = resource.blockedDates || [];
      const withoutDate = current.filter((item) => item.date !== selectedDate);
      const next = choice === "available"
        ? withoutDate
        : normalizeBlockedDates([...withoutDate, { date: selectedDate, reason: choice === "maintenance" ? "Maintenance" : "" }]);
      onDraftBlockedDatesChange(next);
      return;
    }
    if (choice === "available") {
      await onAction(() => store.unblockResourceDate(resourceId, selectedDate), "Date unblocked.");
      return;
    }
    const conflicts = reservationsOn(selectedDate);
    await onAction(
      () => store.blockResourceDate(resourceId, selectedDate, choice === "maintenance" ? "Maintenance" : ""),
      conflicts.length
        ? `Date blocked. ${conflicts.length} existing reservation${conflicts.length === 1 ? "" : "s"} on this date may need follow-up.`
        : "Date blocked."
    );
  }

  return (
    <section className="card resource-editor-card availability-calendar">
      <CardHeader title="Availability calendar" subtitle="Select an upcoming date to set its availability." />
      <div className="availability-calendar-surface">
        <div className="availability-calendar-nav">
          <button className="icon-button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" type="button"><ChevronLeft aria-hidden="true" size={18} /></button>
          <strong>{MONTH_LABELS[monthNumber - 1]} {monthYear}</strong>
          <button className="icon-button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" type="button"><ChevronRight aria-hidden="true" size={18} /></button>
        </div>
        <div className="mini-calendar">
          {WEEKDAY_LABELS.map((day) => <div className="mini-calendar-head" key={day}>{day}</div>)}
          {cells.map((cell) => {
            if (!cell.inMonth) return <div className="mini-calendar-day muted" key={cell.key}>{cell.day}</div>;
            const block = blockedByDate.get(cell.date);
            const past = cell.date < minDate;
            const isToday = cell.date === todayIso();
            const dayReservations = !block ? reservationsOn(cell.date) : [];
            const stateClass = isToday ? "today" : isMaintenanceBlock(block) ? "maintenance" : block ? "blocked" : dayReservations.length ? "unavailable" : "available";
            return (
              <button
                className={`mini-calendar-day ${stateClass} ${cell.date === selectedDate ? "selected" : ""}`}
                onClick={() => selectDate(cell.date)}
                disabled={past}
                aria-label={`${formatDate(cell.date)}, ${stateClass}`}
                type="button"
                key={cell.key}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
        <ul className="mini-calendar-legend">
          {DAY_STATUS_LEGEND.map((item) => (
            <li key={item.key}>
              <span className={`mini-calendar-legend-swatch ${item.key}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      {selectedDate && (
        <div className="availability-calendar-selection">
          <p className="calendar-side-summary">{formatDate(selectedDate)}</p>
          <p className="calendar-side-hint">
            {selectedBlock ? (isMaintenanceBlock(selectedBlock) ? "Maintenance" : "Blocked") : "Available"}
          </p>
          {!!selectedReservations.length && (
            <p className="calendar-side-hint">{selectedReservations.length} existing reservation{selectedReservations.length === 1 ? "" : "s"} on this date.</p>
          )}
          <div className="day-status-toggle">
            <button className={activeChoice === "available" ? "primary-button" : "secondary-button"} onClick={() => applyStatus("available")} type="button">Available</button>
            <button className={activeChoice === "blocked" ? "primary-button" : "secondary-button"} onClick={() => applyStatus("blocked")} type="button">Block</button>
            <button className={activeChoice === "maintenance" ? "primary-button" : "secondary-button"} onClick={() => applyStatus("maintenance")} type="button">Maintenance</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ResourceTierBuilder({ store, builder, setBuilder }) {
  const [newTier, setNewTier] = useState(2);
  const steps = builder.steps;
  const highestTier = Math.max(1, ...steps.map((step) => Number(step.sequence) || 1));
  const tierOptions = Array.from({ length: highestTier + 1 }, (_, index) => index + 1);
  const newTierValue = Math.min(Math.max(2, Number(newTier) || 2), highestTier + 1);
  const otherOffices = store.data.offices.filter(
    (office) => office.status === "Active" && office.name !== store.officeScope,
  );

  const updateStep = (index, field, value) =>
    setBuilder((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, [field]: value } : step)),
    }));

  function addStep() {
    setBuilder((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          id: `STEP-${Date.now()}`,
          name: "Supporting Office Review",
          office: otherOffices[0]?.name || "OSG",
          sequence: newTierValue,
        },
      ],
    }));
  }

  function removeStep(index) {
    if (index === 0) return;
    setBuilder((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }));
  }

  return (
    <div className="field span-2 resource-tier-builder">
      <div className="field">
        <label htmlFor="resource-workflow-name">Workflow name</label>
        <input
          id="resource-workflow-name"
          className="input"
          value={builder.name}
          onChange={(event) => setBuilder((current) => ({ ...current, name: event.target.value }))}
          required
        />
      </div>
      <div className="workflow-step-editor">
        <h3>
          Approval tiers{" "}
          <span>{steps.length} step{steps.length === 1 ? "" : "s"} · {highestTier} tier{highestTier === 1 ? "" : "s"}</span>
        </h3>
        <p className="field-help workflow-tier-help">
          Tier 1 is the resource owner. Add another tier to route the request to another office; steps that share a tier are reviewed in parallel.
        </p>
        {steps.map((step, index) => (
          <div className="workflow-step-row workflow-step-row-compact" key={step.id}>
            <span className="workflow-step-number" aria-label={`Step ${index + 1}`}>{index + 1}</span>
            <div className="field">
              <label htmlFor={`tier-step-name-${step.id}`}>Step name</label>
              <input
                id={`tier-step-name-${step.id}`}
                className="input"
                value={step.name}
                onChange={(event) => updateStep(index, "name", event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`tier-step-office-${step.id}`}>Approving office</label>
              <select
                id={`tier-step-office-${step.id}`}
                className="select"
                value={step.office}
                disabled={index === 0}
                onChange={(event) => updateStep(index, "office", event.target.value)}
              >
                <option value="$OWNER">Resource Owner ({store.officeScope})</option>
                {otherOffices.map((office) => (
                  <option key={office.id} value={office.name}>{office.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`tier-step-tier-${step.id}`}>Approval tier</label>
              <select
                id={`tier-step-tier-${step.id}`}
                className="select"
                value={Number(step.sequence) || 1}
                disabled={index === 0}
                onChange={(event) => updateStep(index, "sequence", event.target.value)}
              >
                {index === 0 ? (
                  <option value={1}>Tier 1 · owner</option>
                ) : (
                  tierOptions
                    .filter((tier) => tier !== 1)
                    .map((tier) => (
                      <option key={tier} value={tier}>
                        Tier {tier}{tier === highestTier + 1 ? " (new)" : ""}
                      </option>
                    ))
                )}
              </select>
            </div>
            <button
              className="icon-button danger-icon"
              aria-label={`Remove ${step.name}`}
              disabled={index === 0}
              onClick={() => removeStep(index)}
              title={index === 0 ? "The owner review is required" : "Remove step"}
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <div className="workflow-add-step">
          <div className="field">
            <label htmlFor="resource-new-tier">Approval tier for the new step</label>
            <select
              id="resource-new-tier"
              className="select"
              value={newTierValue}
              onChange={(event) => setNewTier(event.target.value)}
            >
              {tierOptions
                .filter((tier) => tier !== 1)
                .map((tier) => (
                  <option key={tier} value={tier}>
                    Tier {tier}{tier === highestTier + 1 ? " (new tier)" : ""}
                  </option>
                ))}
            </select>
          </div>
          <button className="secondary-button icon-text-button" onClick={addStep} type="button">
            <Plus size={16} /> Add approval step
          </button>
          <small className="field-help workflow-add-step-note">
            Steps that share a tier are reviewed together in parallel.
          </small>
        </div>
      </div>
    </div>
  );
}

export function OfficeSettingsView({ store, onAction }) {
  const [activeTab, setActiveTab] = useState("inventory");
  const [photoError, setPhotoError] = useState("");
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const selected = store.officeResources.find((item) => item.id === selectedId);
  const [draft, setDraft] = useState(resourceDraft(null, store));
  const [tierBuilder, setTierBuilder] = useState(emptyTierBuilder());
  const workflows = store.data.approvalTemplates.filter(
    (item) => item.status === "Active",
  );
  const officeTypes = allowedResourceTypes(store.officeScope) || RESOURCE_TYPES;

  useEffect(() => {
    setDraft(resourceDraft(selected, store));
    setTierBuilder(emptyTierBuilder());
  }, [selectedId, store.officeScope, store.data.resources.length]);

  function update(field, value) {
    if (field === "type" && !selectedId) {
      const currentGeneratedTag = generateAssetTag(store.data.resources, store.officeScope, draft.type, selectedId);
      const nextGeneratedTag = generateAssetTag(store.data.resources, store.officeScope, value, selectedId);
      setDraft((current) => ({
        ...current,
        type: value,
        assetTag: !current.assetTag || current.assetTag === currentGeneratedTag ? nextGeneratedTag : current.assetTag,
      }));
      return;
    }
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleTierBuilder(checked) {
    if (!checked) {
      setTierBuilder((current) => ({ ...current, open: false }));
      return;
    }
    const currentWorkflow = store.data.approvalTemplates.find((item) => item.id === draft.workflowTemplateId);
    if (currentWorkflow && currentWorkflow.office === store.officeScope) {
      setTierBuilder({
        open: true,
        workflowId: currentWorkflow.id,
        name: currentWorkflow.name,
        steps: structuredClone(currentWorkflow.steps || [ownerTierStep()]),
      });
      return;
    }
    setTierBuilder({
      open: true,
      workflowId: "",
      name: `${draft.name || "Resource"} Approval`,
      steps: [ownerTierStep()],
    });
  }

  async function submit(event) {
    event.preventDefault();
    const previousIds = selectedId ? null : new Set(store.officeResources.map((item) => item.id));
    let createdWorkflowId = "";
    const saved = await onAction(
      async () => {
        let workflowTemplateId = draft.workflowTemplateId;
        if (tierBuilder.open) {
          const workflow = await store.saveWorkflow(
            {
              id: tierBuilder.workflowId || undefined,
              name: tierBuilder.name,
              resourceType: draft.type,
              status: "Active",
              office: store.officeScope || undefined,
              steps: tierBuilder.steps,
            },
            tierBuilder.workflowId || "",
          );
          workflowTemplateId = workflow.id;
          createdWorkflowId = workflow.id;
        }
        await store.saveResource({ ...draft, workflowTemplateId }, selectedId);
      },
      selectedId ? "Resource updated." : "Resource created.",
    );
    if (!saved) return;
    if (createdWorkflowId) {
      setTierBuilder((current) => ({ ...current, workflowId: createdWorkflowId }));
    }
    const created = previousIds && store.officeResources.find((item) => !previousIds.has(item.id));
    if (created) {
      setSelectedId(created.id);
      setDraft(resourceDraft(created, store));
      return;
    }
    setActiveTab("inventory");
    setSelectedId("");
    setDraft(resourceDraft(null, store));
  }

  async function archive() {
    if (
      !window.confirm(
        "Archive this resource? Requesters will no longer be able to reserve it.",
      )
    )
      return;
    const saved = await onAction(
      () => store.archiveResource(selectedId),
      "Resource archived.",
    );
    if (saved) setSelectedId("");
  }

  return (
    <div className="resource-settings">
      <PageTabs id="inventory" label="Resource management" tabs={[["inventory", "Office resources"], ["editor", selectedId ? "Edit resource" : "Add resource"]]} value={activeTab} onChange={setActiveTab} />
      <TabPanel id="inventory" name="editor" value={activeTab}>
      <ManagedForm onSubmit={submit} resetKey={selectedId} changed={Boolean(draft.photoData) || Boolean(selected && (draft.photoKey || "") !== (selected.photoKey || ""))}>
        <div className="resource-editor-heading">
          <h2>{selectedId ? (draft.name || "Edit resource") : "Add resource"}</h2>
          <p>{store.officeScope} inventory and booking configuration</p>
        </div>
        <div className="grid two-col wide-left">
          <div className="stack">
            <article className="card resource-editor-card">
              <CardHeader title="Basic information" subtitle="Identity, location and capacity of the resource." />
              <div className="form-grid">
                <div className="field span-2 resource-photo-editor">
                  <ResourcePhoto resource={draft} preview={draft.photoData} />
                  <div>
                    <label htmlFor="resource-photo">Resource photo</label>
                    <label className="secondary-button file-button icon-text-button">
                      <Upload size={16} /> Upload photo
                      <input id="resource-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={readingPhoto} aria-describedby="resource-photo-help" onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setReadingPhoto(true); setPhotoError("");
                        try { update("photoData", await prepareResourcePhoto(file)); }
                        catch (error) { setPhotoError(error.message); }
                        finally { setReadingPhoto(false); }
                      }} />
                    </label>
                    <p id="resource-photo-help" className="field-help">JPG, PNG, or WebP. Maximum 5 MB.</p>
                    {readingPhoto && <p role="status">Preparing photo...</p>}
                    {photoError && <p className="field-error" role="alert">{photoError}</p>}
                    {(draft.photoData || draft.photoKey) && <button className="secondary-button" type="button" onClick={() => { update("photoData", ""); update("photoKey", ""); }}>Remove photo</button>}
                  </div>
                </div>
                <div className="field span-2">
                  <label htmlFor="resource-name">Name</label>
                  <input
                    id="resource-name"
                    className="input"
                    value={draft.name}
                    onChange={(event) => update("name", event.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="resource-asset-tag">Asset tag</label>
                  <input
                    id="resource-asset-tag"
                    className="input"
                    value={draft.assetTag || ""}
                    onChange={(event) => update("assetTag", event.target.value)}
                    placeholder="EDTECH-PROJ-001"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="resource-serial-number">Serial number</label>
                  <input
                    id="resource-serial-number"
                    className="input"
                    value={draft.serialNumber || ""}
                    onChange={(event) => update("serialNumber", event.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="field">
                  <label htmlFor="resource-type">Type</label>
                  <select
                    id="resource-type"
                    className="select"
                    value={draft.type}
                    onChange={(event) => update("type", event.target.value)}
                  >
                    {officeTypes.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="resource-status">Status</label>
                  <select
                    id="resource-status"
                    className="select"
                    value={draft.status}
                    onChange={(event) => update("status", event.target.value)}
                  >
                    {RESOURCE_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="resource-location">Location</label>
                  <input
                    id="resource-location"
                    className="input"
                    value={draft.location}
                    onChange={(event) => update("location", event.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="resource-capacity">Capacity</label>
                  <input
                    id="resource-capacity"
                    className="input"
                    min="1"
                    type="number"
                    value={draft.capacity}
                    onChange={(event) => update("capacity", event.target.value)}
                    required
                  />
                </div>
                <div className="field span-2">
                  <label htmlFor="resource-tags">Tags</label>
                  <input
                    id="resource-tags"
                    className="input"
                    value={Array.isArray(draft.tags) ? draft.tags.join(", ") : draft.tags || ""}
                    onChange={(event) => update("tags", event.target.value)}
                    placeholder="AV, Portable, High demand"
                  />
                  <small className="field-help">Use commas to separate searchable labels.</small>
                </div>
              </div>
            </article>
            <article className="card resource-editor-card">
              <CardHeader title="Booking rules and payment" subtitle="Approval steps, fees and driver requirements." />
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="resource-slot-duration">Slot duration (minutes)</label>
                  <select
                    id="resource-slot-duration"
                    className="select"
                    value={draft.slotDuration}
                    onChange={(event) => update("slotDuration", Number(event.target.value))}
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>60 minutes</option>
                    <option value={90}>90 minutes</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="resource-buffer">Buffer time (minutes)</label>
                  <input
                    id="resource-buffer"
                    className="input"
                    type="number"
                    min="0"
                    max="120"
                    value={draft.bufferMinutes}
                    onChange={(event) => update("bufferMinutes", Number(event.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="resource-min-hours">Min booking (hours)</label>
                  <input
                    id="resource-min-hours"
                    className="input"
                    type="number"
                    min="0.5"
                    max="24"
                    step="0.5"
                    value={draft.minBookingHours}
                    onChange={(event) => update("minBookingHours", Number(event.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="resource-max-hours">Max booking (hours)</label>
                  <input
                    id="resource-max-hours"
                    className="input"
                    type="number"
                    min="0.5"
                    max="72"
                    step="0.5"
                    value={draft.maxBookingHours}
                    onChange={(event) => update("maxBookingHours", Number(event.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="resource-max-advance">Max advance booking (days)</label>
                  <input
                    id="resource-max-advance"
                    className="input"
                    type="number"
                    min="1"
                    max="365"
                    value={draft.maxAdvanceDays}
                    onChange={(event) => update("maxAdvanceDays", Number(event.target.value))}
                  />
                </div>
                <div className="field span-2">
                  <label htmlFor="resource-workflow">Approval workflow</label>
                  <select
                    id="resource-workflow"
                    className="select"
                    value={draft.workflowTemplateId}
                    disabled={tierBuilder.open}
                    onChange={(event) =>
                      update("workflowTemplateId", event.target.value)
                    }
                    required
                  >
                    {workflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                  <small className="field-help">
                    Choose a saved workflow, or build custom tiers for this resource below.
                  </small>
                </div>
                <label className="check-field span-2">
                  <input
                    checked={tierBuilder.open}
                    onChange={(event) => toggleTierBuilder(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Build custom approval tiers for this resource</span>
                </label>
                {tierBuilder.open && (
                  <ResourceTierBuilder store={store} builder={tierBuilder} setBuilder={setTierBuilder} />
                )}
                {draft.type === "Vehicle" && (
                  <div className="field span-2">
                    <label htmlFor="resource-driver">Driver requirement</label>
                    <select
                      id="resource-driver"
                      className="select"
                      value={draft.driver}
                      onChange={(event) => update("driver", event.target.value)}
                    >
                      <option>With Driver</option>
                      <option>Without Driver</option>
                    </select>
                  </div>
                )}
                <label className="check-field span-2">
                  <input
                    checked={Boolean(draft.requiresPayment)}
                    onChange={(event) =>
                      update("requiresPayment", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>Requires payment before confirmation</span>
                </label>
                {draft.requiresPayment && (
                  <div className="field">
                    <label htmlFor="resource-fee">Fee (PHP)</label>
                    <input
                      id="resource-fee"
                      className="input"
                      min="0"
                      type="number"
                      value={draft.fee}
                      onChange={(event) => update("fee", event.target.value)}
                    />
                  </div>
                )}
                {draft.requiresPayment && (
                  <div className="field">
                    <label htmlFor="resource-payment-window">Payment window (hours)</label>
                    <input
                      id="resource-payment-window"
                      className="input"
                      max={MAX_PAYMENT_DEADLINE_HOURS}
                      min={MIN_PAYMENT_DEADLINE_HOURS}
                      placeholder={`${store.settings.paymentDeadlineHours} hours`}
                      type="number"
                      value={draft.paymentDeadlineHours ?? ""}
                      onChange={(event) =>
                        update("paymentDeadlineHours", event.target.value)
                      }
                    />
                    <small className="field-help">Blank uses the Super Admin default.</small>
                  </div>
                )}
              </div>
            </article>
            <article className="card resource-editor-card form-actions-card">
              <div className="resource-editor-actions">
                {selectedId && (
                  <button className="danger-button icon-text-button" onClick={archive} type="button">
                    <Archive size={16} /> Archive resource
                  </button>
                )}
                <div className="resource-editor-actions-right">
                  {selectedId && (
                    <button className="secondary-button" onClick={() => setSelectedId("")} type="button">
                      Cancel
                    </button>
                  )}
                  <button className="primary-button icon-text-button" type="submit" disabled={readingPhoto}>
                    <Save size={16} /> {selectedId ? "Save changes" : "Add Resource"}
                  </button>
                </div>
              </div>
            </article>
          </div>
          <div className="stack">
            <AvailabilityCalendarCard
              store={store}
              resource={selectedId && selected ? selected : draft}
              resourceId={selectedId && selected ? selectedId : ""}
              onAction={onAction}
              onDraftBlockedDatesChange={(blockedDates) => update("blockedDates", blockedDates)}
            />
            <article className="card resource-editor-card">
              <CardHeader title="Daily availability" subtitle="Hours when this resource can be booked." />
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="resource-open-time">Available from</label>
                  <input
                    id="resource-open-time"
                    className="input"
                    type="time"
                    value={draft.openTime || ""}
                    onChange={(event) => update("openTime", event.target.value)}
                  />
                  <small className="field-help">Blank uses the default 08:00.</small>
                </div>
                <div className="field">
                  <label htmlFor="resource-close-time">Available until</label>
                  <input
                    id="resource-close-time"
                    className="input"
                    type="time"
                    value={draft.closeTime || ""}
                    onChange={(event) => update("closeTime", event.target.value)}
                  />
                  <small className="field-help">Blank uses the default 17:00.</small>
                </div>
              </div>
            </article>
          </div>
        </div>
      </ManagedForm>
      </TabPanel>
      <TabPanel id="inventory" name="inventory" value={activeTab}>
      <section className="card table-wrap">
        <CardHeader
          title="Office resources"
          subtitle="Select a record to maintain its details, status, fee, and workflow."
        />
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Asset Tag</th>
              <th>Type</th>
              <th>Status</th>
              <th>Workflow</th>
              <th>Payment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {store.officeResources.map((resource) => (
              <tr key={resource.id}>
                <td>
                  <strong>{resource.name}</strong>
                  <br />
                  <small>
                    {resource.location}
                    {resource.serialNumber && ` · SN: ${resource.serialNumber}`}
                    {resource.tags?.length ? ` · ${resource.tags.join(", ")}` : ""}
                  </small>
                </td>
                <td>{resource.assetTag}</td>
                <td>{resource.type}</td>
                <td>
                  <Badge status={resource.status} />
                </td>
                <td>
                  {workflows.find(
                    (item) => item.id === resource.workflowTemplateId,
                  )?.name || "Basic Resource Approval"}
                </td>
                <td>
                  {resource.requiresPayment
                    ? `PHP ${Number(resource.fee || 0).toLocaleString()} / ${effectivePaymentDeadlineHours(resource, store.settings)}h`
                    : "None"}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${resource.name}`}
                    title="Edit resource"
                    onClick={() => { setSelectedId(resource.id); setActiveTab("editor"); }}
                    type="button"
                  >
                    <Edit3 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!store.officeResources.length && (
          <EmptyState>No resources belong to this office yet.</EmptyState>
        )}
      </section>
      </TabPanel>
    </div>
  );
}
