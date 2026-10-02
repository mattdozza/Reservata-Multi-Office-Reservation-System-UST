export function buildApprovalSteps(template, resource, reservationId) {
  const source = template?.steps?.length
    ? template.steps
    : [{ id: "OWNER", name: "Resource Owner Review", office: "$OWNER", sequence: 1 }];
  const ordered = [...source].sort(
    (left, right) => Number(left.sequence || 1) - Number(right.sequence || 1),
  );
  const firstSequence = Math.min(...ordered.map((step) => Number(step.sequence || 1)));

  return ordered.map((step, index) => ({
    id: `${reservationId}-${step.id || index + 1}`,
    templateStepId: step.id || `STEP-${index + 1}`,
    name: step.name,
    office: step.office === "$OWNER" ? resource.office : step.office,
    sequence: Number(step.sequence || 1),
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

/**
 * First-Come, First-Served ordering for requests competing for the same resource and
 * schedule. Overlapping pending requests are grouped so an approver can only confirm
 * the earliest one; the rest are surfaced with their queue position.
 */
export function submittedAtMs(reservation) {
  const parsed = Date.parse(reservation?.submittedAt || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function compareSubmission(left, right) {
  const leftMs = submittedAtMs(left);
  const rightMs = submittedAtMs(right);
  if (leftMs !== null && rightMs !== null && leftMs !== rightMs) return leftMs - rightMs;
  if (leftMs !== null && rightMs === null) return -1;
  if (leftMs === null && rightMs !== null) return 1;
  // Deterministic tiebreak so seeded records without a parseable timestamp keep a stable order.
  return String(left?.id || "").localeCompare(String(right?.id || ""), undefined, { numeric: true });
}

export function competingRequests(reservation, reservations) {
  if (!reservation?.resourceId || !reservation?.date) return [];
  const openStatuses = ["Under Owner Review", "Under Additional Review", "Approved", "For Payment", "In Use", "Confirmed"];
  return (reservations || [])
    .filter((item) =>
      item.id !== reservation.id
      && item.resourceId === reservation.resourceId
      && item.date === reservation.date
      && openStatuses.includes(item.status)
      && reservation.start < item.end
      && reservation.end > item.start)
    .sort(compareSubmission);
}

/** Returns the request's place in its FCFS queue, or null when nothing competes with it. */
export function fcfsQueue(reservation, reservations) {
  const competing = competingRequests(reservation, reservations);
  if (!competing.length) return null;
  const ordered = [...competing, reservation].sort(compareSubmission);
  const position = ordered.findIndex((item) => item.id === reservation.id) + 1;
  return { position, total: ordered.length, competingIds: ordered.map((item) => item.id) };
}
