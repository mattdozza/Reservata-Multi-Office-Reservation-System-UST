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
  NOTIFICATIONS_TABLE: "Notifications",
  ACTIVITY_TABLE: "Activity",
  RECEIPTS_BUCKET: "Receipts"
});

const { createHandler: createResourceHandler } = await import("../src/handlers/resources.mjs");
const { createHandler: createReservationHandler } = await import("../src/handlers/reservations.mjs");
const { createHandler: createAdminHandler } = await import("../src/handlers/admin.mjs");

function event(method, email, body, pathParameters = {}, rawPath = "/", queryStringParameters = {}) {
  return {
    rawPath,
    pathParameters,
    queryStringParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: "subject", email } } } }
  };
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

test("Requester submission creates reservation, notification, and activity atomically", async () => {
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
    resourceId: "R-1", date: "2026-09-10", start: "09:00", end: "10:00", purpose: "Capstone test"
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
    "R-1#2026-09-10#09:00",
    "R-1#2026-09-10#09:15",
    "R-1#2026-09-10#09:30",
    "R-1#2026-09-10#09:45"
  ]);
});

test("Requester submission rejects an overlapping pending reservation", async () => {
  const repo = {
    async get(table) {
      if (table === "Users") return { email: "requester@ust.edu.ph", name: "Requester", office: "CICS", role: "Requester", status: "Active" };
      if (table === "Resources") return { id: "R-1", name: "Projector", office: "Simbahayan", type: "Equipment", status: "Available", requiresPayment: false, workflowTemplateId: "WF-BASIC" };
      return null;
    },
    async query(table) {
      if (table === "Reservations") {
        return [{ id: "REQ-1", resourceId: "R-1", resourceDate: "R-1#2026-09-10", date: "2026-09-10", start: "09:30", end: "10:30", status: "Under Owner Review" }];
      }
      return [];
    },
    async transact() {
      assert.fail("conflicting reservation should not be written");
    }
  };
  const response = await createReservationHandler(repo)(event("POST", "requester@ust.edu.ph", {
    resourceId: "R-1", date: "2026-09-10", start: "09:00", end: "10:00", purpose: "Capstone test"
  }, {}, "/reservations"));
  assert.equal(response.statusCode, 409);
});

test("Resource availability reports blocked slots and alternatives without listing private reservations", async () => {
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
      if (value === "R-1#2026-09-10") {
        return [{ id: "REQ-1", resourceId: "R-1", date: "2026-09-10", start: "09:00", end: "10:00", status: "Under Owner Review", requester: "Other Requester" }];
      }
      return [];
    }
  };
  const response = await createReservationHandler(repo)(event("GET", "requester@ust.edu.ph", undefined, { id: "R-1" }, "/resources/R-1/availability", {
    date: "2026-09-10",
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
