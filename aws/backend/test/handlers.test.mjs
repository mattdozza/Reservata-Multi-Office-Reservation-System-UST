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

const { createHandler: createResourceHandler } = await import("../src/handlers/resources.mjs");
const { createHandler: createReservationHandler } = await import("../src/handlers/reservations.mjs");
const { createHandler: createAdminHandler } = await import("../src/handlers/admin.mjs");
const { createHandler: createPaymentHandler } = await import("../src/handlers/payments.mjs");
const { createHandler: createVisitorHandler } = await import("../src/handlers/visitors.mjs");

test("receipt verification begins only after S3 confirms upload completion", async () => {
  const user = { email: "requester@ust.edu.ph", name: "Requester", role: "Requester", status: "Active" };
  const payment = { id: "PAY-1", reservationId: "REQ-1", requesterEmail: user.email, status: "Awaiting Receipt", paymentDeadlineAt: "2099-01-01T07:00:00Z", paymentReminderSentAt: "2026-01-01T00:00:00Z" };
  const reservation = { id: "REQ-1", requesterEmail: user.email, resourceName: "Hall", office: "Simbahayan", status: "For Payment", date: "2099-01-01", start: "08:00", end: "09:00" };
  let transaction;
  let uploaded = false;
  const repo = {
    get: async (table) => table === "Users" ? user : table === "Payments" ? payment : table === "Reservations" ? reservation : null,
    update: async (table, key, values) => Object.assign(payment, values),
    transact: async (value) => { transaction = value; }
  };
  const s3 = { send: async () => { if (!uploaded) throw new Error("Not found"); return { ContentLength: 1234, ContentType: "image/jpeg" }; } };
  const handler = createPaymentHandler(repo, s3, async () => "https://example.invalid/upload");
  const initial = await handler(event("POST", user.email, { filename: "receipt.jpg", contentType: "image/jpeg" }, { id: payment.id }, "/payments/PAY-1/receipt-upload"));
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(payment.status, "Awaiting Receipt");
  assert.equal(transaction, undefined);
  const objectKey = JSON.parse(initial.body).objectKey;
  const complete = () => handler(event("POST", user.email, { objectKey }, { id: payment.id }, "/payments/PAY-1/receipt-complete"));
  assert.equal((await complete()).statusCode, 409);
  assert.equal(payment.status, "Awaiting Receipt");
  uploaded = true;
  const result = await complete();
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(transaction.find((item) => item.Update)?.Update.ExpressionAttributeValues[":next"], "Pending Verification");
  assert.ok(transaction.some((item) => item.Put?.Item.reservationId === reservation.id));
});

function event(method, email, body, pathParameters = {}, rawPath = "/", queryStringParameters = {}) {
  return {
    rawPath,
    pathParameters,
    queryStringParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: "subject", email } } } }
  };
}

function futureDate(days = 7) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("Office Admin resource listing is constrained to the assigned office", async () => {
  const calls = [];
  const repo = {
    async get(table) {
      assert.equal(table, "Users");
      return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
    },
    async query(table, index, key, value) {
      calls.push({ table, index, key, value });
      return [{ id: "R-1", office: value }];
    }
  };
  const response = await createResourceHandler(repo)(event("GET", "admin@ust.edu.ph"));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [{ table: "Resources", index: "office-index", key: "office", value: "Simbahayan" }]);
});

test("Office Admin can create resources with generated unique asset tags", async () => {
  let transaction;
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "EdTech", role: "Office Admin", status: "Active" };
      if (table === "ApprovalWorkflows") return { id: "WF-BASIC", name: "Basic", status: "Active" };
      return null;
    },
    async scan(table) {
      assert.equal(table, "Resources");
      return [{ id: "R-1", assetTag: "EDTECH-PROJ-001" }];
    },
    async transact(items) { transaction = items; }
  };

  const created = await createResourceHandler(repo)(event("POST", "admin@ust.edu.ph", {
    name: "Loaner Laptop",
    type: "Equipment",
    location: "CICS Stockroom",
    serialNumber: "SN-002",
    tags: "Laptop, Loaner, Laptop",
    capacity: 1,
    requiresPayment: false,
    workflowTemplateId: "WF-BASIC"
  }, {}, "/resources"));
  assert.equal(created.statusCode, 201);
  assert.equal(transaction[0].Put.Item.assetTag, "EDTECH-EQP-001");
  assert.deepEqual(transaction[0].Put.Item.tags, ["Laptop", "Loaner"]);

  const duplicate = await createResourceHandler(repo)(event("POST", "admin@ust.edu.ph", {
    assetTag: "EDTECH-PROJ-001",
    name: "Duplicate Projector",
    type: "Equipment",
    location: "CICS Lab",
    capacity: 1
  }, {}, "/resources"));
  assert.equal(duplicate.statusCode, 409);
});

test("Requester submission creates reservation, notification, and activity atomically", async () => {
  const date = futureDate();
  let transaction;
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "requester@ust.edu.ph", name: "Requester", office: "CICS", role: "Requester", status: "Active" };
      if (table === "Resources") return { id: "R-1", name: "Projector", office: "Simbahayan", type: "Equipment", status: "Available", requiresPayment: false, workflowTemplateId: "WF-BASIC" };
      if (table === "ApprovalWorkflows") return { id: "WF-BASIC", name: "Basic Resource Approval", status: "Active", steps: [{ id: "OWNER", name: "Owner Review", office: "$OWNER", sequence: 1, condition: "always" }] };
      return null;
    },
    async query() { return []; },
    async transact(items) { transaction = items; }
  };
  const response = await createReservationHandler(repo)(event("POST", "requester@ust.edu.ph", {
    resourceId: "R-1", date, start: "09:00", end: "10:00", purpose: "Capstone test"
  }, {}, "/reservations"));
  assert.equal(response.statusCode, 201);
  assert.equal(transaction.length, 8);
  assert.equal(transaction[0].Put.TableName, "Reservations");
  assert.equal(transaction[0].Put.Item.status, "Under Owner Review");
  assert.equal(transaction[0].Put.Item.slotLockVersion, 1);
  assert.equal(transaction[0].Put.Item.approvalSteps[0].office, "Simbahayan");
  assert.equal(transaction[1].Put.TableName, "Notifications");
  assert.equal(transaction[2].Put.TableName, "Activity");
  assert.equal(transaction[3].Put.TableName, "ReservationHistory");
  assert.equal(transaction[3].Put.Item.previousStatus, "Created");
  assert.equal(transaction[3].Put.Item.newStatus, "Under Owner Review");
  assert.deepEqual(transaction.slice(4).map((item) => item.Put.Item.slotKey), [
    `R-1#${date}#09:00`,
    `R-1#${date}#09:15`,
    `R-1#${date}#09:30`,
    `R-1#${date}#09:45`
  ]);
});

test("Requester submission rejects an overlapping pending reservation", async () => {
  const date = futureDate();
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "requester@ust.edu.ph", name: "Requester", office: "CICS", role: "Requester", status: "Active" };
      if (table === "Resources") return { id: "R-1", name: "Projector", office: "Simbahayan", type: "Equipment", status: "Available", requiresPayment: false, workflowTemplateId: "WF-BASIC" };
      return null;
    },
    async query(table) {
      if (table === "Reservations") {
        return [{ id: "REQ-1", resourceId: "R-1", resourceDate: `R-1#${date}`, date, start: "09:30", end: "10:30", status: "Under Owner Review" }];
      }
      return [];
    },
    async transact() {
      assert.fail("conflicting reservation should not be written");
    }
  };
  const response = await createReservationHandler(repo)(event("POST", "requester@ust.edu.ph", {
    resourceId: "R-1", date, start: "09:00", end: "10:00", purpose: "Capstone test"
  }, {}, "/reservations"));
  assert.equal(response.statusCode, 409);
});

test("Resource availability reports blocked slots and alternatives without listing private reservations", async () => {
  const date = futureDate();
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "requester@ust.edu.ph", name: "Requester", office: "CICS", role: "Requester", status: "Active" };
      if (table === "Resources") return { id: "R-1", name: "Projector", office: "Simbahayan", type: "Equipment", status: "Available" };
      return null;
    },
    async query(table, index, key, value) {
      assert.equal(table, "Reservations");
      assert.equal(index, "resource-date-index");
      assert.equal(key, "resourceDate");
      if (value === `R-1#${date}`) {
        return [{ id: "REQ-1", resourceId: "R-1", date, start: "09:00", end: "10:00", status: "Under Owner Review", requester: "Other Requester" }];
      }
      return [];
    }
  };
  const response = await createReservationHandler(repo)(event("GET", "requester@ust.edu.ph", undefined, { id: "R-1" }, "/resources/R-1/availability", {
    date,
    start: "09:00",
    end: "10:00"
  }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status, "conflict");
  assert.equal(body.conflicts[0].status, "Under Owner Review");
  assert.equal(body.conflicts[0].requester, undefined);
  assert.ok(body.slots.some((slot) => slot.start === "09:00" && slot.status === "unavailable"));
  assert.ok(body.alternatives.some((slot) => slot.status === "available"));
});

test("Requester can create a supporting document upload for an active reservation", async () => {
  let transaction;
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "requester@ust.edu.ph", name: "Requester", office: "CICS", role: "Requester", status: "Active" };
      if (table === "Reservations") return {
        id: "REQ-1",
        requester: "Requester",
        requesterEmail: "requester@ust.edu.ph",
        resourceName: "Projector",
        office: "Simbahayan",
        status: "Under Owner Review",
        supportingDocuments: []
      };
      return null;
    },
    async transact(items) { transaction = items; }
  };
  const handler = createReservationHandler(repo, {}, async () => "https://upload.example.test/document");
  const response = await handler(event("POST", "requester@ust.edu.ph", {
    filename: "event plan.pdf",
    contentType: "application/pdf",
    size: 1200
  }, { id: "REQ-1" }, "/reservations/REQ-1/document-upload"));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.uploadUrl, "https://upload.example.test/document");
  assert.equal(body.document.name, "event-plan.pdf");
  assert.equal(transaction[0].Update.TableName, "Reservations");
  assert.equal(transaction[0].Update.ExpressionAttributeValues[":documents"][0].status, "Submitted");
  assert.equal(transaction[1].Put.TableName, "Notifications");
  assert.equal(transaction[2].Put.TableName, "Activity");
});

test("Office Admin cannot decide another office's reservation", async () => {
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      if (table === "Reservations") return { id: "REQ-1", office: "EdTech", status: "Under Owner Review", workflowVersion: 1, approvalSteps: [{ id: "REQ-1-OWNER", name: "Owner Review", office: "EdTech", sequence: 1, status: "Pending" }] };
      return null;
    }
  };
  const response = await createReservationHandler(repo)(event("PATCH", "admin@ust.edu.ph", { stepId: "REQ-1-OWNER", approved: true }, { id: "REQ-1" }, "/reservations/REQ-1/decision"));
  assert.equal(response.statusCode, 403);
});

test("Decision route writes an Approvals row and a Reservation_History row using the template's approvingBodyId", async () => {
  let transaction;
  const reservation = {
    id: "REQ-DEC-1",
    office: "Simbahayan",
    status: "Under Owner Review",
    workflowVersion: 1,
    workflowTemplateId: "WF-BASIC",
    requesterEmail: "requester@ust.edu.ph",
    requester: "Requester",
    resourceId: "R-1",
    resourceName: "Projector",
    date: futureDate(),
    start: "09:00",
    end: "10:00",
    approvalSteps: [{ id: "REQ-DEC-1-OWNER", templateStepId: "OWNER", name: "Owner Review", office: "Simbahayan", sequence: 1, status: "Pending", decidedBy: "", decidedAt: "" }]
  };
  const repo = {
    async get(table, key) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      if (table === "Reservations") return reservation;
      if (table === "ApprovalWorkflows") return { id: "WF-BASIC", steps: [{ id: "OWNER", approvingBodyId: "AB-1" }] };
      if (table === "ApprovingBodies") { assert.equal(key.id, "AB-1"); return { id: "AB-1", bodyName: "Facilities Setup Desk" }; }
      return null;
    },
    async transact(items) { transaction = items; }
  };
  const response = await createReservationHandler(repo)(event("PATCH", "admin@ust.edu.ph", { stepId: "REQ-DEC-1-OWNER", approved: true }, { id: "REQ-DEC-1" }, "/reservations/REQ-DEC-1/decision"));
  assert.equal(response.statusCode, 200, response.body);
  const approval = transaction.find((item) => item.Put?.TableName === "Approvals");
  assert.ok(approval, "expected an Approvals row");
  assert.equal(approval.Put.Item.decision, "Approved");
  assert.equal(approval.Put.Item.approvingBodyId, "AB-1");
  assert.equal(approval.Put.Item.approvingBodyName, "Facilities Setup Desk");
  const history = transaction.find((item) => item.Put?.TableName === "ReservationHistory");
  assert.ok(history, "expected a ReservationHistory row");
  assert.equal(history.Put.Item.previousStatus, "Under Owner Review");
  assert.equal(history.Put.Item.newStatus, "Confirmed");
});

test("Decision route falls back to office-index approving body lookup when no approvingBodyId is set", async () => {
  let transaction;
  const reservation = {
    id: "REQ-DEC-2",
    office: "Simbahayan",
    status: "Under Owner Review",
    workflowVersion: 1,
    workflowTemplateId: "WF-BASIC",
    requesterEmail: "requester@ust.edu.ph",
    requester: "Requester",
    resourceId: "R-1",
    resourceName: "Projector",
    date: futureDate(),
    start: "09:00",
    end: "10:00",
    approvalSteps: [{ id: "REQ-DEC-2-OWNER", templateStepId: "OWNER", name: "Owner Review", office: "Simbahayan", sequence: 1, status: "Pending", decidedBy: "", decidedAt: "" }]
  };
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      if (table === "Reservations") return reservation;
      if (table === "ApprovalWorkflows") return { id: "WF-BASIC", steps: [{ id: "OWNER" }] };
      return null;
    },
    async query(table, index, key, value) {
      assert.equal(table, "ApprovingBodies");
      assert.equal(index, "office-index");
      assert.equal(value, "Simbahayan");
      return [{ id: "AB-2", office: "Simbahayan", bodyName: "Simbahayan Front Desk", status: "Active" }];
    },
    async transact(items) { transaction = items; }
  };
  const response = await createReservationHandler(repo)(event("PATCH", "admin@ust.edu.ph", { stepId: "REQ-DEC-2-OWNER", approved: true }, { id: "REQ-DEC-2" }, "/reservations/REQ-DEC-2/decision"));
  assert.equal(response.statusCode, 200, response.body);
  const approval = transaction.find((item) => item.Put?.TableName === "Approvals");
  assert.equal(approval.Put.Item.approvingBodyId, "AB-2");
  assert.equal(approval.Put.Item.approvingBodyName, "Simbahayan Front Desk");
});

test("Status route writes a Reservation_History row", async () => {
  let transaction;
  const reservation = {
    id: "REQ-STATUS-1",
    office: "Simbahayan",
    status: "Confirmed",
    resourceId: "R-1",
    resourceName: "Projector",
    requesterEmail: "requester@ust.edu.ph",
    requester: "Requester",
    date: futureDate(),
    start: "09:00",
    end: "10:00"
  };
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      if (table === "Reservations") return reservation;
      return null;
    },
    async transact(items) { transaction = items; }
  };
  const response = await createReservationHandler(repo)(event("PATCH", "admin@ust.edu.ph", { status: "Completed" }, { id: "REQ-STATUS-1" }, "/reservations/REQ-STATUS-1/status"));
  assert.equal(response.statusCode, 200, response.body);
  const history = transaction.find((item) => item.Put?.TableName === "ReservationHistory");
  assert.ok(history, "expected a ReservationHistory row");
  assert.equal(history.Put.Item.previousStatus, "Confirmed");
  assert.equal(history.Put.Item.newStatus, "Completed");
});

test("Driver assignment route rejects when the resource does not require a driver", async () => {
  const reservation = { id: "REQ-DRV-1", office: "Simbahayan", status: "Confirmed", resourceId: "R-1", resourceName: "Projector" };
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      if (table === "Reservations") return reservation;
      if (table === "Resources") return { id: "R-1", type: "Equipment", driver: "Not applicable" };
      return null;
    }
  };
  const response = await createReservationHandler(repo)(event("PATCH", "admin@ust.edu.ph", { driverId: "DRV-1" }, { id: "REQ-DRV-1" }, "/reservations/REQ-DRV-1/driver"));
  assert.equal(response.statusCode, 409);
});

test("Driver assignment route succeeds for a vehicle reservation and writes an activity record only", async () => {
  let transaction;
  const reservation = { id: "REQ-DRV-2", office: "Simbahayan", status: "Confirmed", resourceId: "R-5", resourceName: "Community Outreach Van", date: futureDate(), start: "09:00", end: "12:00" };
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      if (table === "Reservations") return reservation;
      if (table === "Resources") return { id: "R-5", type: "Vehicle", driver: "With Driver" };
      if (table === "Drivers") return { id: "DRV-1", office: "Simbahayan", name: "Ramon Cruz", status: "Available" };
      return null;
    },
    async query() { return []; },
    async transact(items) { transaction = items; }
  };
  const response = await createReservationHandler(repo)(event("PATCH", "admin@ust.edu.ph", { driverId: "DRV-1" }, { id: "REQ-DRV-2" }, "/reservations/REQ-DRV-2/driver"));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(transaction[0].Put.TableName, "ReservationDrivers");
  assert.equal(transaction[0].Put.Item.driverId, "DRV-1");
  assert.equal(transaction[0].Put.Item.status, "Assigned");
  assert.equal(transaction[1].Put.TableName, "Activity");
  assert.equal(transaction.some((item) => item.Put?.TableName === "ReservationHistory"), false);
});

test("Office Admin can create and list Drivers scoped to their office", async () => {
  let transaction;
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      return null;
    },
    async query(table, index, key, value) {
      assert.equal(table, "Drivers");
      assert.equal(index, "office-index");
      assert.equal(value, "Simbahayan");
      return [{ id: "DRV-1", office: "Simbahayan", name: "Ramon Cruz" }];
    },
    async transact(items) { transaction = items; }
  };
  const list = await createResourceHandler(repo)(event("GET", "admin@ust.edu.ph", undefined, {}, "/drivers"));
  assert.equal(list.statusCode, 200);
  assert.equal(JSON.parse(list.body).items.length, 1);

  const created = await createResourceHandler(repo)(event("POST", "admin@ust.edu.ph", { name: "New Driver", licenseNumber: "N99-99-999999" }, {}, "/drivers"));
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(transaction[0].Put.TableName, "Drivers");
  assert.equal(transaction[0].Put.Item.office, "Simbahayan");
  assert.equal(transaction[0].Put.Item.status, "Available");
});

test("Approving Bodies CRUD is Super-Admin only", async () => {
  const deniedRepo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      return null;
    }
  };
  const denied = await createAdminHandler(deniedRepo)(event("POST", "admin@ust.edu.ph", { bodyName: "Test Body", office: "Simbahayan" }, {}, "/approving-bodies"));
  assert.equal(denied.statusCode, 403);

  let transaction;
  const allowedRepo = {
    async get(table) {
      if (table === "Users") return { email: "super@ust.edu.ph", name: "Super", office: "All Offices", role: "Super Admin", status: "Active" };
      return null;
    },
    async scan(table) {
      if (table === "Offices") return [{ id: "OFF-1", name: "Simbahayan", status: "Active" }];
      return [];
    },
    async transact(items) { transaction = items; }
  };
  const allowed = await createAdminHandler(allowedRepo)(event("POST", "super@ust.edu.ph", { bodyName: "Simbahayan Front Desk", office: "Simbahayan" }, {}, "/approving-bodies"));
  assert.equal(allowed.statusCode, 201, allowed.body);
  assert.equal(transaction[0].Put.TableName, "ApprovingBodies");
  assert.equal(transaction[0].Put.Item.officeId, "OFF-1");
  assert.equal(transaction[1].Put.TableName, "Activity");
});

test("only Super Admin can provision SSO user accounts", async () => {
  const newAccount = {
    name: "New Office Admin",
    email: "new.admin@ust.edu.ph",
    office: "Simbahayan",
    role: "Office Admin",
    status: "Active"
  };

  const deniedRepo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      return null;
    }
  };
  const denied = await createAdminHandler(deniedRepo)(event("POST", "admin@ust.edu.ph", newAccount, {}, "/users"));
  assert.equal(denied.statusCode, 403);

  let transaction;
  const allowedRepo = {
    async get(table) {
      if (table === "Users") return { email: "super@ust.edu.ph", name: "Super", office: "All Offices", role: "Super Admin", status: "Active" };
      return null;
    },
    async scan(table) {
      if (table === "Offices") return [{ id: "OFF-1", name: "Simbahayan", status: "Active" }];
      return [];
    },
    async transact(items) { transaction = items; }
  };
  const allowed = await createAdminHandler(allowedRepo)(event("POST", "super@ust.edu.ph", newAccount, {}, "/users"));
  assert.equal(allowed.statusCode, 201);
  assert.equal(transaction[0].Put.TableName, "Users");
  assert.equal(transaction[0].Put.ConditionExpression, "attribute_not_exists(email)");
  assert.deepEqual(transaction[0].Put.Item.email, "new.admin@ust.edu.ph");
  assert.equal(transaction[1].Put.TableName, "Activity");
});

test("Requester accounts must specify a valid requester type", async () => {
  const allowedRepo = {
    async get(table) {
      if (table === "Users") return { email: "super@ust.edu.ph", name: "Super", office: "All Offices", role: "Super Admin", status: "Active" };
      return null;
    },
    async scan(table) {
      if (table === "Offices") return [{ id: "OFF-1", name: "Simbahayan", status: "Active" }];
      return [];
    },
    async transact() { assert.fail("should not persist an invalid requester type"); }
  };
  const missingType = await createAdminHandler(allowedRepo)(event("POST", "super@ust.edu.ph", {
    name: "New Student", email: "new.student@ust.edu.ph", office: "Simbahayan", role: "Requester", status: "Active"
  }, {}, "/users"));
  assert.equal(missingType.statusCode, 400);

  let transaction;
  const okRepo = { ...allowedRepo, async transact(items) { transaction = items; } };
  const withType = await createAdminHandler(okRepo)(event("POST", "super@ust.edu.ph", {
    name: "New Student", email: "new.student@ust.edu.ph", office: "Simbahayan", role: "Requester", requesterType: "Student", status: "Active"
  }, {}, "/users"));
  assert.equal(withType.statusCode, 201, withType.body);
  assert.equal(transaction[0].Put.Item.requesterType, "Student");
});

test("Changing an existing account's role to Requester without a type defaults to Student", async () => {
  let transaction;
  const repo = {
    async get(table, key) {
      if (table === "Users" && key.email === "super@ust.edu.ph") return { email: "super@ust.edu.ph", name: "Super", office: "All Offices", role: "Super Admin", status: "Active" };
      if (table === "Users") return { email: key.email, name: "Office Admin Turned Requester", office: "Simbahayan", role: "Office Admin", status: "Active" };
      return null;
    },
    async transact(items) { transaction = items; }
  };
  const response = await createAdminHandler(repo)(event("PATCH", "super@ust.edu.ph", { role: "Requester" }, { email: "former.admin@ust.edu.ph" }, "/users/former.admin@ust.edu.ph/role"));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(transaction[0].Update.ExpressionAttributeValues[":requesterType"], "Student");
});

test("Super Admin can update an existing Requester's requester type", async () => {
  let transaction;
  const repo = {
    async get(table, key) {
      if (table === "Users" && key.email === "super@ust.edu.ph") return { email: "super@ust.edu.ph", name: "Super", office: "All Offices", role: "Super Admin", status: "Active" };
      if (table === "Users") return { email: key.email, name: "Student Body Requester", office: "Student Body", role: "Requester", requesterType: "Student", status: "Active" };
      return null;
    },
    async transact(items) { transaction = items; }
  };
  const response = await createAdminHandler(repo)(event("PATCH", "super@ust.edu.ph", { requesterType: "Faculty" }, { email: "student.body.requester@ust.edu.ph" }, "/users/student.body.requester@ust.edu.ph/requester-type"));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(transaction[0].Update.ExpressionAttributeValues[":requesterType"], "Faculty");
});

test("only Super Admin can update payment deadline settings", async () => {
  const deniedRepo = {
    async get(table) {
      if (table === "Users") return { email: "admin@ust.edu.ph", name: "Admin", office: "Simbahayan", role: "Office Admin", status: "Active" };
      return null;
    }
  };
  const denied = await createAdminHandler(deniedRepo)(event("PATCH", "admin@ust.edu.ph", { paymentDeadlineHours: 36 }, {}, "/settings"));
  assert.equal(denied.statusCode, 403);

  let transaction;
  const allowedRepo = {
    async get(table) {
      if (table === "Users") return { email: "super@ust.edu.ph", name: "Super", office: "All Offices", role: "Super Admin", status: "Active" };
      if (table === "SystemSettings") return { id: "SYSTEM", paymentDeadlineHours: 24, requirementOptions: [] };
      return null;
    },
    async transact(items) { transaction = items; }
  };
  const allowed = await createAdminHandler(allowedRepo)(event("PATCH", "super@ust.edu.ph", { paymentDeadlineHours: 36, requirementOptions: [] }, {}, "/settings"));
  assert.equal(allowed.statusCode, 200);
  const body = JSON.parse(allowed.body);
  assert.equal(body.paymentDeadlineHours, 36);
  assert.equal(transaction[0].Put.TableName, "SystemSettings");
  assert.equal(transaction[0].Put.Item.id, "SYSTEM");
  assert.equal(transaction[1].Put.TableName, "Activity");
});

test("Student requester accounts cannot list or submit visitor requests", async () => {
  const student = { email: "student@ust.edu.ph", name: "A Student", office: "Student Body", role: "Requester", requesterType: "Student", status: "Active" };
  const repo = {
    async get(table) {
      if (table === "Users") return student;
      return null;
    }
  };
  const list = await createVisitorHandler(repo)(event("GET", "student@ust.edu.ph"));
  assert.equal(list.statusCode, 403);
  const submit = await createVisitorHandler(repo)(event("POST", "student@ust.edu.ph", {
    visitor: "Guest", organization: "Org", purpose: "Meeting", date: "2099-01-01", time: "09:00", guests: 1
  }, {}, "/visitors"));
  assert.equal(submit.statusCode, 403);
});

test("Faculty/Staff/Student Org Rep requester accounts can submit and list their own visitor requests", async () => {
  const faculty = { email: "faculty@ust.edu.ph", name: "A Faculty", office: "CICS", role: "Requester", requesterType: "Faculty", status: "Active" };
  let transaction;
  const repo = {
    async get(table) {
      if (table === "Users") return faculty;
      return null;
    },
    async query(table, index, key, value) {
      assert.equal(table, "Visitors");
      assert.equal(index, "requester-index");
      assert.equal(value, faculty.email);
      return [];
    },
    async transact(items) { transaction = items; }
  };
  const list = await createVisitorHandler(repo)(event("GET", "faculty@ust.edu.ph"));
  assert.equal(list.statusCode, 200);
  const submit = await createVisitorHandler(repo)(event("POST", "faculty@ust.edu.ph", {
    visitor: "Guest", organization: "Org", purpose: "Meeting", date: "2099-01-01", time: "09:00", guests: 1
  }, {}, "/visitors"));
  assert.equal(submit.statusCode, 201, submit.body);
  assert.equal(transaction[0].Put.TableName, "Visitors");
});

test("Student requesters only see Equipment resources; other requester types see Facility and Vehicle too", async () => {
  const resources = [
    { id: "R-1", type: "Equipment", office: "EdTech", status: "Available" },
    { id: "R-2", type: "Facility", office: "Simbahayan", status: "Available" },
    { id: "R-3", type: "Vehicle", office: "Simbahayan", status: "Available" },
    { id: "R-4", type: "Visitor Service", office: "OSG", status: "Available" }
  ];
  const repoFor = (requesterType) => ({
    async get(table) {
      if (table === "Users") return { email: "requester@ust.edu.ph", name: "Requester", office: "CICS", role: "Requester", requesterType, status: "Active" };
      return null;
    },
    async scan() { return resources; }
  });
  const studentResponse = await createResourceHandler(repoFor("Student"))(event("GET", "requester@ust.edu.ph"));
  assert.deepEqual(JSON.parse(studentResponse.body).items.map((item) => item.id), ["R-1"]);

  const facultyResponse = await createResourceHandler(repoFor("Faculty"))(event("GET", "requester@ust.edu.ph"));
  assert.deepEqual(JSON.parse(facultyResponse.body).items.map((item) => item.id), ["R-1", "R-2", "R-3"]);
});

test("Student requesters cannot submit a reservation for a non-Equipment resource", async () => {
  const date = futureDate();
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "student@ust.edu.ph", name: "A Student", office: "CICS", role: "Requester", requesterType: "Student", status: "Active" };
      if (table === "Resources") return { id: "R-2", name: "Multipurpose Hall", office: "Simbahayan", type: "Facility", status: "Available", requiresPayment: false, workflowTemplateId: "WF-BASIC" };
      return null;
    },
    async query() { return []; },
    async transact() { assert.fail("a blocked reservation should not be persisted"); }
  };
  const response = await createReservationHandler(repo)(event("POST", "student@ust.edu.ph", {
    resourceId: "R-2", date, start: "09:00", end: "10:00", purpose: "Capstone test"
  }, {}, "/reservations"));
  assert.equal(response.statusCode, 403);
});
