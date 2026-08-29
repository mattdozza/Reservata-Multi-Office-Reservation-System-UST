import { HttpError } from "./http.mjs";

function enabled(value) {
  return value === true || value === "true" || value === "on" || value === "yes";
}

export function buildApprovalSteps(template, resource, request, reservationId) {
  const source = template?.steps?.length
    ? template.steps
    : [{ id: "OWNER", name: "Resource Owner Review", office: "$OWNER", sequence: 1, condition: "always" }];
  const active = source
    .filter((step) => step.condition === "always" || enabled(request[step.condition]))
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  const firstSequence = Math.min(...active.map((step) => Number(step.sequence || 1)));
  return active.map((step, index) => ({
    id: `${reservationId}-${step.id || index + 1}`,
    templateStepId: step.id || `STEP-${index + 1}`,
    name: step.name,
    office: step.office === "$OWNER" ? resource.office : step.office,
    sequence: Number(step.sequence || 1),
    condition: step.condition || "always",
    status: Number(step.sequence || 1) === firstSequence ? "Pending" : "Waiting",
    decidedBy: "",
    decidedAt: ""
  }));
}

export function decideApprovalStep(reservation, stepId, approved, actor, decidedAt) {
  const steps = structuredClone(reservation.approvalSteps || []);
  const step = steps.find((item) => item.id === stepId);
  if (!step || step.status !== "Pending") throw new HttpError(409, "This approval step is no longer awaiting a decision.");
  step.status = approved ? "Approved" : "Rejected";
  step.decidedBy = actor;
  step.decidedAt = decidedAt;

  if (!approved) {
    steps.filter((item) => item.status === "Waiting").forEach((item) => { item.status = "Skipped"; });
    return { steps, status: "Rejected", step };
  }

  const groupComplete = !steps.some((item) => item.sequence === step.sequence && item.status === "Pending");
  if (groupComplete) {
    const nextSequence = Math.min(...steps.filter((item) => item.status === "Waiting").map((item) => item.sequence));
    if (Number.isFinite(nextSequence)) {
      steps.filter((item) => item.sequence === nextSequence && item.status === "Waiting").forEach((item) => { item.status = "Pending"; });
    }
  }
  if (steps.every((item) => ["Approved", "Skipped"].includes(item.status))) {
    return { steps, status: reservation.requiresPayment ? "For Payment" : "Confirmed", step };
  }
  const pendingSequence = Math.min(...steps.filter((item) => item.status === "Pending").map((item) => item.sequence));
  return { steps, status: pendingSequence <= 1 ? "Under Owner Review" : "Under Additional Review", step };
}

export function canDecideStep(user, step) {
  if (user.role === "Office Admin") return step.office === user.office;
  if (user.role === "OSG Admin") return step.office === "OSG";
  return false;
}
