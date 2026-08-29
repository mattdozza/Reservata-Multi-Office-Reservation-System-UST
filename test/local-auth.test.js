const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server.js");

const ACCOUNTS = [
  ["maria.jua@ust.edu.ph", "Requester2026!", "Requester"],
  ["maria.santos@ust.edu.ph", "OfficeAdmin2026!", "Office Admin"],
  ["sandra.alma@ust.edu.ph", "SuperAdmin2026!", "Super Admin"],
  ["andrea.reyes@ust.edu.ph", "OsgAdmin2026!", "OSG Admin"],
  ["paolo.reyes@ust.edu.ph", "Visitor2026!", "OSG Requester"],
  ["facilities.admin@ust.edu.ph", "Facilities2026!", "Office Admin"]
];

test("local login authenticates accounts and derives their assigned roles", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const unauthorized = await fetch(`${baseUrl}/api/state`);
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ACCOUNTS[0][0], password: "incorrect" })
    });
    assert.equal(invalid.status, 401);

    for (const [email, password, role] of ACCOUNTS) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.user.email, email);
      assert.equal(result.user.role, role);
      assert.ok(result.token.length >= 40);

      const session = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Authorization: `Bearer ${result.token}` }
      });
      assert.equal(session.status, 200);
      assert.equal((await session.json()).user.role, role);

      const stateResponse = await fetch(`${baseUrl}/api/state`, {
        headers: { Authorization: `Bearer ${result.token}` }
      });
      assert.equal(stateResponse.status, 200);
      const state = await stateResponse.json();
      if (role !== "Super Admin") assert.deepEqual(state.people.map((item) => item.email), [email]);
      if (role === "Requester") {
        assert.ok(state.reservations.every((item) => item.requester === result.user.name));
        assert.equal(state.visitors.length, 0);
        const tampered = structuredClone(state);
        tampered.resources.push({ id: "R-FORBIDDEN", name: "Foreign Resource", office: "OSG", status: "Available" });
        const forbidden = await fetch(`${baseUrl}/api/state`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${result.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(tampered)
        });
        assert.equal(forbidden.status, 403);
      }
      if (role === "Office Admin") {
        assert.ok(state.resources.every((item) => item.office === result.user.office));
        assert.ok(state.reservations.every((item) =>
          item.office === result.user.office || item.approvalSteps?.some((step) => step.office === result.user.office)
        ));
      }
      if (role === "OSG Requester") assert.ok(state.visitors.every((item) => item.requester === result.user.name));
      if (role === "Super Admin") {
        assert.ok(state.people.length >= ACCOUNTS.length);
        const tampered = structuredClone(state);
        tampered.people.find((item) => item.email === email).status = "Inactive";
        const forbidden = await fetch(`${baseUrl}/api/state`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${result.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(tampered)
        });
        assert.equal(forbidden.status, 403);
      }
    }

    const credentialFile = await fetch(`${baseUrl}/data/accounts.json`);
    assert.equal(credentialFile.status, 404);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("supporting office can approve final step and create owner payment handoff", async () => {
  const dbPath = path.join(__dirname, "..", "data", "db.json");
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const { decideApprovalStep } = await import("../src/workflows.js");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "facilities.admin@ust.edu.ph", password: "Facilities2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    const reservation = state.reservations.find((item) =>
      item.resourceName === "Main Chapel"
      && item.office === "Simbahayan"
      && item.approvalSteps?.some((step) => step.office === "Facilities Management" && step.status === "Pending")
    );
    assert.ok(reservation);
    const step = reservation.approvalSteps.find((item) => item.office === "Facilities Management" && item.status === "Pending");

    decideApprovalStep(reservation, step.id, true, "Felix Mendoza", "Just now");
    assert.equal(reservation.status, "For Payment");
    reservation.paymentId = "PAY-LOCAL-HANDOFF";
    state.payments.unshift({
      id: "PAY-LOCAL-HANDOFF",
      reservationId: reservation.id,
      requester: reservation.requester,
      office: reservation.office,
      amount: 1000,
      receipt: "Awaiting upload",
      status: "Awaiting Receipt"
    });
    state.notifications.unshift({ id: "N-LOCAL-HANDOFF", user: reservation.requester, message: "Payment handoff created.", unread: true });
    state.activity.unshift({ action: "Approval step approved", actor: "Felix Mendoza", target: `${reservation.resourceName}: ${step.name}`, time: "Just now" });

    const save = await fetch(`${baseUrl}/api/state`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    const saveBody = await save.json();
    assert.equal(save.status, 200, saveBody.error);
  } finally {
    server.close();
    await once(server, "close");
    fs.writeFileSync(dbPath, originalDatabase);
  }
});

test("local API blocks reservations against hidden pending conflicts and reports alternatives", async () => {
  const dbPath = path.join(__dirname, "..", "data", "db.json");
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  const date = "2099-09-10";
  database.reservations.unshift({
    id: "REQ-HIDDEN-CONFLICT",
    requester: "Other Requester",
    resourceId: "R-007",
    resourceName: "Projector Set A",
    office: "Simbahayan",
    type: "Equipment",
    date,
    start: "09:00",
    end: "10:00",
    quantity: 1,
    purpose: "Existing pending request",
    status: "Under Owner Review",
    submittedAt: "Just now",
    requiresPayment: false,
    workflowTemplateId: "WF-BASIC",
    approvalSteps: [{ id: "REQ-HIDDEN-CONFLICT-OWNER", office: "Simbahayan", status: "Pending", sequence: 1 }]
  });
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));

  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "maria.jua@ust.edu.ph", password: "Requester2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const state = await stateResponse.json();
    assert.ok(!state.reservations.some((item) => item.id === "REQ-HIDDEN-CONFLICT"));

    const availability = await fetch(`${baseUrl}/api/resources/R-007/availability?date=${date}&start=09%3A30&end=10%3A30`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const availabilityBody = await availability.json();
    assert.equal(availability.status, 200, availabilityBody.error);
    assert.equal(availabilityBody.status, "conflict");
    assert.equal(availabilityBody.conflicts[0].requester, undefined);
    assert.ok(availabilityBody.alternatives.some((slot) => slot.status === "available"));

    state.reservations.unshift({
      id: "REQ-LOCAL-CONFLICT",
      requester: "Maria Jua",
      resourceId: "R-007",
      resourceName: "Projector Set A",
      office: "Simbahayan",
      type: "Equipment",
      date,
      start: "09:30",
      end: "10:30",
      quantity: 1,
      purpose: "Conflicting requester save",
      status: "Under Owner Review",
      submittedAt: "Just now",
      requiresPayment: false,
      workflowTemplateId: "WF-BASIC",
      approvalSteps: [{ id: "REQ-LOCAL-CONFLICT-OWNER", office: "Simbahayan", status: "Pending", sequence: 1 }]
    });
    state.activity.unshift({ id: "ACT-LOCAL-CONFLICT", action: "Reservation submitted", actor: "Maria Jua", target: "Projector Set A", time: "Just now" });

    const save = await fetch(`${baseUrl}/api/state`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    assert.equal(save.status, 409);
  } finally {
    server.close();
    await once(server, "close");
    fs.writeFileSync(dbPath, originalDatabase);
  }
});

test("super admin can mark visible notifications read through the local API", async () => {
  const dbPath = path.join(__dirname, "..", "data", "db.json");
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  database.notifications.unshift(
    { id: "N-SUPER-READ-1", user: "Maria Jua", message: "Requester alert.", unread: true, type: "System" },
    { id: "N-SUPER-READ-2", user: "Felix Mendoza", message: "Office alert.", unread: true, type: "System" }
  );
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));

  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sandra.alma@ust.edu.ph", password: "SuperAdmin2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const single = await fetch(`${baseUrl}/api/notifications/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "N-SUPER-READ-1" })
    });
    const singleBody = await single.json();
    assert.equal(single.status, 200, singleBody.error);
    assert.equal(singleBody.notifications.find((item) => item.id === "N-SUPER-READ-1").unread, false);
    assert.equal(singleBody.notifications.find((item) => item.id === "N-SUPER-READ-2").unread, true);

    const all = await fetch(`${baseUrl}/api/notifications/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const allBody = await all.json();
    assert.equal(all.status, 200, allBody.error);
    assert.equal(allBody.notifications.find((item) => item.id === "N-SUPER-READ-1").unread, false);
    assert.equal(allBody.notifications.find((item) => item.id === "N-SUPER-READ-2").unread, false);
  } finally {
    server.close();
    await once(server, "close");
    fs.writeFileSync(dbPath, originalDatabase);
  }
});

test("office admins can mark office notifications read without accessing private requester alerts", async () => {
  const dbPath = path.join(__dirname, "..", "data", "db.json");
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  database.notifications.unshift(
    { id: "N-OFFICE-READ", user: "Simbahayan", office: "Simbahayan", message: "Multipurpose Hall receipt needs verification.", unread: true, type: "Payment" },
    { id: "N-REQUESTER-PRIVATE", user: "Maria Jua", message: "Private requester notification.", unread: true, type: "Reservation" }
  );
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));

  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "maria.santos@ust.edu.ph", password: "OfficeAdmin2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const state = await stateResponse.json();
    assert.equal(stateResponse.status, 200);
    assert.ok(state.notifications.some((item) => item.id === "N-OFFICE-READ"));
    assert.ok(!state.notifications.some((item) => item.id === "N-REQUESTER-PRIVATE"));

    const save = await fetch(`${baseUrl}/api/notifications/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "N-OFFICE-READ" })
    });
    const saveBody = await save.json();
    assert.equal(save.status, 200, saveBody.error);
    assert.equal(saveBody.notifications.find((item) => item.id === "N-OFFICE-READ").unread, false);

    const forbidden = await fetch(`${baseUrl}/api/notifications/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "N-REQUESTER-PRIVATE" })
    });
    assert.equal(forbidden.status, 404);
  } finally {
    server.close();
    await once(server, "close");
    fs.writeFileSync(dbPath, originalDatabase);
  }
});
