const assert = require("node:assert/strict");
const test = require("node:test");

function installStorage() {
  const memory = new Map();
  global.localStorage = { getItem: (k) => memory.get(k) || null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
  global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

async function makeStore(user) {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = user;
  store.applyAuthenticatedUser(store.localUser);
  return store;
}

const ADMIN = { name: "EdTech Office Admin", role: "Office Admin", office: "EdTech", email: "edtech.admin@ust.edu.ph" };
const SUPER = { name: "All Offices Super Admin", role: "Super Admin", office: "All Offices", email: "all.offices.admin@ust.edu.ph" };

function reservation(id, minutes, overrides = {}) {
  return {
    id,
    requester: "Student Body Requester",
    resourceId: "R-1",
    resourceName: "Projector Set A",
    office: "EdTech",
    type: "Equipment",
    date: "2026-12-01",
    start: "09:00",
    end: "10:00",
    quantity: 1,
    purpose: "FCFS ordering check for the capstone defense.",
    status: "Under Owner Review",
    submittedAt: "2026-11-01T09:00:00.000Z",
    requiresPayment: false,
    workflowTemplateId: "WF-BASIC",
    approvalSteps: [{ id: `${id}-OWNER`, name: "Owner Review", office: "EdTech", sequence: 1, status: "Pending", decidedBy: "", decidedAt: "" }],
    ...overrides
  };
}

const BASE = {
  resources: [{ id: "R-1", name: "Projector Set A", type: "Equipment", office: "EdTech", status: "Available", capacity: 5, assetTag: "EDTECH-PROJ-001", workflowTemplateId: "WF-BASIC", location: "Room 1", tags: [] }],
  approvalTemplates: [{ id: "WF-BASIC", name: "Basic Resource Approval", status: "Active", steps: [{ id: "OWNER", name: "Owner Review", office: "$OWNER", sequence: 1 }] }],
  systemSettings: [{ id: "SYSTEM", paymentDeadlineHours: 24 }]
};

test("competing requests are grouped and ordered first-come first-served", async () => {
  const { fcfsQueue } = await import("../src/domain/workflows.js");
  const items = [
    reservation("REQ-C", 0, { submittedAt: "2026-11-01T12:00:00.000Z" }),
    reservation("REQ-A", 0, { submittedAt: "2026-11-01T09:00:00.000Z" }),
    reservation("REQ-B", 0, { submittedAt: "2026-11-01T11:00:00.000Z" })
  ];
  assert.equal(fcfsQueue(items[0], items).position, 3, "REQ-C submitted last so it is third");
  assert.equal(fcfsQueue(items[1], items).position, 1, "REQ-A submitted first so it is first");
  assert.equal(fcfsQueue(items[2], items).position, 2);
  assert.equal(fcfsQueue(items[1], items).total, 3);

  // A non-overlapping schedule is not a queue.
  const later = reservation("REQ-X", 0, { start: "14:00", end: "15:00", submittedAt: "2026-11-02T09:00:00.000Z" });
  assert.equal(fcfsQueue(later, [...items, later]), null);
});

test("only the earliest competing request may be confirmed", async () => {
  const store = await makeStore(ADMIN);
  const first = reservation("REQ-FIRST", 0, { submittedAt: "2026-11-01T09:00:00.000Z" });
  const second = reservation("REQ-SECOND", 0, { submittedAt: "2026-11-01T10:00:00.000Z" });
  store.setData({ ...BASE, reservations: [first, second] });

  await assert.rejects(() => store.approveReservation("REQ-SECOND", "REQ-SECOND-OWNER"), /2 of 2/);
  await store.approveReservation("REQ-FIRST", "REQ-FIRST-OWNER");
  assert.equal(store.data.reservations.find((r) => r.id === "REQ-FIRST").status, "Confirmed");
});

test("a resource going under maintenance flags pending and confirmed requests", async () => {
  const store = await makeStore(ADMIN);
  const pending = reservation("REQ-PENDING", 0);
  const confirmed = reservation("REQ-CONFIRMED", 0, { status: "Confirmed", submittedAt: "2026-11-01T08:00:00.000Z", start: "13:00", end: "14:00" });
  store.setData({ ...BASE, reservations: [pending, confirmed] });

  const resource = store.data.resources[0];
  resource.status = "Under Maintenance";
  const flagged = store.flagResourceOutage(resource);

  assert.equal(flagged, 2, "both the pending and the confirmed request are held for review");
  assert.ok(store.data.reservations.every((r) => r.resourceConflict === true));
  const officeNotices = store.data.notifications.filter((n) => n.user === "EdTech" && /Review REQ-/.test(n.message));
  assert.equal(officeNotices.length, 2, "the owning office is notified for review");
  const requesterNotice = store.data.notifications.filter((n) => n.user === "Student Body Requester" && /REQ-CONFIRMED/.test(n.message));
  assert.equal(requesterNotice.length, 1, "the requester of the confirmed booking is notified");
});

test("a request cannot be confirmed while its resource is out of service", async () => {
  const store = await makeStore(ADMIN);
  const item = reservation("REQ-BLOCKED", 0);
  store.setData({ ...BASE, reservations: [item], resources: [{ ...BASE.resources[0], status: "Under Maintenance" }] });
  await assert.rejects(() => store.approveReservation("REQ-BLOCKED", "REQ-BLOCKED-OWNER"), /Under Maintenance, so REQ-BLOCKED cannot be confirmed/);
});

test("the super admin can manage resources across offices", async () => {
  const store = await makeStore(SUPER);
  store.setData({
    ...BASE,
    resources: [{ ...BASE.resources[0], office: "Simbahayan" }],
    reservations: []
  });
  // An Office Admin is still restricted to their own office.
  const officeAdmin = await makeStore(ADMIN);
  officeAdmin.setData({ ...BASE, resources: [{ ...BASE.resources[0], office: "Simbahayan" }], reservations: [] });
  await assert.rejects(() => officeAdmin.archiveResource("R-1"), /office assigned to this request/);

  await store.saveResource({ name: "Laser Projector", type: "Equipment", location: "Hall B", assetTag: "EDTECH-PROJ-002", workflowTemplateId: "WF-BASIC", office: "EdTech", capacity: 2 });
  assert.ok(store.data.resources.some((r) => r.name === "Laser Projector"));
});
