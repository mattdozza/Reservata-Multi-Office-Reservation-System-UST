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
  RECEIPTS_BUCKET: "Receipts"
});

const { createHandler: createResourceHandler } = await import("../src/handlers/resources.mjs");
const { createHandler: createReservationHandler } = await import("../src/handlers/reservations.mjs");
const { createHandler: createAdminHandler } = await import("../src/handlers/admin.mjs");
const { createHandler: createPaymentHandler } = await import("../src/handlers/payments.mjs");

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
  assert.equal(transaction.length, 7);
  assert.equal(transaction[0].Put.TableName, "Reservations");
  assert.equal(transaction[0].Put.Item.status, "Under Owner Review");
  assert.equal(transaction[0].Put.Item.slotLockVersion, 1);
  assert.equal(transaction[0].Put.Item.approvalSteps[0].office, "Simbahayan");
  assert.equal(transaction[1].Put.TableName, "Notifications");
  assert.equal(transaction[2].Put.TableName, "Activity");
  assert.deepEqual(transaction.slice(3).map((item) => item.Put.Item.slotKey), [
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
