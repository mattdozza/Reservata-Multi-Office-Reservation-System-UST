import test from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  RESOURCES_TABLE: "Resources",
  RESERVATIONS_TABLE: "Reservations",
  RESERVATION_LOCKS_TABLE: "Locks",
  PAYMENTS_TABLE: "Payments",
  VISITORS_TABLE: "Visitors",
  USERS_TABLE: "Users",
  OFFICES_TABLE: "Offices",
  APPROVAL_WORKFLOWS_TABLE: "ApprovalWorkflows",
  SYSTEM_SETTINGS_TABLE: "SystemSettings",
  NOTIFICATIONS_TABLE: "Notifications",
  ACTIVITY_TABLE: "Activity",
  DRIVERS_TABLE: "Drivers",
  RESERVATION_DRIVERS_TABLE: "ReservationDrivers",
  APPROVING_BODIES_TABLE: "ApprovingBodies",
  APPROVALS_TABLE: "Approvals",
  RESERVATION_HISTORY_TABLE: "ReservationHistory",
  RECEIPTS_BUCKET: "Receipts"
});

const { approvalRecord, reservationHistoryRecord } = await import("../src/lib/records.mjs");
const { createHandler: createReservationHandler } = await import("../src/handlers/reservations.mjs");

function event(method, email, body, pathParameters = {}, rawPath = "/") {
  return {
    rawPath,
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: "subject", email } } } }
  };
}

function futureDate(days = 7) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("reservationHistoryRecord shape", () => {
  const user = { name: "Admin", email: "admin@ust.edu.ph" };
  const reservation = { id: "REQ-1", office: "Simbahayan" };
  const record = reservationHistoryRecord(user, reservation, "Under Owner Review", "Confirmed", "All steps approved");
  assert.equal(record.reservationId, "REQ-1");
  assert.equal(record.previousStatus, "Under Owner Review");
  assert.equal(record.newStatus, "Confirmed");
  assert.equal(record.changedBy, "Admin");
  assert.equal(record.changedByEmail, "admin@ust.edu.ph");
  assert.equal(record.office, "Simbahayan");
  assert.equal(record.remarks, "All steps approved");
  assert.ok(record.id.startsWith("RH-"));
  assert.ok(record.changedAt);
  assert.equal(record.createdAt, record.changedAt);
});

test("approvalRecord shape falls back to the step's office when no approving body is resolved", () => {
  const user = { name: "Admin", email: "admin@ust.edu.ph" };
  const reservation = { id: "REQ-1" };
  const step = { id: "REQ-1-OWNER", templateStepId: "OWNER", office: "Simbahayan", sequence: 1 };
  const record = approvalRecord(user, reservation, step, true, null, "Looks good");
  assert.equal(record.reservationId, "REQ-1");
  assert.equal(record.stepId, "REQ-1-OWNER");
  assert.equal(record.templateStepId, "OWNER");
  assert.equal(record.decision, "Approved");
  assert.equal(record.approvingBodyId, "");
  assert.equal(record.approvingBodyName, "Simbahayan");
  assert.equal(record.remarks, "Looks good");
  assert.ok(record.id.startsWith("APR-"));
});

test("approvalRecord uses the resolved approving body's id and name when provided", () => {
  const user = { name: "Admin", email: "admin@ust.edu.ph" };
  const reservation = { id: "REQ-1" };
  const step = { id: "REQ-1-OWNER", templateStepId: "OWNER", office: "Simbahayan", sequence: 1 };
  const approvingBody = { id: "AB-1", bodyName: "Facilities Setup Desk" };
  const record = approvalRecord(user, reservation, step, false, approvingBody, "Missing documents");
  assert.equal(record.decision, "Rejected");
  assert.equal(record.approvingBodyId, "AB-1");
  assert.equal(record.approvingBodyName, "Facilities Setup Desk");
});

test("create -> decide -> status update accumulates Approvals and ReservationHistory rows", async () => {
  const approvals = [];
  const reservationHistory = [];
  let reservation;
  const resource = { id: "R-1", name: "Projector", office: "Simbahayan", type: "Equipment", status: "Available", requiresPayment: false, workflowTemplateId: "WF-BASIC" };
  const workflow = { id: "WF-BASIC", name: "Basic Resource Approval", status: "Active", steps: [{ id: "OWNER", name: "Owner Review", office: "$OWNER", sequence: 1 }] };
  const repo = {
    async get(table, key) {
      if (table === "Users") return { email: "requester@ust.edu.ph", name: "Requester", office: "CICS", role: "Requester", status: "Active" };
      if (table === "Resources") return resource;
      if (table === "ApprovalWorkflows") return workflow;
      if (table === "Reservations") return reservation;
      return null;
    },
    async query() { return []; },
    async transact(items) {
      for (const item of items) {
        if (item.Put?.TableName === "Reservations") reservation = item.Put.Item;
        if (item.Put?.TableName === "Approvals") approvals.push(item.Put.Item);
        if (item.Put?.TableName === "ReservationHistory") reservationHistory.push(item.Put.Item);
        if (item.Update?.TableName === "Reservations") Object.assign(reservation, item.Update.ExpressionAttributeValues[":next"] ? { status: item.Update.ExpressionAttributeValues[":next"] } : {});
      }
    }
  };

  const date = futureDate();
  const created = await createReservationHandler(repo)(event("POST", "requester@ust.edu.ph", {
    resourceId: "R-1", date, start: "09:00", end: "10:00", purpose: "Capstone test"
  }, {}, "/reservations"));
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(reservationHistory.length, 1);
  assert.equal(reservationHistory[0].previousStatus, "Created");
  assert.equal(reservationHistory[0].newStatus, "Under Owner Review");

  const officeAdminRepo = { ...repo, async get(table, key) {
    if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
    return repo.get(table, key);
  } };
  const decided = await createReservationHandler(officeAdminRepo)(event("PATCH", "admin@ust.edu.ph", {
    stepId: reservation.approvalSteps[0].id, approved: true
  }, { id: reservation.id }, `/reservations/${reservation.id}/decision`));
  assert.equal(decided.statusCode, 200, decided.body);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].decision, "Approved");
  assert.equal(reservationHistory.length, 2);
  assert.equal(reservationHistory[1].previousStatus, "Under Owner Review");
  assert.equal(reservationHistory[1].newStatus, "Confirmed");

  reservation.status = "Confirmed";
  const statusChanged = await createReservationHandler(officeAdminRepo)(event("PATCH", "admin@ust.edu.ph", {
    status: "Completed"
  }, { id: reservation.id }, `/reservations/${reservation.id}/status`));
  assert.equal(statusChanged.statusCode, 200, statusChanged.body);
  assert.equal(reservationHistory.length, 3);
  assert.equal(reservationHistory[2].previousStatus, "Confirmed");
  assert.equal(reservationHistory[2].newStatus, "Completed");
});
