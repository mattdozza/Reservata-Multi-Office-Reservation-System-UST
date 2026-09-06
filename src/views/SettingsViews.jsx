import { useEffect, useMemo, useState } from "react";
import { Archive, Clock3, Edit3, Plus, Save, Trash2 } from "lucide-react";
import { Badge, CardHeader, EmptyState } from "../components/Common.jsx";
import { effectivePaymentDeadlineHours, generateAssetTag, MAX_PAYMENT_DEADLINE_HOURS, MIN_PAYMENT_DEADLINE_HOURS } from "../store/shared.js";
import { WORKFLOW_CONDITIONS } from "../workflows.js";

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
  return (
    resource ? structuredClone(resource) : {
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
    }
  );
}

export function OfficeSettingsView({ store, onAction }) {
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
    <div className="settings-layout">
      <form className="card form-card" onSubmit={submit}>
        <CardHeader
          title={selectedId ? "Edit resource" : "Add resource"}
          subtitle={`${store.officeScope} inventory and booking configuration`}
        />
        <div className="form-grid">
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
          <div className="field span-2">
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
          <div className="field">
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
              <label htmlFor="resource-payment-window">Payment window</label>
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
          <button className="primary-button icon-text-button" type="submit">
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
      </form>

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
                    onClick={() => setSelectedId(resource.id)}
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
    </div>
  );
}

function workflowDraft(template) {
  return template
    ? structuredClone(template)
    : {
        name: "",
        resourceType: "All",
        status: "Active",
        steps: [
          {
            id: "OWNER",
            name: "Resource Owner Review",
            office: "$OWNER",
            sequence: 1,
            condition: "always",
          },
        ],
      };
}

function requirementDraft(option) {
  return option
    ? structuredClone(option)
    : {
        id: "",
        label: "",
        help: "",
        status: "Active",
      };
}

export function WorkflowsView({ store, onAction }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = store.data.approvalTemplates.find(
    (item) => item.id === selectedId,
  );
  const [draft, setDraft] = useState(workflowDraft());
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const selectedRequirement = store.allRequirementOptions.find(
    (item) => item.id === selectedRequirementId,
  );
  const [requirementDraftState, setRequirementDraftState] =
    useState(requirementDraft());
  const [paymentDeadlineHours, setPaymentDeadlineHours] = useState(
    store.settings.paymentDeadlineHours,
  );
  const offices = useMemo(
    () => store.data.offices.filter((item) => item.status === "Active"),
    [store.data.offices],
  );
  const conditionOptions = [
    ["always", "Always required"],
    ...store.allRequirementOptions.map((option) => [
      option.id,
      `${option.label}${option.status === "Archived" ? " (archived)" : ""}`,
    ]),
    ...WORKFLOW_CONDITIONS.filter(
      ([value]) =>
        value !== "always" &&
        !store.allRequirementOptions.some((option) => option.id === value),
    ),
  ];

  useEffect(() => setDraft(workflowDraft(selected)), [selected]);
  useEffect(
    () => setPaymentDeadlineHours(store.settings.paymentDeadlineHours),
    [store.settings.paymentDeadlineHours],
  );
  useEffect(
    () => setRequirementDraftState(requirementDraft(selectedRequirement)),
    [selectedRequirement],
  );

  function updateStep(index, field, value) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, [field]: value } : step,
      ),
    }));
  }

  function addStep() {
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          id: `STEP-${Date.now()}`,
          name: "Supporting Office Review",
          office: offices[0]?.name || "OSG",
          sequence: 2,
          condition: "always",
        },
      ],
    }));
  }

  function removeStep(index) {
    if (index === 0) return;
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    const saved = await onAction(
      () => store.saveWorkflow(draft, selectedId),
      selectedId ? "Approval workflow updated." : "Approval workflow created.",
    );
    if (saved) {
      setSelectedId("");
      setDraft(workflowDraft());
    }
  }

  async function archive() {
    if (
      !window.confirm(
        "Archive this approval workflow? Resources using it must be moved first.",
      )
    )
      return;
    const saved = await onAction(
      () => store.archiveWorkflow(selectedId),
      "Approval workflow archived.",
    );
    if (saved) setSelectedId("");
  }

  async function submitRequirement(event) {
    event.preventDefault();
    const saved = await onAction(
      () =>
        store.saveRequirementOption(
          requirementDraftState,
          selectedRequirementId,
        ),
      selectedRequirementId
        ? "Additional requirement updated."
        : "Additional requirement created.",
    );
    if (saved) {
      setSelectedRequirementId("");
      setRequirementDraftState(requirementDraft());
    }
  }

  async function archiveRequirement() {
    if (
      !window.confirm(
        "Archive this additional requirement? It will no longer appear on new reservation forms.",
      )
    )
      return;
    const saved = await onAction(
      () => store.archiveRequirementOption(selectedRequirementId),
      "Additional requirement archived.",
    );
    if (saved) setSelectedRequirementId("");
  }

  async function submitPaymentSettings(event) {
    event.preventDefault();
    await onAction(
      () => store.updatePaymentDeadlineSettings(paymentDeadlineHours),
      "Default payment window updated.",
    );
  }

  return (
    <div className="settings-layout workflow-settings">
      <form className="card form-card" onSubmit={submitPaymentSettings}>
        <CardHeader
          title="Payment expiration"
          subtitle="Default receipt-upload window for paid reservations."
        />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="payment-deadline-hours">Default window</label>
            <input
              id="payment-deadline-hours"
              className="input"
              max={MAX_PAYMENT_DEADLINE_HOURS}
              min={MIN_PAYMENT_DEADLINE_HOURS}
              type="number"
              value={paymentDeadlineHours}
              onChange={(event) => setPaymentDeadlineHours(event.target.value)}
              required
            />
            <small className="field-help">The deadline is also capped by the reservation start time.</small>
          </div>
        </div>
        <div className="split-actions form-actions">
          <button className="primary-button icon-text-button" type="submit">
            <Clock3 size={16} /> Save Payment Window
          </button>
        </div>
      </form>
      <form className="card form-card" onSubmit={submit}>
        <CardHeader
          title={selectedId ? "Edit workflow" : "Create workflow"}
          subtitle="Sequence 1 runs first; equal later sequence numbers run in parallel."
        />
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="workflow-name">Workflow name</label>
            <input
              id="workflow-name"
              className="input"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="field">
            <label htmlFor="workflow-type">Resource type</label>
            <select
              id="workflow-type"
              className="select"
              value={draft.resourceType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  resourceType: event.target.value,
                }))
              }
            >
              <option>All</option>
              {RESOURCE_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="workflow-status">Status</label>
            <select
              id="workflow-status"
              className="select"
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value,
                }))
              }
            >
              <option>Active</option>
              <option>Archived</option>
            </select>
          </div>
        </div>

        <div className="workflow-step-editor">
          {draft.steps.map((step, index) => (
            <div className="workflow-step-row" key={step.id}>
              <div className="field">
                <label>Step name</label>
                <input
                  className="input"
                  value={step.name}
                  onChange={(event) =>
                    updateStep(index, "name", event.target.value)
                  }
                  required
                />
              </div>
              <div className="field">
                <label>Approving office</label>
                <select
                  className="select"
                  value={step.office}
                  disabled={index === 0}
                  onChange={(event) =>
                    updateStep(index, "office", event.target.value)
                  }
                >
                  <option value="$OWNER">Resource Owner</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.name}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Sequence</label>
                <input
                  className="input"
                  min="1"
                  type="number"
                  value={step.sequence}
                  disabled={index === 0}
                  onChange={(event) =>
                    updateStep(index, "sequence", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label>Condition</label>
                <select
                  className="select"
                  value={step.condition}
                  disabled={index === 0}
                  onChange={(event) =>
                    updateStep(index, "condition", event.target.value)
                  }
                >
                  {conditionOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="icon-button danger-icon"
                aria-label={`Remove ${step.name}`}
                disabled={index === 0}
                onClick={() => removeStep(index)}
                title={
                  index === 0 ? "The owner review is required" : "Remove step"
                }
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="split-actions form-actions">
          <button
            className="secondary-button icon-text-button"
            onClick={addStep}
            type="button"
          >
            <Plus size={16} /> Add Review Step
          </button>
          <button className="primary-button icon-text-button" type="submit">
            <Save size={16} />{" "}
            {selectedId ? "Save Workflow" : "Create Workflow"}
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
      </form>

      <section className="card table-wrap">
        <CardHeader
          title="Configured workflows"
          subtitle="Resources keep their assigned template; new requests snapshot the active route."
        />
        <table>
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Type</th>
              <th>Steps</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {store.data.approvalTemplates.map((workflow) => (
              <tr key={workflow.id}>
                <td>
                  <strong>{workflow.name}</strong>
                  <br />
                  <small>{workflow.id}</small>
                </td>
                <td>{workflow.resourceType}</td>
                <td>{workflow.steps.length}</td>
                <td>
                  <Badge status={workflow.status} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${workflow.name}`}
                    title="Edit workflow"
                    onClick={() => setSelectedId(workflow.id)}
                    type="button"
                  >
                    <Edit3 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card requirement-manager">
        <CardHeader
          title="Additional requirements"
          subtitle="These options appear on the requester reservation form and can trigger workflow steps."
        />
        <form className="form-grid" onSubmit={submitRequirement}>
          <div className="field">
            <label htmlFor="requirement-key">Requirement key</label>
            <input
              id="requirement-key"
              className="input"
              disabled={Boolean(selectedRequirementId)}
              placeholder="cateringRequired"
              value={requirementDraftState.id}
              onChange={(event) =>
                setRequirementDraftState((current) => ({
                  ...current,
                  id: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="field">
            <label htmlFor="requirement-status">Status</label>
            <select
              id="requirement-status"
              className="select"
              value={requirementDraftState.status}
              onChange={(event) =>
                setRequirementDraftState((current) => ({
                  ...current,
                  status: event.target.value,
                }))
              }
            >
              <option>Active</option>
              <option>Archived</option>
            </select>
          </div>
          <div className="field span-2">
            <label htmlFor="requirement-label">Label</label>
            <input
              id="requirement-label"
              className="input"
              value={requirementDraftState.label}
              onChange={(event) =>
                setRequirementDraftState((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="field span-2">
            <label htmlFor="requirement-help">Help text</label>
            <textarea
              id="requirement-help"
              className="textarea"
              value={requirementDraftState.help}
              onChange={(event) =>
                setRequirementDraftState((current) => ({
                  ...current,
                  help: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="split-actions form-actions span-2">
            <button className="primary-button icon-text-button" type="submit">
              <Save size={16} />{" "}
              {selectedRequirementId ? "Save Requirement" : "Add Requirement"}
            </button>
            {selectedRequirementId && (
              <button
                className="secondary-button"
                onClick={() => setSelectedRequirementId("")}
                type="button"
              >
                Cancel
              </button>
            )}
            {selectedRequirementId && (
              <button
                className="danger-button icon-text-button"
                onClick={archiveRequirement}
                type="button"
              >
                <Archive size={16} /> Archive
              </button>
            )}
          </div>
        </form>
        <div className="requirement-list">
          {store.allRequirementOptions.map((option) => (
            <div className="list-item" key={option.id}>
              <div>
                <Badge status={option.status || "Active"} />
                <h3 className="item-title">{option.label}</h3>
                <p>
                  {option.id} · {option.help}
                </p>
              </div>
              <button
                className="secondary-button"
                onClick={() => setSelectedRequirementId(option.id)}
                type="button"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
