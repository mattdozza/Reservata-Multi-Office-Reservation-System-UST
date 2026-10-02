import ManagedForm from "../../components/ManagedForm.jsx";
import { confirmLeaveForms } from "../../shared/formSafety.js";
import { useEffect, useMemo, useState } from "react";
import { Archive, Clock3, Edit3, Plus, Save, Trash2 } from "lucide-react";
import { Badge, CardHeader } from "../../components/Common.jsx";
import { MAX_PAYMENT_DEADLINE_HOURS, MAX_PAYMENT_INSTRUCTIONS_LENGTH, MAX_PAYMENT_STEPS, MAX_PAYMENT_STEP_FIELD_LENGTH, MIN_PAYMENT_DEADLINE_HOURS, MIN_PAYMENT_STEP_TITLE_LENGTH } from "../../store/shared.js";
export { OfficeSettingsView } from "./OfficeSettingsView.jsx";

const RESOURCE_TYPES = ["Equipment", "Vehicle", "Visitor Service"];

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
          },
        ],
      };
}

export function WorkflowsView({ store, onAction }) {
  const [activeTab, setActiveTab] = useState("workflows");
  const [selectedId, setSelectedId] = useState("");
  const selected = store.data.approvalTemplates.find(
    (item) => item.id === selectedId,
  );
  const [draft, setDraft] = useState(workflowDraft());
  const [paymentDeadlineHours, setPaymentDeadlineHours] = useState(
    store.settings.paymentDeadlineHours,
  );
  const [paymentInstructions, setPaymentInstructions] = useState(
    store.settings.paymentInstructions,
  );
  const [paymentSteps, setPaymentSteps] = useState(
    store.settings.paymentSteps.map((step) => ({ ...step })),
  );
  const offices = useMemo(
    () => store.data.offices.filter((item) => item.status === "Active"),
    [store.data.offices],
  );
  // Approval tiers map to the workflow sequence: tier 1 is the owner review,
  // higher tiers run in order, and steps that share a tier run in parallel.
  const [addTier, setAddTier] = useState(2);
  const highestTier = Math.max(
    1,
    ...draft.steps.map((step) => Number(step.sequence) || 1),
  );
  const tierOptions = Array.from(
    { length: highestTier + 1 },
    (_, index) => index + 1,
  );
  const addTierValue = Math.min(
    Math.max(2, Number(addTier) || 2),
    highestTier + 1,
  );

  useEffect(() => setDraft(workflowDraft(selected)), [selected]);
  useEffect(
    () => setPaymentDeadlineHours(store.settings.paymentDeadlineHours),
    [store.settings.paymentDeadlineHours],
  );
  useEffect(
    () => setPaymentInstructions(store.settings.paymentInstructions),
    [store.settings.paymentInstructions],
  );
  useEffect(
    () => setPaymentSteps(store.settings.paymentSteps.map((step) => ({ ...step }))),
    [store.settings.paymentSteps],
  );

  function updatePaymentStep(index, field, value) {
    setPaymentSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, [field]: value } : step,
      ),
    );
  }

  function addPaymentStep() {
    setPaymentSteps((current) =>
      current.length >= MAX_PAYMENT_STEPS
        ? current
        : [...current, { title: "", detail: "" }],
    );
  }

  function removePaymentStep(index) {
    setPaymentSteps((current) =>
      current.filter((_, stepIndex) => stepIndex !== index),
    );
  }

  function movePaymentStep(index, offset) {
    setPaymentSteps((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateStep(index, field, value) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, [field]: value } : step,
      ),
    }));
  }

  function addStep() {
    const tier = addTierValue;
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          id: `STEP-${Date.now()}`,
          name: "Supporting Office Review",
          office: offices[0]?.name || "OSG",
          sequence: tier,
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

  async function submitPaymentSettings(event) {
    event.preventDefault();
    await onAction(
      () => store.updatePaymentSettings({
      paymentDeadlineHours,
      paymentInstructions,
      paymentSteps,
    }),
      "Payment settings updated.",
    );
  }

  return (
    <div className="workflow-settings">
      <div className="workflow-tabs" role="tablist" aria-label="Approval settings">
        {[
          ["workflows", "Workflows"],
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
            onClick={() => { if (id === activeTab || confirmLeaveForms()) setActiveTab(id); }}
            onKeyDown={(event) => {
              const offsets = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
              if (!(event.key in offsets)) return;
              event.preventDefault();
              if (!confirmLeaveForms()) return;
              const next = tabs[(index + offsets[event.key] + tabs.length) % tabs.length][0];
              setActiveTab(next);
              document.getElementById(`settings-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ManagedForm className="workflow-panel workflow-payment" id="settings-panel-payment" role="tabpanel" aria-labelledby="settings-tab-payment" hidden={activeTab !== "payment"} onSubmit={submitPaymentSettings}>
        <CardHeader
          title="Payment settings"
          subtitle="Default receipt-upload window and the payment instructions shown to requesters."
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
          <div className="field">
            <label htmlFor="payment-instructions">Payment instructions</label>
            <textarea
              id="payment-instructions"
              className="textarea"
              maxLength={MAX_PAYMENT_INSTRUCTIONS_LENGTH}
              rows={5}
              value={paymentInstructions}
              onChange={(event) => setPaymentInstructions(event.target.value)}
              required
            />
            <small className="field-help">
              Shown to requesters on the paid-request payment steps. Explain how and where to settle the fee.
            </small>
          </div>
        </div>
        <div className="payment-step-editor">
          <h3>
            Payment next steps <span>{paymentSteps.length} of {MAX_PAYMENT_STEPS}</span>
          </h3>
          <p className="field-help workflow-tier-help">
            The numbered list requesters see after submitting a paid request. Use
            {" "}<code>{"{fee}"}</code>, <code>{"{office}"}</code>, <code>{"{window}"}</code>
            {" "}and <code>{"{reservationId}"}</code> to insert the live values.
          </p>
          {paymentSteps.map((step, index) => (
            <div className="payment-step-row" key={index}>
              <span className="workflow-step-number" aria-label={`Step ${index + 1}`}>{index + 1}</span>
              <div className="field">
                <label htmlFor={`payment-step-title-${index}`}>Step title</label>
                <input
                  id={`payment-step-title-${index}`}
                  className="input"
                  maxLength={MAX_PAYMENT_STEP_FIELD_LENGTH}
                  minLength={MIN_PAYMENT_STEP_TITLE_LENGTH}
                  value={step.title}
                  onChange={(event) => updatePaymentStep(index, "title", event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor={`payment-step-detail-${index}`}>Step detail</label>
                <input
                  id={`payment-step-detail-${index}`}
                  className="input"
                  maxLength={MAX_PAYMENT_STEP_FIELD_LENGTH}
                  value={step.detail}
                  onChange={(event) => updatePaymentStep(index, "detail", event.target.value)}
                />
              </div>
              <div className="payment-step-row-actions">
                <button
                  aria-label={`Move step ${index + 1} up`}
                  className="icon-button"
                  disabled={index === 0}
                  onClick={() => movePaymentStep(index, -1)}
                  title="Move up"
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`Move step ${index + 1} down`}
                  className="icon-button"
                  disabled={index === paymentSteps.length - 1}
                  onClick={() => movePaymentStep(index, 1)}
                  title="Move down"
                  type="button"
                >
                  ↓
                </button>
                <button
                  aria-label={`Remove step ${index + 1}`}
                  className="icon-button danger-icon"
                  disabled={paymentSteps.length <= 1}
                  onClick={() => removePaymentStep(index)}
                  title="Remove step"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          <button
            className="secondary-button icon-text-button"
            disabled={paymentSteps.length >= MAX_PAYMENT_STEPS}
            onClick={addPaymentStep}
            type="button"
          >
            <Plus size={16} /> Add step
          </button>
        </div>
        <div className="split-actions form-actions">
          <button className="primary-button icon-text-button" type="submit">
            <Clock3 size={16} /> Save Payment Settings
          </button>
        </div>
      </ManagedForm>
      <div id="settings-panel-workflows" role="tabpanel" aria-labelledby="settings-tab-workflows" hidden={activeTab !== "workflows"}>
        <ManagedForm className="workflow-panel workflow-form" onSubmit={submit}>
          <CardHeader
            title={selectedId ? "Edit workflow" : "Create workflow"}
            subtitle="Tier 1 is the owner review. Steps in the same tier run in parallel; each tier starts after the previous tier is cleared."
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
            <h3>Review steps <span>{draft.steps.length} · {highestTier} tier{highestTier === 1 ? "" : "s"}</span></h3>
            <p className="field-help workflow-tier-help">
              Tier 1 is the owner review. Steps that share a tier are approved in parallel; the next tier only starts once the previous tier is cleared.
            </p>
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
                    onChange={(event) => {
                      updateStep(index, "office", event.target.value);
                      updateStep(index, "approvingBodyId", "");
                    }}
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
                  <label htmlFor={`step-approving-body-${step.id}`}>Approving body (optional)</label>
                  <select
                    id={`step-approving-body-${step.id}`}
                    className="select"
                    value={step.approvingBodyId || ""}
                    onChange={(event) =>
                      updateStep(index, "approvingBodyId", event.target.value)
                    }
                  >
                    <option value="">No specific body (use office)</option>
                    {store.data.approvingBodies
                      .filter((body) => body.office === step.office && body.status === "Active")
                      .map((body) => (
                        <option key={body.id} value={body.id}>
                          {body.bodyName}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`step-tier-${step.id}`}>Approval tier</label>
                  <select
                    id={`step-tier-${step.id}`}
                    className="select"
                    value={Number(step.sequence) || 1}
                    disabled={index === 0}
                    onChange={(event) =>
                      updateStep(index, "sequence", event.target.value)
                    }
                  >
                    {index === 0 ? (
                      <option value={1}>Tier 1 · owner</option>
                    ) : (
                      tierOptions
                        .filter((tier) => tier !== 1)
                        .map((tier) => (
                          <option key={tier} value={tier}>
                            Tier {tier}
                            {tier === highestTier + 1 ? " (new)" : ""}
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

          <div className="workflow-add-step">
            <div className="field">
              <label htmlFor="new-step-tier">Approval tier for the new step</label>
              <select
                id="new-step-tier"
                className="select"
                value={addTierValue}
                onChange={(event) => setAddTier(event.target.value)}
              >
                {tierOptions
                  .filter((tier) => tier !== 1)
                  .map((tier) => (
                    <option key={tier} value={tier}>
                      Tier {tier}
                      {tier === highestTier + 1 ? " (new tier)" : ""}
                    </option>
                  ))}
              </select>
            </div>
            <button
              className="secondary-button icon-text-button"
              onClick={addStep}
              type="button"
            >
              <Plus size={16} /> Add Review Step
            </button>
            <small className="field-help workflow-add-step-note">
              Steps that share a tier are reviewed together in parallel.
            </small>
          </div>

          <div className="split-actions form-actions">
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
        </ManagedForm>

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
    </div>
  );
}
