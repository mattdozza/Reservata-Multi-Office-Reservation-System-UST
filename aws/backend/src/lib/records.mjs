import { randomUUID } from "node:crypto";

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function now() {
  return new Date().toISOString();
}

export function activityRecord(user, action, target, office = user.office, reservationId = "", details = "") {
  const createdAt = now();
  return {
    id: createId("ACT"),
    action,
    actor: user.name,
    actorEmail: user.email,
    target,
    office,
    ...(reservationId ? { reservationId } : {}),
    details,
    createdAt,
    time: createdAt
  };
}

export function notificationRecord(userEmail, userName, message) {
  return {
    id: createId("N"),
    userEmail,
    user: userName,
    message,
    unread: true,
    createdAt: now()
  };
}

export function reservationHistoryRecord(user, reservation, previousStatus, newStatus, remarks = "") {
  const changedAt = now();
  return {
    id: createId("RH"),
    reservationId: reservation.id,
    previousStatus,
    newStatus,
    changedBy: user.name,
    changedByEmail: user.email,
    office: reservation.office,
    remarks,
    changedAt,
    createdAt: changedAt
  };
}

export function approvalRecord(user, reservation, step, approved, approvingBody, remarks = "") {
  const decidedAt = now();
  return {
    id: createId("APR"),
    reservationId: reservation.id,
    stepId: step.id,
    templateStepId: step.templateStepId,
    office: step.office,
    approvingBodyId: approvingBody?.id || "",
    approvingBodyName: approvingBody?.bodyName || step.office,
    approverEmail: user.email,
    approverName: user.name,
    decision: approved ? "Approved" : "Rejected",
    remarks,
    sequence: step.sequence,
    decidedAt,
    createdAt: decidedAt
  };
}

export function newestFirst(items) {
  return [...items].sort((left, right) => String(right.createdAt || right.submittedAt || "").localeCompare(String(left.createdAt || left.submittedAt || "")));
}
