export const REQUIREMENT_OPTIONS = [
  {
    id: "setupRequired",
    label: "Setup or maintenance support",
    help: "Routes the request to Facilities when setup, room preparation, or maintenance work is needed."
  },
  {
    id: "externalVisitors",
    label: "External visitors or guests",
    help: "Routes the request to OSG when people from outside the university will attend."
  },
  {
    id: "parkingRequired",
    label: "Visitor parking",
    help: "Routes the request to OSG when visitor parking slots are needed."
  }
];

export const WORKFLOW_CONDITIONS = [
  ["always", "Always required"],
  ...REQUIREMENT_OPTIONS.map((option) => [option.id, `When ${option.label.toLowerCase()} is selected`])
];

function enabled(value) {
  return value === true || value === "true" || value === "on" || value === "yes";
}

export function conditionMatches(condition, request) {
  return condition === "always" || enabled(request[condition]);
}

export function buildApprovalSteps(template, resource, request, reservationId) {
  const source = template?.steps?.length
    ? template.steps
    : [{ id: "OWNER", name: "Resource Owner Review", office: "$OWNER", sequence: 1, condition: "always" }];
  const active = source
    .filter((step) => conditionMatches(step.condition || "always", request))
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

export function hydrateLegacyReservation(reservation) {
  if (reservation.approvalSteps?.length) return reservation;
  const status = reservation.status === "Pending"
    ? "Pending"
    : reservation.status === "Rejected"
      ? "Rejected"
      : "Approved";
  return {
    ...reservation,
    status: reservation.status === "Pending" ? "Under Owner Review" : reservation.status,
    workflowTemplateId: reservation.workflowTemplateId || "WF-BASIC",
    approvalSteps: [{
      id: `${reservation.id}-OWNER`,
      templateStepId: "OWNER",
      name: "Resource Owner Review",
      office: reservation.office,
      sequence: 1,
      condition: "always",
      status,
      decidedBy: status === "Pending" ? "" : "Legacy migration",
      decidedAt: ""
    }]
  };
}

export function pendingApprovalSteps(reservation, office) {
  return (reservation.approvalSteps || []).filter((step) => step.status === "Pending" && (!office || step.office === office));
}

export function decideApprovalStep(reservation, stepId, approved, actor, decidedAt) {
  const steps = reservation.approvalSteps || [];
  const step = steps.find((item) => item.id === stepId);
  if (!step || step.status !== "Pending") throw new Error("This approval step is no longer awaiting a decision.");

  step.status = approved ? "Approved" : "Rejected";
  step.decidedBy = actor;
  step.decidedAt = decidedAt;

  if (!approved) {
    steps.filter((item) => item.status === "Waiting").forEach((item) => { item.status = "Skipped"; });
    reservation.status = "Rejected";
    return reservation.status;
  }

  const currentSequence = step.sequence;
  const currentGroupComplete = !steps.some((item) => item.sequence === currentSequence && item.status === "Pending");
  if (currentGroupComplete) {
    const nextSequence = Math.min(...steps.filter((item) => item.status === "Waiting").map((item) => item.sequence));
    if (Number.isFinite(nextSequence)) {
      steps.filter((item) => item.sequence === nextSequence && item.status === "Waiting").forEach((item) => { item.status = "Pending"; });
    }
  }

  if (steps.every((item) => ["Approved", "Skipped"].includes(item.status))) {
    reservation.status = reservation.requiresPayment ? "For Payment" : "Confirmed";
  } else {
    const pendingSequence = Math.min(...steps.filter((item) => item.status === "Pending").map((item) => item.sequence));
    reservation.status = pendingSequence <= 1 ? "Under Owner Review" : "Under Additional Review";
  }
  return reservation.status;
}

export function approvalProgress(reservation) {
  const steps = reservation.approvalSteps || [];
  const completed = steps.filter((step) => ["Approved", "Skipped"].includes(step.status)).length;
  return { completed, total: steps.length };
}
