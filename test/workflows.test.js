const assert = require("node:assert/strict");
const test = require("node:test");

function installStorage() {
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
}

function daysFromTodayIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

test("tiered workflow runs same-tier reviews in parallel before payment", async () => {
  const { buildApprovalSteps, decideApprovalStep } = await import("../src/domain/workflows.js");
  const template = {
    steps: [
      { id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1 },
      { id: "FAC", name: "Facilities", office: "Facilities Management", sequence: 2 },
      { id: "OSG", name: "OSG", office: "OSG", sequence: 2 }
    ]
  };
  const reservation = {
    requiresPayment: true,
    status: "Under Owner Review",
    approvalSteps: buildApprovalSteps(template, { office: "Simbahayan" }, "REQ-1")
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
  const { buildApprovalSteps, decideApprovalStep } = await import("../src/domain/workflows.js");
  const reservation = {
    requiresPayment: false,
    status: "Under Owner Review",
    approvalSteps: buildApprovalSteps({ steps: [
      { id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1 },
      { id: "NEXT", name: "Next", office: "OSG", sequence: 2 }
    ] }, { office: "Simbahayan" }, "REQ-2")
  };
  decideApprovalStep(reservation, "REQ-2-OWNER", false, "Owner Admin", "now");
  assert.equal(reservation.status, "Rejected");
  assert.equal(reservation.approvalSteps[1].status, "Skipped");
});

test("client-created IDs do not depend on a role-scoped collection length", async () => {
  const { displayTimestamp, nextId } = await import("../src/shared/utils.js");
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
        requester: "Student Body Requester",
        resourceName: "Projector Set A",
        office: "Simbahayan",
        status: "For Payment",
        approvalSteps: [{ office: "Facilities Management", status: "Approved" }]
      },
      {
        id: "REQ-2",
        requester: "Student Body Requester",
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
  const { todayIso } = await import("../src/shared/utils.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Student Body Requester",
    role: "Requester",
    office: "Student Body",
    email: "student.body.requester@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    resources: [{ id: "R-1", name: "Projector", type: "Equipment", office: "EdTech", status: "Available", capacity: 1, workflowTemplateId: "WF-BASIC" }],
    approvalTemplates: [{ id: "WF-BASIC", name: "Basic", status: "Active", steps: [{ id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1 }] }]
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
  const { tomorrowIso } = await import("../src/shared/utils.js");
  const date = tomorrowIso();
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Student Body Requester",
    role: "Requester",
    office: "Student Body",
    email: "student.body.requester@ust.edu.ph"
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
    name: "Student Body Requester",
    role: "Requester",
    office: "Student Body",
    email: "student.body.requester@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    reservations: [{
      id: "REQ-1",
      requester: "Student Body Requester",
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

test("requesters can cancel and reschedule active upcoming reservations", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Student Body Requester",
    role: "Requester",
    office: "Student Body",
    email: "student.body.requester@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    resources: [{ id: "R-1", name: "Projector", type: "Equipment", office: "EdTech", status: "Available", capacity: 1 }],
    reservations: [
      {
        id: "REQ-CANCEL",
        requester: "Student Body Requester",
        resourceId: "R-1",
        resourceName: "Projector",
        office: "EdTech",
        date: daysFromTodayIso(3),
        start: "09:00",
        end: "10:00",
        status: "Under Owner Review",
        approvalSteps: [{ id: "REQ-CANCEL-OWNER", office: "EdTech", sequence: 1, status: "Pending" }]
      },
      {
        id: "REQ-RESCHEDULE",
        requester: "Student Body Requester",
        resourceId: "R-1",
        resourceName: "Projector",
        office: "EdTech",
        date: daysFromTodayIso(4),
        start: "09:00",
        end: "10:00",
        status: "Confirmed",
        approvalSteps: [{ id: "REQ-RESCHEDULE-OWNER", office: "EdTech", sequence: 1, status: "Approved" }]
      }
    ]
  });

  await store.cancelReservation("REQ-CANCEL", "Schedule no longer needed");
  assert.equal(store.data.reservations.find((item) => item.id === "REQ-CANCEL").status, "Cancelled");

  await store.rescheduleReservation("REQ-RESCHEDULE", { date: daysFromTodayIso(6), start: "13:00", end: "14:00" });
  const rescheduled = store.data.reservations.find((item) => item.id === "REQ-RESCHEDULE");
  assert.equal(rescheduled.status, "Under Owner Review");
  assert.equal(rescheduled.start, "13:00");
  assert.equal(rescheduled.approvalSteps[0].status, "Pending");
});

test("reservation lifecycle completes confirmed bookings and expires payment deadlines", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Student Body Requester",
    role: "Requester",
    office: "Student Body",
    email: "student.body.requester@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    reservations: [
      {
        id: "REQ-COMPLETE",
        requester: "Student Body Requester",
        resourceId: "R-1",
        resourceName: "Projector",
        office: "EdTech",
        date: daysFromTodayIso(-1),
        start: "09:00",
        end: "10:00",
        status: "Confirmed"
      },
      {
        id: "REQ-PAY-DEADLINE",
        requester: "Student Body Requester",
        resourceId: "R-2",
        resourceName: "Auditorium",
        office: "Simbahayan",
        date: daysFromTodayIso(3),
        start: "09:00",
        end: "10:00",
        status: "For Payment",
        paymentId: "PAY-DEADLINE",
        requiresPayment: true
      }
    ],
    payments: [{ id: "PAY-DEADLINE", reservationId: "REQ-PAY-DEADLINE", status: "Awaiting Receipt", paymentDeadlineAt: daysFromTodayIso(-1) }]
  });

  assert.equal(store.data.reservations.find((item) => item.id === "REQ-COMPLETE").status, "Completed");
  assert.equal(store.data.reservations.find((item) => item.id === "REQ-PAY-DEADLINE").status, "Expired");
  assert.equal(store.data.payments.find((item) => item.id === "PAY-DEADLINE").status, "Expired");
});

test("payment handoff snapshots the configured resource deadline window", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "EdTech Office Admin",
    role: "Office Admin",
    office: "EdTech",
    email: "edtech.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    systemSettings: [{ id: "SYSTEM", paymentDeadlineHours: 24 }],
    resources: [{ id: "R-PAID", name: "Robot 01", type: "Equipment", office: "EdTech", status: "Available", capacity: 40, requiresPayment: true, fee: 500, paymentDeadlineHours: 6, workflowTemplateId: "WF-BASIC" }],
    reservations: [{
      id: "REQ-PAID",
      requester: "Student Body Requester",
      resourceId: "R-PAID",
      resourceName: "Robot 01",
      office: "EdTech",
      date: daysFromTodayIso(3),
      start: "09:00",
      end: "10:00",
      status: "Under Owner Review",
      requiresPayment: true,
      approvalSteps: [{ id: "REQ-PAID-OWNER", name: "Resource Owner Review", office: "EdTech", sequence: 1, status: "Pending" }]
    }]
  });

  await store.approveReservation("REQ-PAID", "REQ-PAID-OWNER");

  const payment = store.data.payments.find((item) => item.reservationId === "REQ-PAID");
  assert.equal(payment.paymentDeadlineHours, 6);
  assert.equal(store.data.reservations.find((item) => item.id === "REQ-PAID").status, "For Payment");
});

test("office admin gets generated asset tags and can save searchable labels", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "EdTech Office Admin",
    role: "Office Admin",
    office: "EdTech",
    email: "edtech.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    resources: [{ id: "R-EXISTING", assetTag: "EDTECH-PROJ-001", name: "Projector", type: "Equipment", office: "EdTech", status: "Available", capacity: 1, workflowTemplateId: "WF-BASIC" }],
    approvalTemplates: [{ id: "WF-BASIC", name: "Basic Resource Approval", status: "Active", steps: [{ id: "OWNER", name: "Owner Review", office: "$OWNER", sequence: 1 }] }]
  });

  await store.saveResource({
    assetTag: "",
    name: "Loaner Laptop",
    type: "Equipment",
    location: "CICS Stockroom",
    serialNumber: "SN-002",
    tags: "Laptop, Loaner, Laptop",
    capacity: 1,
    status: "Available",
    requiresPayment: false,
    workflowTemplateId: "WF-BASIC"
  });

  const resource = store.data.resources.find((item) => item.name === "Loaner Laptop");
  assert.equal(resource.assetTag, "EDTECH-EQP-001");
  assert.deepEqual(resource.tags, ["Laptop", "Loaner"]);
  assert.equal(resource.serialNumber, "SN-002");

  await assert.rejects(() => store.saveResource({
    assetTag: "EDTECH-PROJ-001",
    name: "Duplicate Projector",
    type: "Equipment",
    location: "CICS Lab",
    capacity: 1,
    status: "Available",
    requiresPayment: false,
    workflowTemplateId: "WF-BASIC"
  }), /Asset tag must be unique/);
});

test("owning office can manage confirmed reservation attendance states", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "EdTech Office Admin",
    role: "Office Admin",
    office: "EdTech",
    email: "edtech.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    reservations: [
      { id: "REQ-IN-USE", requester: "Student Body Requester", resourceName: "Projector", office: "EdTech", date: daysFromTodayIso(0), start: "00:01", end: "23:59", status: "Confirmed" },
      { id: "REQ-NO-SHOW", requester: "Student Body Requester", resourceName: "Laptop", office: "EdTech", date: daysFromTodayIso(0), start: "00:01", end: "23:59", status: "Confirmed" }
    ]
  });

  await store.updateReservationLifecycleStatus("REQ-IN-USE", "In Use");
  assert.equal(store.data.reservations.find((item) => item.id === "REQ-IN-USE").status, "In Use");
  await store.updateReservationLifecycleStatus("REQ-IN-USE", "Completed");
  assert.equal(store.data.reservations.find((item) => item.id === "REQ-IN-USE").status, "Completed");

  await store.updateReservationLifecycleStatus("REQ-NO-SHOW", "No Show", "Requester did not arrive");
  assert.equal(store.data.reservations.find((item) => item.id === "REQ-NO-SHOW").status, "No Show");
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
    name: "All Offices Super Admin",
    role: "Super Admin",
    office: "All Offices",
    email: "all.offices.admin@ust.edu.ph"
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

test("super admin can update the default payment deadline window", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "All Offices Super Admin",
    role: "Super Admin",
    office: "All Offices",
    email: "all.offices.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({ systemSettings: [{ id: "SYSTEM", paymentDeadlineHours: 24 }] });

  await store.updatePaymentDeadlineSettings(48);

  assert.equal(store.settings.paymentDeadlineHours, 48);
  await assert.rejects(() => store.updatePaymentDeadlineSettings(200), /whole number from 1 to 168/);
});

test("super admin can edit the payment instructions shown to requesters", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "All Offices Super Admin",
    role: "Super Admin",
    office: "All Offices",
    email: "all.offices.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({ systemSettings: [{ id: "SYSTEM", paymentDeadlineHours: 24 }] });

  // A missing value falls back to the shipped default.
  assert.match(store.settings.paymentInstructions, /Upload the official receipt/);

  await store.updatePaymentSettings({
    paymentDeadlineHours: 12,
    paymentInstructions: "Pay at the Simbahayan cashier and upload the receipt within the window."
  });

  assert.equal(store.settings.paymentDeadlineHours, 12);
  assert.match(store.settings.paymentInstructions, /Simbahayan cashier/);

  await assert.rejects(
    () => store.updatePaymentSettings({ paymentDeadlineHours: 12, paymentInstructions: "short" }),
    /at least 10 characters/
  );
});

test("office admin can author an approval workflow for their own office", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Simbahayan Office Admin",
    role: "Office Admin",
    office: "Simbahayan",
    email: "simbahayan.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    offices: [
      { id: "OFF-1", name: "Simbahayan", status: "Active" },
      { id: "OFF-2", name: "OSG", status: "Active" }
    ],
    approvalTemplates: [{
      id: "WF-BASIC",
      name: "Basic Resource Approval",
      status: "Active",
      steps: [{ id: "OWNER", name: "Resource Owner Review", office: "$OWNER", sequence: 1 }]
    }]
  });

  const workflow = await store.saveWorkflow({
    name: "Simbahayan Event Approval",
    resourceType: "Vehicle",
    steps: [
      { id: "OWNER", name: "Resource Owner Review", office: "$OWNER", sequence: 1 },
      { id: "OSG", name: "OSG Event Review", office: "OSG", sequence: 2 }
    ]
  });

  assert.equal(workflow.office, "Simbahayan");
  assert.ok(store.data.approvalTemplates.some((item) => item.id === workflow.id));

  // A shared template the office does not own cannot be edited from their page.
  await assert.rejects(
    () => store.saveWorkflow({
      name: "Hijacked",
      steps: [{ id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1 }]
    }, "WF-BASIC"),
    /only edit approval workflows they created/
  );
});

test("a verified payment can be reopened for another verification pass", async () => {
  installStorage();
  const { ReservataStore } = await import("../src/store.js");
  const store = new ReservataStore();
  store.apiAvailable = false;
  store.localUser = {
    name: "Simbahayan Admin",
    role: "Office Admin",
    office: "Simbahayan",
    email: "simbahayan.admin@ust.edu.ph"
  };
  store.applyAuthenticatedUser(store.localUser);
  store.setData({
    reservations: [{ id: "REQ-1", requester: "Fr. Jose", resourceName: "Sound System", office: "Simbahayan", status: "Confirmed" }],
    payments: [{ id: "PAY-1", reservationId: "REQ-1", office: "Simbahayan", status: "Verified", amount: 850, receipt: "receipt.jpg", verifiedAt: "Aug 28, 2026", verifiedBy: "Simbahayan Admin" }]
  });

  await store.reopenPayment("PAY-1");
  assert.equal(store.data.payments[0].status, "Pending Verification");
  assert.equal(store.data.payments[0].verifiedBy, "");
  assert.equal(store.data.payments[0].verifiedAt, "");
  assert.equal(store.data.reservations[0].status, "For Payment");
  assert.ok(store.data.notifications.some((item) => item.type === "Payment"));

  // Only a verified payment with a confirmed reservation may be reopened.
  store.data.payments[0].status = "Rejected";
  store.data.reservations[0].status = "Rejected";
  await assert.rejects(() => store.reopenPayment("PAY-1"), /verified payment with a confirmed reservation/);

  // Another office may not reopen this record.
  const other = new ReservataStore();
  other.apiAvailable = false;
  other.localUser = { name: "Facilities Admin", role: "Office Admin", office: "Facilities Management", email: "facilities.admin@ust.edu.ph" };
  other.applyAuthenticatedUser(other.localUser);
  other.setData(structuredClone(store.data));
  await assert.rejects(() => other.reopenPayment("PAY-1"), /office assigned to this request/);
});
