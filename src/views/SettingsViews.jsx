import { useEffect, useMemo, useState } from "react";
import { Archive, Clock3, Edit3, Plus, Save, Trash2 } from "lucide-react";
import { Badge, CardHeader } from "../components/Common.jsx";
import { MAX_PAYMENT_DEADLINE_HOURS, MIN_PAYMENT_DEADLINE_HOURS } from "../store/shared.js";
import { WORKFLOW_CONDITIONS } from "../workflows.js";
export { OfficeSettingsView } from "./settings/OfficeSettingsView.jsx";

const RESOURCE_TYPES = ["Facility", "Vehicle", "Equipment"];

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
  const [activeTab, setActiveTab] = useState("workflows");
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
    <div className="workflow-settings">
      <div className="workflow-tabs" role="tablist" aria-label="Approval settings">
        {[
          ["workflows", "Workflows"],
          ["requirements", "Requirements"],
          ["payment", "Payment settings"],
        ].map(([id, label], index, tabs) => (
          <button
            key={id}
            id={`settings-tab-${id}`}
            role="tab"
            type="button"
            aria-selected={activeTab === id}
            aria-controls={`settings-panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => setActiveTab(id)}
            onKeyDown={(event) => {
              const offsets = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
              if (!(event.key in offsets)) return;
              event.preventDefault();
              const next = tabs[(index + offsets[event.key] + tabs.length) % tabs.length][0];
              setActiveTab(next);
              document.getElementById(`settings-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form className="workflow-panel workflow-payment" id="settings-panel-payment" role="tabpanel" aria-labelledby="settings-tab-payment" hidden={activeTab !== "payment"} onSubmit={submitPaymentSettings}>
        <CardHeader
          title="Payment expiration"
          subtitle="Default receipt-upload window for paid reservations."
        />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="payment-deadline-hours">Default window (hours)</label>
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
      <div id="settings-panel-workflows" role="tabpanel" aria-labelledby="settings-tab-workflows" hidden={activeTab !== "workflows"}>
        <form className="workflow-panel workflow-form" onSubmit={submit}>
          <CardHeader
            title={selectedId ? "Edit workflow" : "Create workflow"}
            subtitle="Sequence 1 runs first; equal later sequence numbers run in parallel."
          />
          <div className="form-grid workflow-details">
            <div className="field">
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
            <h3>Review steps <span>{draft.steps.length}</span></h3>
            {draft.steps.map((step, index) => (
              <div className="workflow-step-row" key={step.id}>
                <span className="workflow-step-number" aria-label={`Step ${index + 1}`}>{index + 1}</span>
                <div className="field">
                  <label htmlFor={`step-name-${step.id}`}>Step name</label>
                  <input
                    id={`step-name-${step.id}`}
                    className="input"
                    value={step.name}
                    onChange={(event) =>
                      updateStep(index, "name", event.target.value)
                    }
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor={`step-office-${step.id}`}>Approving office</label>
                  <select
                    id={`step-office-${step.id}`}
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
                  <label htmlFor={`step-sequence-${step.id}`}>Sequence</label>
                  <input
                    id={`step-sequence-${step.id}`}
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
                  <label htmlFor={`step-condition-${step.id}`}>Condition</label>
                  <select
                    id={`step-condition-${step.id}`}
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

        <section className="workflow-panel workflow-catalog">
          <CardHeader
            title="Configured workflows"
            subtitle="Resources keep their assigned template; new requests snapshot the active route."
          />
          <div className="table-wrap">
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
          </div>
        </section>
      </div>

      <section className="workflow-panel requirement-manager" id="settings-panel-requirements" role="tabpanel" aria-labelledby="settings-tab-requirements" hidden={activeTab !== "requirements"}>
        <CardHeader
          title="Additional requirements"
          subtitle="These options appear on the requester reservation form and can trigger workflow steps."
        />
        <div className="workflow-requirements-layout">
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
                  className="icon-button"
                  aria-label={`Edit ${option.label}`}
                  title="Edit requirement"
                  onClick={() => setSelectedRequirementId(option.id)}
                  type="button"
                >
                  <Edit3 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
