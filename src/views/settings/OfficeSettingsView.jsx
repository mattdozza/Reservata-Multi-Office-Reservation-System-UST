import ManagedForm from "../../components/ManagedForm.jsx";
import { useEffect, useState } from "react";
import { Archive, Edit3, Save } from "lucide-react";
import { Badge, CardHeader, EmptyState } from "../../components/Common.jsx";
import { PageTabs, TabPanel } from "../../components/PageTabs.jsx";
import ResourcePhoto from "../../components/ResourcePhoto.jsx";
import { prepareResourcePhoto } from "../../services/resourcePhotos.js";
import {
  effectivePaymentDeadlineHours,
  generateAssetTag,
  MAX_PAYMENT_DEADLINE_HOURS,
  MIN_PAYMENT_DEADLINE_HOURS
} from "../../store/shared.js";

const RESOURCE_TYPES = ["Facility", "Vehicle", "Equipment"];
const RESOURCE_STATUSES = [
  "Available",
  "Reserved",
  "In Use",
  "Under Maintenance",
  "Unavailable",
  "Archived",
];

function resourceDraft(resource, store) {
  return resource ? structuredClone(resource) : {
    name: "",
    assetTag: store ? generateAssetTag(store.data.resources, store.officeScope, "Equipment") : "",
    type: "Equipment",
    location: "",
    serialNumber: "",
    tags: [],
    capacity: 1,
    status: "Available",
    requiresPayment: false,
    fee: 0,
    paymentDeadlineHours: "",
    driver: "Not applicable",
    workflowTemplateId: "WF-BASIC",
  };
}

export function OfficeSettingsView({ store, onAction }) {
  const [activeTab, setActiveTab] = useState("inventory");
  const [photoError, setPhotoError] = useState("");
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const selected = store.officeResources.find((item) => item.id === selectedId);
  const [draft, setDraft] = useState(resourceDraft(null, store));
  const workflows = store.data.approvalTemplates.filter(
    (item) => item.status === "Active",
  );

  useEffect(() => setDraft(resourceDraft(selected, store)), [selectedId, store.officeScope, store.data.resources.length]);

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

  async function submit(event) {
    event.preventDefault();
    const saved = await onAction(
      () => store.saveResource(draft, selectedId),
      selectedId ? "Resource updated." : "Resource created.",
    );
    if (saved) {
      setActiveTab("inventory");
      setSelectedId("");
      setDraft(resourceDraft(null, store));
    }
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
      <ManagedForm className="card form-card" onSubmit={submit} resetKey={selectedId} changed={Boolean(draft.photoData) || Boolean(selected && (draft.photoKey || "") !== (selected.photoKey || ""))}>
        <CardHeader
          title={selectedId ? "Edit resource" : "Add resource"}
          subtitle={`${store.officeScope} inventory and booking configuration`}
        />
        <div className="form-grid">
          <div className="field span-2 resource-photo-editor">
            <ResourcePhoto resource={draft} preview={draft.photoData} />
            <div>
              <label htmlFor="resource-photo">Resource photo</label>
              <input id="resource-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={readingPhoto} aria-describedby="resource-photo-help" onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setReadingPhoto(true); setPhotoError("");
                try { update("photoData", await prepareResourcePhoto(file)); }
                catch (error) { setPhotoError(error.message); }
                finally { setReadingPhoto(false); }
              }} />
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
            <label htmlFor="resource-type">Type</label>
            <select
              id="resource-type"
              className="select"
              value={draft.type}
              onChange={(event) => update("type", event.target.value)}
            >
              {RESOURCE_TYPES.map((type) => (
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
          <div className="field span-2">
            <label htmlFor="resource-workflow">Approval workflow</label>
            <select
              id="resource-workflow"
              className="select"
              value={draft.workflowTemplateId}
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
          </div>
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
          {draft.type === "Vehicle" && (
            <div className="field">
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
        </div>
        <div className="split-actions form-actions">
          <button className="primary-button icon-text-button" type="submit" disabled={readingPhoto}>
            <Save size={16} /> {selectedId ? "Save Changes" : "Add Resource"}
          </button>
          {selectedId && (
            <button
              className="secondary-button"
              onClick={() => setSelectedId("")}
              type="button"
            >
              Cancel
            </button>
          )}
          {selectedId && (
            <button
              className="danger-button icon-text-button"
              onClick={archive}
              type="button"
            >
              <Archive size={16} /> Archive
            </button>
          )}
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
