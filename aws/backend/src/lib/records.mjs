import { randomUUID } from "node:crypto";

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function now() {
  return new Date().toISOString();
}

export function activityRecord(user, action, target, office = user.office) {
  const createdAt = now();
  return {
    id: createId("ACT"),
    action,
    actor: user.name,
    actorEmail: user.email,
    target,
    office,
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

export function newestFirst(items) {
  return [...items].sort((left, right) => String(right.createdAt || right.submittedAt || "").localeCompare(String(left.createdAt || left.submittedAt || "")));
}
