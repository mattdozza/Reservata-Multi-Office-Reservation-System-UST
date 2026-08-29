const assert = require("node:assert/strict");
const test = require("node:test");

test("venue workflow activates conditional reviews in parallel before payment", async () => {
  const { buildApprovalSteps, decideApprovalStep } = await import("../src/workflows.js");
  const template = {
    steps: [
      { id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1, condition: "always" },
      { id: "FAC", name: "Facilities", office: "Facilities Management", sequence: 2, condition: "setupRequired" },
      { id: "OSG", name: "OSG", office: "OSG", sequence: 2, condition: "externalVisitors" }
    ]
  };
  const reservation = {
    requiresPayment: true,
    status: "Under Owner Review",
    approvalSteps: buildApprovalSteps(template, { office: "Simbahayan" }, { setupRequired: true, externalVisitors: true }, "REQ-1")
  };

  assert.deepEqual(reservation.approvalSteps.map((step) => step.status), ["Pending", "Waiting", "Waiting"]);
  decideApprovalStep(reservation, "REQ-1-OWNER", true, "Owner Admin", "now");
  assert.equal(reservation.status, "Under Additional Review");
  assert.deepEqual(reservation.approvalSteps.map((step) => step.status), ["Approved", "Pending", "Pending"]);

  decideApprovalStep(reservation, "REQ-1-FAC", true, "Facilities Admin", "now");
  assert.equal(reservation.status, "Under Additional Review");
  decideApprovalStep(reservation, "REQ-1-OSG", true, "OSG Admin", "now");
  assert.equal(reservation.status, "For Payment");
});

test("a rejected approval stops the remaining route", async () => {
  const { buildApprovalSteps, decideApprovalStep } = await import("../src/workflows.js");
  const reservation = {
    requiresPayment: false,
    status: "Under Owner Review",
    approvalSteps: buildApprovalSteps({ steps: [
      { id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1, condition: "always" },
      { id: "NEXT", name: "Next", office: "OSG", sequence: 2, condition: "always" }
    ] }, { office: "Simbahayan" }, {}, "REQ-2")
  };
  decideApprovalStep(reservation, "REQ-2-OWNER", false, "Owner Admin", "now");
  assert.equal(reservation.status, "Rejected");
  assert.equal(reservation.approvalSteps[1].status, "Skipped");
});

test("client-created IDs do not depend on a role-scoped collection length", async () => {
  const { displayTimestamp, nextId } = await import("../src/utils.js");
  const ids = new Set(Array.from({ length: 100 }, () => nextId("REQ-2026")));
  assert.equal(ids.size, 100);
  assert.ok([...ids].every((id) => /^REQ-2026-[A-F0-9]{8}$/.test(id)));
  assert.equal(displayTimestamp("Just now"), "Recent activity");
  assert.equal(displayTimestamp("Aug 28, 2026, 2:20 AM"), "Aug 28, 2026, 2:20 AM");
});

test("office payment queue is scoped to the payment owner office", async () => {
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.localUser = {
    name: "Facilities Admin",
    role: "Office Admin",
    office: "Facilities Management",
    email: "facilities.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    reservations: [
      {
        id: "REQ-1",
        requester: "Maria Jua",
        resourceName: "Main Chapel",
        office: "Simbahayan",
        status: "For Payment",
        approvalSteps: [{ office: "Facilities Management", status: "Approved" }]
      },
      {
        id: "REQ-2",
        requester: "Maria Jua",
        resourceName: "Sound System",
        office: "Facilities Management",
        status: "For Payment",
        approvalSteps: []
      }
    ],
    payments: [
      { id: "PAY-1", reservationId: "REQ-1", office: "Simbahayan", status: "Pending Verification" },
      { id: "PAY-2", reservationId: "REQ-2", office: "Facilities Management", status: "Pending Verification" }
    ]
  });

  assert.deepEqual(store.officeReservations.map((item) => item.id), ["REQ-1", "REQ-2"]);
  assert.deepEqual(store.officePayments.map((item) => item.id), ["PAY-2"]);
});

test("requesters must reserve at least one day before use", async () => {
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const { ReservataStore } = await import("../src/store.js");
  const { todayIso } = await import("../src/utils.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Maria Jua",
    role: "Requester",
    office: "Student Body",
    email: "maria.jua@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    resources: [{ id: "R-1", name: "Projector", type: "Equipment", office: "EdTech", status: "Available", capacity: 1, workflowTemplateId: "WF-BASIC" }],
    approvalTemplates: [{ id: "WF-BASIC", name: "Basic", status: "Active", steps: [{ id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1, condition: "always" }] }]
  });

  await assert.rejects(
    store.submitReservation({ resourceId: "R-1", date: todayIso(), start: "09:00", end: "10:00", quantity: 1, purpose: "Capstone presentation setup" }),
    /at least one day/
  );
});

test("reservation availability blocks pending overlaps and suggests alternatives", async () => {
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: () => {}
  };
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const { ReservataStore } = await import("../src/store.js");
  const { tomorrowIso } = await import("../src/utils.js");
  const date = tomorrowIso();
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Maria Jua",
    role: "Requester",
    office: "Student Body",
    email: "maria.jua@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    resources: [{ id: "R-1", name: "Projector", type: "Equipment", office: "EdTech", status: "Available", capacity: 1, workflowTemplateId: "WF-BASIC" }],
    reservations: [{ id: "REQ-1", requester: "Other Requester", resourceId: "R-1", resourceName: "Projector", date, start: "09:00", end: "10:00", status: "Under Owner Review" }]
  });

  const availability = store.resourceAvailability("R-1", date, "09:30", "10:30");
  assert.equal(availability.status, "conflict");
  assert.equal(availability.conflicts[0].status, "Under Owner Review");
  assert.ok(availability.slots.some((slot) => slot.start === "09:00" && slot.status === "unavailable"));
  assert.ok(availability.alternatives.some((slot) => slot.status === "available"));

  await assert.rejects(
    store.submitReservation({ resourceId: "R-1", date, start: "09:30", end: "10:30", quantity: 1, purpose: "Capstone presentation setup" }),
    /overlapping reservation/
  );
});

test("requesters can attach supporting documents to their reservations", async () => {
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: () => {}
  };
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Maria Jua",
    role: "Requester",
    office: "Student Body",
    email: "maria.jua@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    reservations: [{
      id: "REQ-1",
      requester: "Maria Jua",
      resourceId: "R-1",
      resourceName: "Projector",
      office: "EdTech",
      date: "2099-09-10",
      start: "09:00",
      end: "10:00",
      status: "Under Owner Review"
    }]
  });

  await store.uploadSupportingDocument("REQ-1", {
    name: "event-plan.pdf",
    type: "application/pdf",
    size: 1200,
    previewData: "data:application/pdf;base64,JVBERi0x"
  });

  assert.equal(store.data.reservations[0].supportingDocuments[0].name, "event-plan.pdf");
  assert.equal(store.data.reservations[0].supportingDocuments[0].status, "Submitted");
  assert.ok(store.data.activity.some((item) => item.action === "Supporting document uploaded"));
});

test("super admin can provision a valid UST SSO email", async () => {
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Sandra Alma",
    role: "Super Admin",
    office: "All Offices",
    email: "sandra.alma@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    people: [store.localUser],
    offices: [{ id: "OFF-EDTECH", name: "EdTech", status: "Active" }]
  });

  await store.createUser({
    name: "Lebron James",
    email: "lebronjames@ust.edu.ph",
    office: "EdTech",
    role: "Office Admin",
    status: "Active"
  });

  assert.ok(store.data.people.some((person) => person.email === "lebronjames@ust.edu.ph"));
});

test("super admin can manage additional requirement options", async () => {
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  global.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Sandra Alma",
    role: "Super Admin",
    office: "All Offices",
    email: "sandra.alma@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({ systemSettings: [{ id: "SYSTEM" }] });

  await store.saveRequirementOption({
    id: "cateringRequired",
    label: "Catering support",
    help: "Routes requests that need catering tables, food setup, or serving support.",
    status: "Active"
  });

  assert.ok(store.requirementOptions.some((item) => item.id === "cateringRequired"));

  await store.archiveRequirementOption("cateringRequired");
  assert.ok(!store.requirementOptions.some((item) => item.id === "cateringRequired"));
  assert.ok(store.allRequirementOptions.some((item) => item.id === "cateringRequired" && item.status === "Archived"));
});
