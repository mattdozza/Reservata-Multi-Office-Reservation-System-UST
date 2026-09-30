const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const os = require("node:os");
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "reservata-tests-"));
const testDbPath = path.join(testDirectory, "db.json");
fs.copyFileSync(path.join(__dirname, "..", "data", "db.json"), testDbPath);
process.env.RESERVATA_DB_PATH = testDbPath;
const { createServer } = require("../server.js");
test.after(() => {
  fs.unlinkSync(testDbPath);
  fs.rmdirSync(testDirectory);
});

const ACCOUNTS = [
  ["student.body.requester@ust.edu.ph", "Requester2026!", "Requester"],
  ["simbahayan.admin@ust.edu.ph", "OfficeAdmin2026!", "Office Admin"],
  ["all.offices.admin@ust.edu.ph", "SuperAdmin2026!", "Super Admin"],
  ["osg.admin@ust.edu.ph", "OsgAdmin2026!", "OSG Admin"],
  ["cics.visitor.requester@ust.edu.ph", "Visitor2026!", "OSG Requester"],
  ["facilities.admin@ust.edu.ph", "Facilities2026!", "Office Admin"]
];

test("mock UST SSO completes an authorization-code PKCE flow with a single-use code", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const verifier = "reservata-pkce-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const request = {
    response_type: "code",
    client_id: "reservata-local",
    redirect_uri: "http://127.0.0.1:5178/",
    scope: "openid profile email",
    state: "state-from-reservata",
    code_challenge: challenge,
    code_challenge_method: "S256"
  };
  const formHeaders = { "Content-Type": "application/x-www-form-urlencoded" };
  const publicKeyResponse = await fetch(`${base}/mock-sso/public-key`);
  assert.equal(publicKeyResponse.status, 200);
  const publicKey = crypto.createPublicKey({ key: await publicKeyResponse.json(), format: "jwk" });
  const encryptPassword = (password) => crypto.publicEncrypt({
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256"
  }, Buffer.from(password)).toString("base64");
  const authorize = (password = ACCOUNTS[0][1], action = "continue") => {
    const form = new URLSearchParams({ ...request, email: ACCOUNTS[0][0], encrypted_password: action === "cancel" ? "" : encryptPassword(password), action });
    assert.equal(form.has("password"), false);
    if (password) assert.doesNotMatch(form.toString(), new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return fetch(`${base}/mock-sso/authorize`, {
      method: "POST",
      headers: formHeaders,
      body: form,
      redirect: "manual"
    });
  };
  try {
    const page = await fetch(`${base}/mock-sso/authorize?${new URLSearchParams(request)}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Mock Identity Provider/);
    assert.match(html, /<input name="email" type="email"/);
    assert.match(html, /name="encrypted_password"/);
    assert.match(html, /src="\/mock-sso\/encrypt\.js"/);
    assert.doesNotMatch(html, /name="password"/);
    assert.doesNotMatch(html, /<select/);
    assert.doesNotMatch(html, /student\.body\.requester@ust\.edu\.ph/);
    assert.doesNotMatch(html, /Requester2026!/);

    const hostile = await fetch(`${base}/mock-sso/authorize?${new URLSearchParams({ ...request, redirect_uri: "https://example.com/steal" })}`);
    assert.equal(hostile.status, 400);
    assert.doesNotMatch(await hostile.text(), /student\.body\.requester/);

    const plaintext = await fetch(`${base}/mock-sso/authorize`, {
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({ ...request, email: ACCOUNTS[0][0], password: ACCOUNTS[0][1], action: "continue" }),
      redirect: "manual"
    });
    assert.equal(plaintext.status, 401);

    const invalid = await authorize("incorrect");
    assert.equal(invalid.status, 401);
    assert.match(await invalid.text(), /email or password is incorrect/);

    const cancelled = await authorize("", "cancel");
    assert.equal(cancelled.status, 302);
    assert.equal(new URL(cancelled.headers.get("location")).searchParams.get("error"), "access_denied");

    const approved = await authorize();
    assert.equal(approved.status, 302);
    const callback = new URL(approved.headers.get("location"));
    assert.equal(callback.searchParams.get("state"), request.state);
    const code = callback.searchParams.get("code");
    assert.ok(code);

    const exchange = await fetch(`${base}/mock-sso/token`, {
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: request.client_id, redirect_uri: request.redirect_uri })
    });
    assert.equal(exchange.status, 200, await exchange.clone().text());
    const tokens = await exchange.json();
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.user.email, ACCOUNTS[0][0]);
    assert.equal(tokens.user.role, "Requester");

    const session = await fetch(`${base}/api/auth/session`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.role, "Requester");

    const replay = await fetch(`${base}/mock-sso/token`, {
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: request.client_id, redirect_uri: request.redirect_uri })
    });
    assert.equal(replay.status, 400);

    const secondApproval = await authorize();
    const secondCode = new URL(secondApproval.headers.get("location")).searchParams.get("code");
    const wrongVerifier = await fetch(`${base}/mock-sso/token`, {
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({ grant_type: "authorization_code", code: secondCode, code_verifier: "wrong-verifier", client_id: request.client_id, redirect_uri: request.redirect_uri })
    });
    assert.equal(wrongVerifier.status, 400);
    assert.match((await wrongVerifier.json()).error, /PKCE/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("resource photos are stored privately and limited to the resource office", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  let photoPath;
  try {
    const login = async (account) => {
      const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: account[0], password: account[1] }) });
      return { Authorization: `Bearer ${(await response.json()).token}`, "Content-Type": "application/json" };
    };
    const admin = await login(ACCOUNTS[1]);
    const requester = await login(ACCOUNTS[0]);
    const otherOffice = await login(ACCOUNTS[5]);
    const data = "data:image/jpeg;base64,/9j/2Q==";
    const post = (headers, photo) => fetch(`${base}/api/resource-photos`, { method: "POST", headers, body: JSON.stringify({ data: photo }) });
    assert.equal((await post(requester, data)).status, 403);
    assert.equal((await post(admin, "data:image/svg+xml;base64,PHN2Zz4=")).status, 400);
    const upload = await post(admin, data);
    assert.equal(upload.status, 201);
    const { key } = await upload.json();
    photoPath = path.join(__dirname, "..", "data", "resource-photos", key);
    assert.equal((await fetch(`${base}/api/resource-photos/${key}`, { headers: requester })).status, 404);
    const state = await (await fetch(`${base}/api/state`, { headers: admin })).json();
    const resource = state.resources.find((item) => item.status === "Available" && item.type !== "Visitor");
    assert.ok(resource);
    resource.photoKey = key;
    const saved = await fetch(`${base}/api/state`, { method: "PUT", headers: admin, body: JSON.stringify(state) });
    assert.equal(saved.status, 200, await saved.text());
    const preview = await fetch(`${base}/api/resource-photos/${key}`, { headers: requester });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).url, data);
    assert.equal((await fetch(`${base}/api/resource-photos/${key}`, { headers: otherOffice })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(dbPath, originalDatabase);
    if (photoPath && fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
  }
});

function daysFromTodayIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

test("local login authenticates accounts and derives their assigned roles", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
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
    fs.writeFileSync(dbPath, originalDatabase);
  }
});

test("local API expires overdue unfinished reservations and payment handoffs", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  const date = daysFromTodayIso(-1);
  database.reservations.unshift({
    id: "REQ-LOCAL-EXPIRED",
    requester: "Student Body Requester",
    resourceId: "R-001",
    resourceName: "Multipurpose Hall",
    office: "Simbahayan",
    type: "Facility",
    date,
    start: "09:00",
    end: "10:00",
    quantity: 1,
    purpose: "Overdue payment handoff",
    status: "For Payment",
    submittedAt: "Just now",
    requiresPayment: true,
    paymentId: "PAY-LOCAL-EXPIRED",
    approvalSteps: [{ id: "REQ-LOCAL-EXPIRED-OWNER", office: "Simbahayan", status: "Approved", sequence: 1 }]
  });
  database.payments.unshift({
    id: "PAY-LOCAL-EXPIRED",
    reservationId: "REQ-LOCAL-EXPIRED",
    requester: "Student Body Requester",
    office: "Simbahayan",
    amount: 1000,
    receipt: "Awaiting upload",
    status: "Awaiting Receipt"
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
      body: JSON.stringify({ email: "student.body.requester@ust.edu.ph", password: "Requester2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const state = await stateResponse.json();
    assert.equal(stateResponse.status, 200, state.error);
    assert.equal(state.reservations.find((item) => item.id === "REQ-LOCAL-EXPIRED").status, "Expired");
    assert.equal(state.payments.find((item) => item.id === "PAY-LOCAL-EXPIRED").status, "Expired");
    assert.ok(state.notifications.some((item) => item.message.includes("expired because the scheduled time passed")));

    const saved = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    assert.equal(saved.reservations.find((item) => item.id === "REQ-LOCAL-EXPIRED").status, "Expired");
  } finally {
    server.close();
    await once(server, "close");
    fs.writeFileSync(dbPath, originalDatabase);
  }
});

test("local API accepts requester cancellation and reschedule mutations", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  database.reservations.unshift(
    {
      id: "REQ-API-CANCEL",
      requester: "Student Body Requester",
      resourceId: "R-007",
      resourceName: "Projector Set A",
      office: "Simbahayan",
      type: "Equipment",
      date: daysFromTodayIso(5),
      start: "09:00",
      end: "10:00",
      quantity: 1,
      purpose: "Requester cancellation mutation",
      status: "Under Owner Review",
      approvalSteps: [{ id: "REQ-API-CANCEL-OWNER", office: "Simbahayan", status: "Pending", sequence: 1 }]
    },
    {
      id: "REQ-API-RESCHEDULE",
      requester: "Student Body Requester",
      resourceId: "R-007",
      resourceName: "Projector Set A",
      office: "Simbahayan",
      type: "Equipment",
      date: daysFromTodayIso(6),
      start: "11:00",
      end: "12:00",
      quantity: 1,
      purpose: "Requester reschedule mutation",
      status: "Confirmed",
      approvalSteps: [{ id: "REQ-API-RESCHEDULE-OWNER", office: "Simbahayan", status: "Approved", sequence: 1 }]
    }
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
      body: JSON.stringify({ email: "student.body.requester@ust.edu.ph", password: "Requester2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const state = await stateResponse.json();
    const cancelled = state.reservations.find((item) => item.id === "REQ-API-CANCEL");
    cancelled.status = "Cancelled";
    cancelled.cancelledAt = "Just now";
    cancelled.cancelledBy = "Student Body Requester";
    cancelled.cancellationReason = "Schedule no longer needed";
    cancelled.approvalSteps[0].status = "Skipped";
    const rescheduled = state.reservations.find((item) => item.id === "REQ-API-RESCHEDULE");
    rescheduled.status = "Under Owner Review";
    rescheduled.date = daysFromTodayIso(8);
    rescheduled.start = "14:00";
    rescheduled.end = "15:00";
    rescheduled.rescheduleCount = 1;
    rescheduled.rescheduledAt = "Just now";
    rescheduled.approvalSteps[0].status = "Pending";
    state.notifications.unshift({ id: "N-API-LIFECYCLE", user: "Simbahayan", office: "Simbahayan", message: "Requester changed reservations.", unread: true, type: "Reservation" });
    state.activity.unshift({ id: "ACT-API-LIFECYCLE", action: "Reservation lifecycle changed", actor: "Student Body Requester", target: "Projector Set A", time: "Just now" });

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

test("supporting office can approve final step and create owner payment handoff", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  const date = daysFromTodayIso(10);
  database.reservations.unshift({
    id: "REQ-LOCAL-HANDOFF-SOURCE",
    requester: "Student Body Requester",
    resourceId: "R-002",
    resourceName: "Main Chapel",
    office: "Simbahayan",
    type: "Facility",
    date,
    start: "09:00",
    end: "10:00",
    quantity: 1,
    purpose: "Future approval handoff test",
    status: "Under Additional Review",
    submittedAt: "Just now",
    requiresPayment: true,
    workflowTemplateId: "WF-EVENT",
    approvalSteps: [
      { id: "REQ-LOCAL-HANDOFF-SOURCE-OWNER", name: "Venue Owner Review", office: "Simbahayan", status: "Approved", sequence: 1 },
      { id: "REQ-LOCAL-HANDOFF-SOURCE-FAC", name: "Facilities and Setup Review", office: "Facilities Management", status: "Pending", sequence: 2 }
    ]
  });
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));
  const { decideApprovalStep } = await import("../src/domain/workflows.js");
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

    decideApprovalStep(reservation, step.id, true, "Facilities Office Admin", "Just now");
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
    state.activity.unshift({ action: "Approval step approved", actor: "Facilities Office Admin", target: `${reservation.resourceName}: ${step.name}`, time: "Just now" });

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

test("local API lets requesters upload receipts and notify the payment office", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  database.reservations.unshift({
    id: "REQ-LOCAL-RECEIPT",
    requester: "Student Body Requester",
    resourceId: "R-004",
    resourceName: "Multipurpose Hall",
    office: "Simbahayan",
    type: "Facility",
    date: "2099-09-10",
    start: "09:00",
    end: "10:00",
    quantity: 1,
    purpose: "Receipt upload regression test",
    status: "For Payment",
    submittedAt: "Just now",
    requiresPayment: true,
    paymentId: "PAY-LOCAL-RECEIPT",
    workflowTemplateId: "WF-VENUE",
    approvalSteps: [{ id: "REQ-LOCAL-RECEIPT-OWNER", office: "Simbahayan", status: "Approved", sequence: 1 }]
  });
  database.payments.unshift({
    id: "PAY-LOCAL-RECEIPT",
    reservationId: "REQ-LOCAL-RECEIPT",
    requester: "Student Body Requester",
    office: "Simbahayan",
    amount: 1500,
    receipt: "Awaiting upload",
    status: "Awaiting Receipt"
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
      body: JSON.stringify({ email: "student.body.requester@ust.edu.ph", password: "Requester2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const state = await stateResponse.json();
    const payment = state.payments.find((item) => item.id === "PAY-LOCAL-RECEIPT");
    assert.ok(payment);
    payment.receipt = "receipt.jpg";
    payment.receiptType = "image/jpeg";
    payment.status = "Pending Verification";
    state.notifications.unshift({
      id: "N-LOCAL-RECEIPT",
      user: "Simbahayan",
      office: "Simbahayan",
      message: "Multipurpose Hall: Student Body Requester uploaded a receipt for verification.",
      unread: true,
      type: "Payment"
    });
    state.activity.unshift({
      id: "ACT-LOCAL-RECEIPT",
      action: "Payment receipt uploaded",
      actor: "Student Body Requester",
      target: "Multipurpose Hall",
      time: "Just now"
    });

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
  const dbPath = testDbPath;
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
      body: JSON.stringify({ email: "student.body.requester@ust.edu.ph", password: "Requester2026!" })
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
      requester: "Student Body Requester",
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
    state.activity.unshift({ id: "ACT-LOCAL-CONFLICT", action: "Reservation submitted", actor: "Student Body Requester", target: "Projector Set A", time: "Just now" });

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

test("local API ignores expired reservations when checking availability conflicts", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  const date = daysFromTodayIso(10);
  database.reservations.unshift({
    id: "REQ-EXPIRED-NONBLOCKING",
    requester: "Other Requester",
    resourceId: "R-007",
    resourceName: "Projector Set A",
    office: "Simbahayan",
    type: "Equipment",
    date,
    start: "09:00",
    end: "10:00",
    quantity: 1,
    purpose: "Expired request should not block",
    status: "Expired",
    submittedAt: "Just now",
    requiresPayment: false,
    approvalSteps: [{ id: "REQ-EXPIRED-NONBLOCKING-OWNER", office: "Simbahayan", status: "Skipped", sequence: 1 }]
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
      body: JSON.stringify({ email: "student.body.requester@ust.edu.ph", password: "Requester2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const availability = await fetch(`${baseUrl}/api/resources/R-007/availability?date=${date}&start=09%3A30&end=10%3A30`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const availabilityBody = await availability.json();
    assert.equal(availability.status, 200, availabilityBody.error);
    assert.equal(availabilityBody.status, "available");
  } finally {
    server.close();
    await once(server, "close");
    fs.writeFileSync(dbPath, originalDatabase);
  }
});

test("single notification read only clears the clicked duplicate-safe id", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  database.notifications.unshift(
    { id: "N-DUPLICATE", user: "Student Body Requester", message: "Resource Owner Review was approved. Current status: Confirmed.", unread: true, type: "Approval" },
    { id: "N-DUPLICATE", user: "Student Body Requester", message: "Resource Owner Review was approved. Current status: Confirmed.", unread: true, type: "Approval" }
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
      body: JSON.stringify({ email: "student.body.requester@ust.edu.ph", password: "Requester2026!" })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();

    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const state = await stateResponse.json();
    const duplicates = state.notifications.filter((item) => item.message === "Resource Owner Review was approved. Current status: Confirmed.");
    assert.equal(new Set(duplicates.map((item) => item.id)).size, duplicates.length);

    const clicked = duplicates[1].id;
    const read = await fetch(`${baseUrl}/api/notifications/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: clicked })
    });
    const readBody = await read.json();
    assert.equal(read.status, 200, readBody.error);
    const updated = readBody.notifications.filter((item) => item.message === "Resource Owner Review was approved. Current status: Confirmed.");
    assert.equal(updated.filter((item) => !item.unread).length, 1);
    assert.equal(updated.find((item) => item.id === clicked).unread, false);
  } finally {
    server.close();
    await once(server, "close");
    fs.writeFileSync(dbPath, originalDatabase);
  }
});
test("super admin can mark visible notifications read through the local API", async () => {
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  database.notifications.unshift(
    { id: "N-SUPER-READ-1", user: "Student Body Requester", message: "Requester alert.", unread: true, type: "System" },
    { id: "N-SUPER-READ-2", user: "Facilities Office Admin", message: "Office alert.", unread: true, type: "System" }
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
      body: JSON.stringify({ email: "all.offices.admin@ust.edu.ph", password: "SuperAdmin2026!" })
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
  const dbPath = testDbPath;
  const originalDatabase = fs.readFileSync(dbPath, "utf8");
  const database = JSON.parse(originalDatabase);
  database.notifications.unshift(
    { id: "N-OFFICE-READ", user: "Simbahayan", office: "Simbahayan", message: "Multipurpose Hall receipt needs verification.", unread: true, type: "Payment" },
    { id: "N-REQUESTER-PRIVATE", user: "Student Body Requester", message: "Private requester notification.", unread: true, type: "Reservation" }
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
      body: JSON.stringify({ email: "simbahayan.admin@ust.edu.ph", password: "OfficeAdmin2026!" })
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
