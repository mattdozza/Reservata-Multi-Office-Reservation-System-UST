import { activityRecord, notificationRecord, now } from "./records.mjs";
import { reservationSlots } from "./slots.mjs";
import { TABLES } from "./tables.mjs";

export const RESOLVED_RESERVATION_STATUSES = new Set(["Rejected", "Cancelled", "Completed", "Expired", "No Show"]);
const ACTIVE_PAYMENT_STATUSES = new Set(["Awaiting Receipt", "Pending Verification"]);
export const DEFAULT_PAYMENT_DEADLINE_HOURS = 24;
export const MIN_PAYMENT_DEADLINE_HOURS = 1;
export const MAX_PAYMENT_DEADLINE_HOURS = 168;

function reservationEndTime(reservation) {
  if (!reservation?.date || !reservation?.end) return null;
  const endTime = new Date(`${reservation.date}T${reservation.end}`).getTime();
  return Number.isFinite(endTime) ? endTime : null;
}

export function isReservationOverdue(reservation, nowMs = Date.now()) {
  const endTime = reservationEndTime(reservation);
  return endTime !== null
    && endTime < nowMs
    && !RESOLVED_RESERVATION_STATUSES.has(reservation.status)
    && !["Confirmed", "In Use"].includes(reservation.status);
}

function reservationStartTime(reservation) {
  if (!reservation?.date || !reservation?.start) return null;
  const startTime = new Date(`${reservation.date}T${reservation.start}`).getTime();
  return Number.isFinite(startTime) ? startTime : null;
}

export function normalizePaymentDeadlineHours(value, fallback = DEFAULT_PAYMENT_DEADLINE_HOURS) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= MIN_PAYMENT_DEADLINE_HOURS && number <= MAX_PAYMENT_DEADLINE_HOURS) {
    return number;
  }
  return fallback;
}

export function effectivePaymentDeadlineHours(resource, settings = {}) {
  return normalizePaymentDeadlineHours(
    resource?.paymentDeadlineHours,
    normalizePaymentDeadlineHours(settings?.paymentDeadlineHours)
  );
}

function plusHoursIso(value, hours) {
  const base = new Date(value || now()).getTime();
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

export function paymentDeadlineFor(reservation, payment, createdAt = now(), deadlineHours = DEFAULT_PAYMENT_DEADLINE_HOURS) {
  const rollingDeadline = plusHoursIso(payment?.createdAt || payment?.submittedAt || createdAt, deadlineHours);
  const scheduleDeadline = reservation?.date && reservation?.start ? new Date(`${reservation.date}T${reservation.start}`).toISOString() : "";
  if (!scheduleDeadline) return rollingDeadline;
  return new Date(rollingDeadline).getTime() <= new Date(scheduleDeadline).getTime() ? rollingDeadline : scheduleDeadline;
}

function deadlinePassed(deadline, nowMs = Date.now()) {
  const value = new Date(deadline || "").getTime();
  return Number.isFinite(value) && value < nowMs;
}

function expireSteps(steps = []) {
  return steps.map((step) =>
    ["Pending", "Waiting"].includes(step.status) ? { ...step, status: "Skipped" } : step
  );
}

export async function expireReservations(repo, reservations, payments = [], resources = [], settings = {}) {
  let changed = 0;
  for (const reservation of reservations.filter((item) => !RESOLVED_RESERVATION_STATUSES.has(item.status))) {
    const previousStatus = reservation.status;
    const changedAt = now();
    const approvalSteps = expireSteps(reservation.approvalSteps);
    const payment = payments.find((item) => item.id === reservation.paymentId || item.reservationId === reservation.id);
    if (payment && payment.status === "Awaiting Receipt" && !payment.paymentDeadlineAt) {
      const resource = resources.find((item) => item.id === reservation.resourceId);
      payment.paymentDeadlineHours = normalizePaymentDeadlineHours(
        payment.paymentDeadlineHours,
        effectivePaymentDeadlineHours(resource, settings)
      );
      payment.paymentDeadlineAt = paymentDeadlineFor(reservation, payment, changedAt, payment.paymentDeadlineHours);
    }
    const systemUser = { name: "System", email: "system@reservata.local", office: reservation.office };
    let transaction = [];
    const endTime = reservationEndTime(reservation);
    if (["Confirmed", "In Use"].includes(reservation.status) && endTime !== null && endTime < Date.now()) {
      reservation.status = "Completed";
      reservation.completedAt = changedAt;
      transaction = [
        { Update: {
          TableName: TABLES.reservations,
          Key: { id: reservation.id },
          UpdateExpression: "SET #status = :completed, completedAt = :completedAt, updatedAt = :completedAt",
          ConditionExpression: "#status = :previous",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":completed": "Completed", ":completedAt": changedAt, ":previous": previousStatus }
        } },
        { Put: { TableName: TABLES.notifications, Item: notificationRecord(reservation.requesterEmail, reservation.requester, `${reservation.resourceName} was completed after its scheduled use.`) } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(systemUser, "Reservation completed", reservation.resourceName, reservation.office) } },
        ...reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end).map((slotKey) => ({
          Delete: { TableName: TABLES.reservationLocks, Key: { slotKey } }
        }))
      ];
    } else {
      const paymentExpired = reservation.status === "For Payment" && payment?.status === "Awaiting Receipt" && deadlinePassed(payment.paymentDeadlineAt);
      const scheduleExpired = isReservationOverdue(reservation);
      if (!paymentExpired && !scheduleExpired) {
        const reminders = [];
        if (reservation.status === "For Payment" && payment?.status === "Awaiting Receipt" && !payment.paymentReminderSentAt) {
          payment.paymentReminderSentAt = changedAt;
          reminders.push({ Update: {
            TableName: TABLES.payments,
            Key: { id: payment.id },
            UpdateExpression: "SET paymentReminderSentAt = :sentAt, paymentDeadlineAt = :deadline, paymentDeadlineHours = :deadlineHours",
            ExpressionAttributeValues: { ":sentAt": changedAt, ":deadline": payment.paymentDeadlineAt, ":deadlineHours": payment.paymentDeadlineHours }
          } });
          reminders.push({ Put: { TableName: TABLES.notifications, Item: notificationRecord(reservation.requesterEmail, reservation.requester, `${reservation.resourceName} is awaiting receipt upload before ${payment.paymentDeadlineAt}.`) } });
        }
        if (["Under Owner Review", "Under Additional Review", "Approved"].includes(reservation.status) && !reservation.reviewReminderSentAt) {
          const submitted = new Date(reservation.submittedAt || reservation.createdAt || "").getTime();
          if (Number.isFinite(submitted) && Date.now() - submitted > 24 * 60 * 60 * 1000) {
            reservation.reviewReminderSentAt = changedAt;
            reminders.push({ Update: {
              TableName: TABLES.reservations,
              Key: { id: reservation.id },
              UpdateExpression: "SET reviewReminderSentAt = :sentAt",
              ExpressionAttributeValues: { ":sentAt": changedAt }
            } });
            reminders.push({ Put: { TableName: TABLES.notifications, Item: notificationRecord(reservation.office, reservation.office, `${reservation.resourceName} has been waiting for review for more than 24 hours.`) } });
          }
        }
        if (reservation.status === "Confirmed" && !reservation.upcomingReminderSentAt) {
          const startTime = reservationStartTime(reservation);
          if (startTime && startTime > Date.now() && startTime - Date.now() <= 24 * 60 * 60 * 1000) {
            reservation.upcomingReminderSentAt = changedAt;
            reminders.push({ Update: {
              TableName: TABLES.reservations,
              Key: { id: reservation.id },
              UpdateExpression: "SET upcomingReminderSentAt = :sentAt",
              ExpressionAttributeValues: { ":sentAt": changedAt }
            } });
            reminders.push({ Put: { TableName: TABLES.notifications, Item: notificationRecord(reservation.requesterEmail, reservation.requester, `${reservation.resourceName} is scheduled within the next 24 hours.`) } });
          }
        }
        if (reminders.length) {
          await repo.transact(reminders);
          changed += 1;
        }
        continue;
      }
      const reason = paymentExpired ? "Payment deadline passed before final confirmation." : "Scheduled end time passed before final confirmation.";
      const shouldExpirePayment = payment && ACTIVE_PAYMENT_STATUSES.has(payment.status);
      reservation.status = "Expired";
      reservation.expiredAt = changedAt;
      reservation.expiryReason = reason;
      reservation.approvalSteps = approvalSteps;
      if (shouldExpirePayment) {
        payment.status = "Expired";
        payment.rejectionReason = "Reservation expired before final confirmation.";
        payment.updatedAt = changedAt;
      }
      transaction = [
        { Update: {
          TableName: TABLES.reservations,
          Key: { id: reservation.id },
          UpdateExpression: "SET #status = :expired, approvalSteps = :steps, expiredAt = :expiredAt, expiryReason = :reason, updatedAt = :expiredAt",
          ConditionExpression: "#status = :previous",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":expired": "Expired",
            ":steps": approvalSteps,
            ":expiredAt": changedAt,
            ":reason": reason,
            ":previous": previousStatus
          }
        } },
        { Put: { TableName: TABLES.notifications, Item: notificationRecord(
          reservation.requesterEmail,
          reservation.requester,
          `${reservation.resourceName} expired because ${paymentExpired ? "the payment deadline passed" : "the scheduled time passed before final confirmation"}.`
        ) } },
        { Put: { TableName: TABLES.notifications, Item: notificationRecord(
          reservation.office,
          reservation.office,
          `${reservation.resourceName}: ${reservation.requester}'s request expired before final confirmation.`
        ) } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(systemUser, "Reservation expired", reservation.resourceName, reservation.office) } },
        ...reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end).map((slotKey) => ({
          Delete: { TableName: TABLES.reservationLocks, Key: { slotKey } }
        }))
      ];

      if (shouldExpirePayment) {
        transaction.push({ Update: {
          TableName: TABLES.payments,
          Key: { id: payment.id },
          UpdateExpression: "SET #status = :expired, rejectionReason = :reason, updatedAt = :expiredAt, paymentDeadlineAt = :deadline, paymentDeadlineHours = :deadlineHours",
          ConditionExpression: "#status = :awaiting OR #status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":expired": "Expired",
            ":reason": "Reservation expired before final confirmation.",
            ":expiredAt": changedAt,
            ":deadline": payment.paymentDeadlineAt,
            ":deadlineHours": payment.paymentDeadlineHours,
            ":awaiting": "Awaiting Receipt",
            ":pending": "Pending Verification"
          }
        } });
      }
    }

    try {
      await repo.transact(transaction);
      changed += 1;
    } catch (error) {
      const name = String(error?.name || "");
      if (!["ConditionalCheckFailedException", "TransactionCanceledException"].includes(name)) throw error;
    }
  }
  return changed;
}
