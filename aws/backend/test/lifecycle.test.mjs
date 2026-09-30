import test from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  RESERVATIONS_TABLE: "Reservations",
  RESERVATION_LOCKS_TABLE: "Locks",
  PAYMENTS_TABLE: "Payments",
  SYSTEM_SETTINGS_TABLE: "SystemSettings",
  NOTIFICATIONS_TABLE: "Notifications",
  ACTIVITY_TABLE: "Activity",
  RESERVATION_HISTORY_TABLE: "ReservationHistory"
});

const { expireReservations, isReservationOverdue } = await import("../src/lib/reservationLifecycle.mjs");

function daysFromTodayIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

test("reservation lifecycle expires unfinished reservations and releases locks", async () => {
  const transactions = [];
  const reservation = {
    id: "REQ-AWS-EXPIRED",
    requester: "Student Body Requester",
    requesterEmail: "student.body.requester@ust.edu.ph",
    resourceId: "R-1",
    resourceName: "Projector",
    office: "Simbahayan",
    date: daysFromTodayIso(-1),
    start: "09:00",
    end: "10:00",
    status: "For Payment",
    paymentId: "PAY-AWS-EXPIRED",
    approvalSteps: [
      { id: "REQ-AWS-EXPIRED-OWNER", status: "Approved", sequence: 1 },
      { id: "REQ-AWS-EXPIRED-FAC", status: "Pending", sequence: 2 }
    ]
  };
  const payment = {
    id: "PAY-AWS-EXPIRED",
    reservationId: reservation.id,
    status: "Awaiting Receipt"
  };
  const repo = {
    async transact(items) {
      transactions.push(items);
    }
  };

  assert.equal(isReservationOverdue(reservation), true);
  const count = await expireReservations(repo, [reservation], [payment]);
  assert.equal(count, 1);
  assert.equal(reservation.status, "Expired");
  assert.equal(reservation.approvalSteps[1].status, "Skipped");
  assert.equal(payment.status, "Expired");
  assert.ok(transactions[0].some((item) => item.Delete?.TableName === "Locks"));
  assert.ok(transactions[0].some((item) => item.Update?.TableName === "Payments"));
  const history = transactions[0].find((item) => item.Put?.TableName === "ReservationHistory");
  assert.ok(history, "expected a ReservationHistory row for the auto-expire transition");
  assert.equal(history.Put.Item.previousStatus, "For Payment");
  assert.equal(history.Put.Item.newStatus, "Expired");
  assert.equal(history.Put.Item.changedBy, "System");
});

test("reservation lifecycle completes confirmed reservations after use", async () => {
  const transactions = [];
  const reservation = {
    id: "REQ-AWS-COMPLETED",
    requester: "Student Body Requester",
    requesterEmail: "student.body.requester@ust.edu.ph",
    resourceId: "R-1",
    resourceName: "Projector",
    office: "Simbahayan",
    date: daysFromTodayIso(-1),
    start: "09:00",
    end: "10:00",
    status: "Confirmed"
  };
  const repo = {
    async transact(items) {
      transactions.push(items);
    }
  };

  const count = await expireReservations(repo, [reservation], []);
  assert.equal(count, 1);
  assert.equal(reservation.status, "Completed");
  assert.ok(transactions[0].some((item) => item.Update?.ExpressionAttributeValues?.[":completed"] === "Completed"));
  assert.ok(transactions[0].some((item) => item.Delete?.TableName === "Locks"));
  const history = transactions[0].find((item) => item.Put?.TableName === "ReservationHistory");
  assert.ok(history, "expected a ReservationHistory row for the auto-complete transition");
  assert.equal(history.Put.Item.previousStatus, "Confirmed");
  assert.equal(history.Put.Item.newStatus, "Completed");
  assert.equal(history.Put.Item.changedBy, "System");
});

test("reservation lifecycle hydrates payment deadlines from resource overrides", async () => {
  const transactions = [];
  const reservation = {
    id: "REQ-AWS-PAYMENT-WINDOW",
    requester: "Student Body Requester",
    requesterEmail: "student.body.requester@ust.edu.ph",
    resourceId: "R-PAID",
    resourceName: "Training Room",
    office: "EdTech",
    date: daysFromTodayIso(3),
    start: "09:00",
    end: "10:00",
    status: "For Payment",
    paymentId: "PAY-AWS-WINDOW"
  };
  const payment = {
    id: "PAY-AWS-WINDOW",
    reservationId: reservation.id,
    status: "Awaiting Receipt",
    createdAt: new Date().toISOString()
  };
  const repo = {
    async transact(items) {
      transactions.push(items);
    }
  };

  const count = await expireReservations(
    repo,
    [reservation],
    [payment],
    [{ id: "R-PAID", paymentDeadlineHours: 4 }],
    { paymentDeadlineHours: 24 }
  );

  assert.equal(count, 1);
  assert.equal(payment.paymentDeadlineHours, 4);
  assert.ok(payment.paymentDeadlineAt);
  assert.equal(transactions[0][0].Update.ExpressionAttributeValues[":deadlineHours"], 4);
});
