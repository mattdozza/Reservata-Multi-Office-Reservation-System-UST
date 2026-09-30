const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DB_PATH = process.env.RESERVATA_DB_PATH || path.join(ROOT, "data", "db.json");
const ACCOUNTS_PATH = process.env.RESERVATA_ACCOUNTS_PATH || path.join(ROOT, "data", "accounts.json");
const DIST_PATH = path.join(ROOT, "dist");
const RESOURCE_PHOTOS_PATH = path.join(ROOT, "data", "resource-photos");
const STATIC_ROOT = fs.existsSync(DIST_PATH) ? DIST_PATH : ROOT;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const mockAuthorizationCodes = new Map();
const MOCK_SSO_CLIENT_ID = "reservata-local";
const MOCK_SSO_CODE_TTL_MS = 2 * 60 * 1000;
const {
  publicKey: MOCK_SSO_PUBLIC_KEY,
  privateKey: MOCK_SSO_PRIVATE_KEY
} = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const MOCK_SSO_PUBLIC_JWK = {
  ...MOCK_SSO_PUBLIC_KEY.export({ format: "jwk" }),
  alg: "RSA-OAEP-256",
  ext: true,
  key_ops: ["encrypt"]
};
const BLOCKING_RESERVATION_STATUSES = ["Under Owner Review", "Under Additional Review", "Approved", "Confirmed", "For Payment", "In Use"];
const RESOLVED_RESERVATION_STATUSES = ["Rejected", "Cancelled", "Completed", "Expired", "No Show"];
const ACTIVE_PAYMENT_STATUSES = ["Awaiting Receipt", "Pending Verification"];
const CLOSED_PAYMENT_STATUSES = ["Verified", "Rejected", "Cancelled", "Expired"];
const DEFAULT_PAYMENT_DEADLINE_HOURS = 24;
const MIN_PAYMENT_DEADLINE_HOURS = 1;
const MAX_PAYMENT_DEADLINE_HOURS = 168;
const BUSINESS_DAY_START = 8 * 60;
const BUSINESS_DAY_END = 17 * 60;
const DEFAULT_SLOT_MINUTES = 60;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

const COMPRESSIBLE_STATIC_TYPES = new Set([".html", ".css", ".js", ".json", ".md", ".svg"]);

const ROLE_MUTATIONS = {
  Requester: ["reservations", "payments", "visitors", "notifications", "activity"],
  "Office Admin": ["resources", "reservations", "payments", "notifications", "activity"],
  "Super Admin": ["resources", "people", "offices", "approvalTemplates", "systemSettings", "notifications", "activity"],
  "OSG Admin": ["reservations", "payments", "visitors", "notifications", "activity"]
};

const REQUESTER_TYPES = new Set(["Student", "Faculty", "Staff", "Student Org Rep"]);
const VISITOR_CAPABLE_REQUESTER_TYPES = new Set(["Faculty", "Staff", "Student Org Rep"]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data, null, 2));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(text);
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  response.end(html);
}

function sendJavaScript(response, source) {
  response.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(source);
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function readDatabase() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDatabase(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function readAccounts() {
  return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8"));
}

function writeAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, passwordHash };
}

function generateTempPassword() {
  return `Rsv${crypto.randomBytes(6).toString("base64url")}!`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new HttpError(413, "Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function readFormBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        reject(new HttpError(413, "Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
    request.on("error", reject);
  });
}

function sanitizeState(input) {
  const allowedKeys = ["resources", "reservations", "payments", "visitors", "people", "offices", "approvalTemplates", "systemSettings", "notifications", "activity"];
  return Object.fromEntries(allowedKeys.map((key) => [key, Array.isArray(input[key]) ? input[key] : []]));
}

function notificationWithOffice(notification, offices) {
  if (notification.office) return notification;
  const message = String(notification.message || "");
  const office = offices.find((item) =>
    message.includes(item.name) && /(routed to|needs review|verification|uploaded a receipt)/i.test(message)
  );
  return office ? { ...notification, office: office.name } : notification;
}

function uniqueNotifications(notifications, offices) {
  const seen = new Set();
  return notifications.map((notification, index) => {
    const item = notificationWithOffice(notification, offices);
    const base = item.id || `N-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    return id === item.id ? item : { ...item, id };
  });
}

function normalizeAssetTag(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeResourceTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 32)))].slice(0, 8);
}

function normalizeState(input) {
  const clean = sanitizeState(input);
  clean.resources = clean.resources.map((resource) => ({
    ...resource,
    assetTag: normalizeAssetTag(resource.assetTag || resource.id),
    serialNumber: String(resource.serialNumber || "").trim(),
    tags: normalizeResourceTags(resource.tags || [resource.type, resource.office]),
    workflowTemplateId: resource.workflowTemplateId || "WF-BASIC"
  }));
  clean.systemSettings = (clean.systemSettings.length ? clean.systemSettings : [{ id: "SYSTEM" }]).map((settings) => ({
    ...settings,
    id: settings.id || "SYSTEM",
    paymentDeadlineHours: normalizePaymentDeadlineHours(settings.paymentDeadlineHours)
  }));
  clean.reservations = clean.reservations.map((reservation) => {
    if (reservation.approvalSteps?.length) return reservation;
    const stepStatus = reservation.status === "Pending"
      ? "Pending"
      : reservation.status === "Rejected"
        ? "Rejected"
        : "Approved";
    return {
      ...reservation,
      status: reservation.status === "Pending" ? "Under Owner Review" : reservation.status,
      workflowTemplateId: reservation.workflowTemplateId || "WF-BASIC",
      approvalSteps: [{
        id: `${reservation.id}-OWNER`,
        templateStepId: "OWNER",
        name: "Resource Owner Review",
        office: reservation.office,
        sequence: 1,
        condition: "always",
        status: stepStatus,
        decidedBy: stepStatus === "Pending" ? "" : "Legacy migration",
        decidedAt: ""
      }]
    };
  });
  clean.notifications = uniqueNotifications(clean.notifications, clean.offices);
  return clean;
}

function createRecordId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function reservationEndPassed(reservation) {
  if (!reservation?.date || !reservation?.end) return false;
  const endTime = new Date(`${reservation.date}T${reservation.end}`).getTime();
  return Number.isFinite(endTime) && endTime < Date.now();
}

function reservationStartPassed(reservation) {
  if (!reservation?.date || !reservation?.start) return false;
  const startTime = new Date(`${reservation.date}T${reservation.start}`).getTime();
  return Number.isFinite(startTime) && startTime <= Date.now();
}

function normalizePaymentDeadlineHours(value, fallback = DEFAULT_PAYMENT_DEADLINE_HOURS) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= MIN_PAYMENT_DEADLINE_HOURS && number <= MAX_PAYMENT_DEADLINE_HOURS) {
    return number;
  }
  return fallback;
}

function effectivePaymentDeadlineHours(resource, settings = {}) {
  return normalizePaymentDeadlineHours(
    resource?.paymentDeadlineHours,
    normalizePaymentDeadlineHours(settings?.paymentDeadlineHours)
  );
}

function paymentDeadlineFor(reservation, payment, createdAt = nowIso(), deadlineHours = DEFAULT_PAYMENT_DEADLINE_HOURS) {
  const base = new Date(payment?.createdAt || payment?.submittedAt || createdAt).getTime();
  const rolling = Number.isFinite(base) ? new Date(base + deadlineHours * 60 * 60 * 1000).toISOString() : "";
  const scheduled = reservation?.date && reservation?.start ? new Date(`${reservation.date}T${reservation.start}`).toISOString() : "";
  if (!rolling) return scheduled;
  if (!scheduled) return rolling;
  return new Date(rolling).getTime() <= new Date(scheduled).getTime() ? rolling : scheduled;
}

function deadlinePassed(deadline) {
  const value = new Date(deadline || "").getTime();
  return Number.isFinite(value) && value < Date.now();
}

function appendNotification(database, user, message, type = "Reservation") {
  const office = database.offices.find((item) => item.name === user);
  database.notifications.unshift({
    id: createRecordId("N"),
    user,
    ...(office ? { office: office.name } : {}),
    message,
    type,
    unread: true,
    time: nowIso()
  });
}

function expireOverdueReservations(database) {
  const expiredAt = nowIso();
  const candidates = database.reservations.filter((reservation) => !RESOLVED_RESERVATION_STATUSES.includes(reservation.status));
  let changed = 0;
  for (const reservation of candidates) {
    const payment = database.payments.find((item) => item.id === reservation.paymentId || item.reservationId === reservation.id);
    if (payment && payment.status === "Awaiting Receipt" && !payment.paymentDeadlineAt) {
      const resource = database.resources.find((item) => item.id === reservation.resourceId);
      payment.paymentDeadlineHours = normalizePaymentDeadlineHours(
        payment.paymentDeadlineHours,
        effectivePaymentDeadlineHours(resource, database.systemSettings?.[0])
      );
      payment.paymentDeadlineAt = paymentDeadlineFor(reservation, payment, nowIso(), payment.paymentDeadlineHours);
      changed += 1;
    }
    if (["Confirmed", "In Use"].includes(reservation.status) && reservationEndPassed(reservation)) {
      reservation.status = "Completed";
      reservation.completedAt = expiredAt;
      appendNotification(database, reservation.requester, `${reservation.resourceName} was completed after its scheduled use.`);
      database.activity.unshift({
        id: createRecordId("ACT"),
        action: "Reservation completed",
        actor: "System",
        target: reservation.resourceName,
        details: reservation.id,
        time: expiredAt
      });
      changed += 1;
      continue;
    }
    const paymentExpired = reservation.status === "For Payment" && payment?.status === "Awaiting Receipt" && deadlinePassed(payment.paymentDeadlineAt);
    const scheduleExpired = !["Confirmed", "In Use"].includes(reservation.status) && reservationEndPassed(reservation);
    if (!paymentExpired && !scheduleExpired) {
      if (reservation.status === "For Payment" && payment?.status === "Awaiting Receipt" && !payment.paymentReminderSentAt) {
        payment.paymentReminderSentAt = expiredAt;
        appendNotification(database, reservation.requester, `${reservation.resourceName} is awaiting receipt upload before ${payment.paymentDeadlineAt || "the payment deadline"}.`, "Payment");
        changed += 1;
      }
      if (["Under Owner Review", "Under Additional Review", "Approved"].includes(reservation.status) && !reservation.reviewReminderSentAt) {
        const submitted = new Date(reservation.submittedAt || reservation.createdAt || "").getTime();
        if (Number.isFinite(submitted) && Date.now() - submitted > 24 * 60 * 60 * 1000) {
          reservation.reviewReminderSentAt = expiredAt;
          appendNotification(database, reservation.office, `${reservation.resourceName} has been waiting for review for more than 24 hours.`, "Approval");
          changed += 1;
        }
      }
      if (reservation.status === "Confirmed" && !reservation.upcomingReminderSentAt) {
        const startTime = new Date(`${reservation.date}T${reservation.start || "00:00"}`).getTime();
        if (Number.isFinite(startTime) && startTime > Date.now() && startTime - Date.now() <= 24 * 60 * 60 * 1000) {
          reservation.upcomingReminderSentAt = expiredAt;
          appendNotification(database, reservation.requester, `${reservation.resourceName} is scheduled within the next 24 hours.`);
          changed += 1;
        }
      }
      continue;
    }
    reservation.status = "Expired";
    reservation.expiredAt = expiredAt;
    reservation.expiryReason = paymentExpired
      ? "Payment deadline passed before final confirmation."
      : "Scheduled end time passed before final confirmation.";
    reservation.approvalSteps = (reservation.approvalSteps || []).map((step) =>
      ["Pending", "Waiting"].includes(step.status) ? { ...step, status: "Skipped" } : step
    );
    if (payment && ACTIVE_PAYMENT_STATUSES.includes(payment.status)) {
        payment.status = "Expired";
        payment.rejectionReason = "Reservation expired before final confirmation.";
        payment.updatedAt = expiredAt;
    }
    appendNotification(database, reservation.requester, `${reservation.resourceName} expired because ${paymentExpired ? "the payment deadline passed" : "the scheduled time passed before final confirmation"}.`);
    appendNotification(database, reservation.office, `${reservation.resourceName}: ${reservation.requester}'s request expired before final confirmation.`);
    database.activity.unshift({
      id: createRecordId("ACT"),
      action: "Reservation expired",
      actor: "System",
      target: reservation.resourceName,
      details: reservation.id,
      time: expiredAt
    });
    changed += 1;
  }
  return changed;
}

function readLifecycleDatabase() {
  const database = normalizeState(readDatabase());
  if (expireOverdueReservations(database)) writeDatabase(database);
  return database;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function todayIso() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function assertReservationLeadTime(reservation) {
  if (!reservation?.date || reservation.date < todayIso()) {
    throw new HttpError(400, "Reservation date cannot be in the past.");
  }
  if (reservation.date < tomorrowIso()) {
    throw new HttpError(400, "Reservations must be submitted at least one day before the time of use.");
  }
}

function toMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

function fromMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function selectedDuration(start, end) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return DEFAULT_SLOT_MINUTES;
  return Math.min(endMinutes - startMinutes, 12 * 60);
}

function addDaysIso(date, days) {
  const value = date || tomorrowIso();
  const next = new Date(`${value}T00:00:00`);
  next.setDate(next.getDate() + days);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 10);
}

function reservationConflicts(database, resourceId, date, start, end, excludeId = "") {
  if (!resourceId || !date || !start || !end || start >= end) return [];
  return database.reservations.filter((reservation) =>
    reservation.id !== excludeId
    && reservation.resourceId === resourceId
    && reservation.date === date
    && BLOCKING_RESERVATION_STATUSES.includes(reservation.status)
    && start < reservation.end
    && end > reservation.start
  );
}

function publicConflicts(conflicts) {
  return conflicts.map((item) => ({
    id: item.id,
    date: item.date,
    start: item.start,
    end: item.end,
    status: item.status
  }));
}

function reservationSlotOptions(database, resource, date, start, end) {
  if (!resource || !date) return [];
  const duration = selectedDuration(start, end);
  const step = duration >= DEFAULT_SLOT_MINUTES ? DEFAULT_SLOT_MINUTES : 30;
  const unavailableDay = resource.status !== "Available" || date < tomorrowIso();
  const options = [];
  for (let minute = BUSINESS_DAY_START; minute + duration <= BUSINESS_DAY_END; minute += step) {
    const slotStart = fromMinutes(minute);
    const slotEnd = fromMinutes(minute + duration);
    const conflicts = unavailableDay ? [] : reservationConflicts(database, resource.id, date, slotStart, slotEnd);
    options.push({
      date,
      start: slotStart,
      end: slotEnd,
      status: unavailableDay || conflicts.length ? "unavailable" : "available",
      conflicts: publicConflicts(conflicts)
    });
  }
  return options;
}

function availableAlternatives(database, resource, date, start, end, limit = 6) {
  const startDate = date && date >= tomorrowIso() ? date : tomorrowIso();
  const alternatives = [];
  for (let day = 0; day < 10 && alternatives.length < limit; day += 1) {
    const candidateDate = addDaysIso(startDate, day);
    const daily = reservationSlotOptions(database, resource, candidateDate, start, end)
      .filter((slot) => slot.status === "available");
    alternatives.push(...daily.slice(0, limit - alternatives.length));
  }
  return alternatives;
}

function resourceAvailability(database, resourceId, date, start, end) {
  const resource = database.resources.find((item) => item.id === resourceId);
  const emptySlots = { slots: [], alternatives: [] };
  if (!resource) return { status: "unavailable", message: "Select a resource first.", conflicts: [], ...emptySlots };
  if (resource.status !== "Available") return { status: "unavailable", message: `${resource.name} is currently ${resource.status}.`, conflicts: [], ...emptySlots };
  if (!date || !start || !end) return { status: "pending", message: "Choose a date, start time, and end time to check availability.", conflicts: [], ...emptySlots };
  if (date < tomorrowIso()) return {
    status: "unavailable",
    message: "Reservations must be made at least one day before the time of use.",
    conflicts: [],
    slots: reservationSlotOptions(database, resource, tomorrowIso(), start, end),
    alternatives: availableAlternatives(database, resource, tomorrowIso(), start, end)
  };
  if (start >= end) return {
    status: "unavailable",
    message: "End time must be later than start time.",
    conflicts: [],
    slots: reservationSlotOptions(database, resource, date, start, end),
    alternatives: []
  };
  const conflicts = reservationConflicts(database, resource.id, date, start, end);
  if (conflicts.length) return {
    status: "conflict",
    message: `${resource.name} has an overlapping request in that slot.`,
    conflicts: publicConflicts(conflicts),
    slots: reservationSlotOptions(database, resource, date, start, end),
    alternatives: availableAlternatives(database, resource, date, start, end)
  };
  return {
    status: "available",
    message: `${resource.name} is available for the selected slot.`,
    conflicts: [],
    slots: reservationSlotOptions(database, resource, date, start, end),
    alternatives: availableAlternatives(database, resource, date, start, end)
  };
}

function verifyPassword(password, credential) {
  if (!credential || typeof password !== "string") return false;
  const actual = crypto.scryptSync(password, credential.salt, 64);
  const expected = Buffer.from(credential.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicUser(person) {
  return {
    name: person.name,
    email: person.email,
    office: person.office,
    role: person.role,
    requesterType: person.requesterType || "",
    status: person.status
  };
}

function createSession(email) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function bearerToken(request) {
  const match = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function authenticatedUser(request) {
  const token = bearerToken(request);
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    throw new HttpError(401, "Please sign in to continue.");
  }

  const person = readLifecycleDatabase().people.find((item) => normalizeEmail(item.email) === session.email);
  if (!person || person.status !== "Active" || !ROLE_MUTATIONS[person.role]) {
    sessions.delete(token);
    throw new HttpError(403, "This Reservata account is not active or has no supported role.");
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return publicUser(person);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mockSsoParameters(source, request) {
  const parameters = {
    responseType: source.response_type,
    clientId: source.client_id,
    redirectUri: source.redirect_uri,
    scope: source.scope || "openid profile email",
    state: source.state,
    codeChallenge: source.code_challenge,
    codeChallengeMethod: source.code_challenge_method
  };
  let redirectUrl;
  try { redirectUrl = new URL(parameters.redirectUri); }
  catch { throw new HttpError(400, "The mock SSO redirect URI is invalid."); }
  const requestOrigin = new URL(`http://${request.headers.host}`).origin;
  const configuredAppOrigin = new URL(process.env.RESERVATA_APP_ORIGIN || "http://127.0.0.1:5178").origin;
  const allowedOrigins = new Set([
    requestOrigin,
    configuredAppOrigin,
    "http://127.0.0.1:5178",
    "http://localhost:5178"
  ]);
  if (!allowedOrigins.has(redirectUrl.origin) || !["127.0.0.1", "localhost"].includes(redirectUrl.hostname)) {
    throw new HttpError(400, "The mock SSO redirect URI must use this local application origin.");
  }
  if (parameters.responseType !== "code" || parameters.clientId !== MOCK_SSO_CLIENT_ID) {
    throw new HttpError(400, "The mock SSO client request is invalid.");
  }
  if (!parameters.state || !parameters.codeChallenge || parameters.codeChallengeMethod !== "S256") {
    throw new HttpError(400, "Mock SSO requires state and PKCE S256 protection.");
  }
  return parameters;
}

function mockSsoRedirect(parameters, values) {
  const destination = new URL(parameters.redirectUri);
  for (const [key, value] of Object.entries(values)) destination.searchParams.set(key, value);
  destination.searchParams.set("state", parameters.state);
  return destination.toString();
}

const MOCK_SSO_ENCRYPTION_SCRIPT = `(() => {
  const form = document.querySelector("form[data-encrypted-login]");
  const password = document.getElementById("mock-sso-password");
  const encryptedPassword = document.getElementById("mock-sso-encrypted-password");
  const encryptionError = document.getElementById("mock-sso-encryption-error");
  let encryptedSubmission = false;

  function base64(bytes) {
    let binary = "";
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  form.addEventListener("submit", async (event) => {
    if (encryptedSubmission || event.submitter?.value === "cancel") return;
    event.preventDefault();
    encryptionError.hidden = true;
    try {
      const response = await fetch("/mock-sso/public-key", { cache: "no-store" });
      if (!response.ok) throw new Error("Public key unavailable");
      const publicKey = await crypto.subtle.importKey(
        "jwk",
        await response.json(),
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
      );
      const ciphertext = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        publicKey,
        new TextEncoder().encode(password.value)
      );
      encryptedPassword.value = base64(ciphertext);
      password.value = "";
      encryptedSubmission = true;
      form.requestSubmit(event.submitter);
    } catch {
      encryptionError.hidden = false;
    }
  });
})();`;

function decryptMockSsoPassword(ciphertext) {
  if (typeof ciphertext !== "string" || ciphertext.length > 512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    throw new Error("Invalid encrypted password");
  }
  return crypto.privateDecrypt({
    key: MOCK_SSO_PRIVATE_KEY,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256"
  }, Buffer.from(ciphertext, "base64")).toString("utf8");
}

function mockSsoPage(parameters, { error = "", selectedEmail = "" } = {}) {
  const hidden = [
    ["response_type", parameters.responseType],
    ["client_id", parameters.clientId],
    ["redirect_uri", parameters.redirectUri],
    ["scope", parameters.scope],
    ["state", parameters.state],
    ["code_challenge", parameters.codeChallenge],
    ["code_challenge_method", parameters.codeChallengeMethod]
  ].map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mock UST SSO</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; color: #17191f; background: #f3f3f1; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 460px); background: white; border: 1px solid #d9d9d5; border-radius: 8px; box-shadow: 0 18px 50px rgba(20,20,20,.12); overflow: hidden; }
    header { display: flex; align-items: center; gap: 14px; padding: 22px 26px; color: white; background: #080a0f; border-bottom: 5px solid #ffbd1a; }
    header img { width: 48px; height: 48px; padding: 4px; object-fit: contain; border-radius: 7px; background: white; }
    header strong, header span { display: block; }
    header strong { font-size: 19px; }
    header span { margin-top: 3px; color: #ccd1da; font-size: 12px; }
    form { display: grid; gap: 17px; padding: 28px 26px; }
    h1 { margin: 0; font-size: 25px; }
    .intro { margin: -8px 0 2px; color: #626875; font-size: 14px; line-height: 1.5; }
    label { display: grid; gap: 7px; font-size: 13px; font-weight: 700; }
    input { width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid #c8cbd1; border-radius: 6px; background: white; color: #17191f; font: inherit; }
    input:focus { outline: 3px solid rgba(27,126,159,.18); border-color: #1b7e9f; }
    .error { margin: 0; padding: 11px 12px; color: #8d2020; background: #fff0f0; border-left: 3px solid #b52e2e; font-size: 13px; }
    .error[hidden] { display: none; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 3px; }
    button { min-height: 44px; padding: 0 17px; border-radius: 6px; border: 1px solid #c8cbd1; font: inherit; font-weight: 700; cursor: pointer; }
    .cancel { background: white; color: #252932; }
    .continue { border-color: #d99f00; background: #ffbd1a; color: #111318; }
  </style>
</head>
<body>
  <main>
    <header><img src="/images/logo2.svg" alt="UST seal"><div><strong>University of Santo Tomas</strong><span>Mock Identity Provider</span></div></header>
    <form method="post" action="/mock-sso/authorize" data-encrypted-login>
      <h1>Sign in to RESERVATA</h1>
      <p class="intro">Use your university account to continue.</p>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${hidden}
      <input id="mock-sso-encrypted-password" name="encrypted_password" type="hidden">
      <label>University email<input name="email" type="email" value="${escapeHtml(selectedEmail)}" placeholder="name@ust.edu.ph" autocomplete="username" required autofocus></label>
      <label>Password<input id="mock-sso-password" type="password" autocomplete="current-password" maxlength="128" required></label>
      <p class="error" id="mock-sso-encryption-error" role="alert" hidden>Secure password submission could not be prepared. Please try again.</p>
      <div class="actions">
        <button class="cancel" name="action" value="cancel" formnovalidate>Cancel</button>
        <button class="continue" name="action" value="continue">Continue</button>
      </div>
    </form>
    <script src="/mock-sso/encrypt.js" defer></script>
  </main>
</body>
</html>`;
}

function cleanMockAuthorizationCodes() {
  for (const [code, record] of mockAuthorizationCodes) {
    if (record.expiresAt <= Date.now()) mockAuthorizationCodes.delete(code);
  }
}

async function handleMockSso(request, response, url) {
  cleanMockAuthorizationCodes();
  if (url.pathname === "/mock-sso/public-key" && request.method === "GET") {
    sendJson(response, 200, MOCK_SSO_PUBLIC_JWK);
    return;
  }
  if (url.pathname === "/mock-sso/encrypt.js" && request.method === "GET") {
    sendJavaScript(response, MOCK_SSO_ENCRYPTION_SCRIPT);
    return;
  }
  if (url.pathname === "/mock-sso/authorize" && request.method === "GET") {
    const parameters = mockSsoParameters(Object.fromEntries(url.searchParams), request);
    sendHtml(response, 200, mockSsoPage(parameters));
    return;
  }
  if (url.pathname === "/mock-sso/authorize" && request.method === "POST") {
    const body = await readFormBody(request);
    const parameters = mockSsoParameters(body, request);
    if (body.action === "cancel") {
      redirect(response, mockSsoRedirect(parameters, { error: "access_denied", error_description: "Mock UST SSO sign-in was cancelled." }));
      return;
    }
    const email = normalizeEmail(body.email);
    let password = "";
    try { password = decryptMockSsoPassword(body.encrypted_password); }
    catch { password = ""; }
    const credential = readAccounts().find((item) => normalizeEmail(item.email) === email);
    const person = readDatabase().people.find((item) => normalizeEmail(item.email) === email);
    if (!person || person.status !== "Active" || !verifyPassword(password, credential)) {
      sendHtml(response, 401, mockSsoPage(parameters, { error: "The university email or password is incorrect.", selectedEmail: email }));
      return;
    }
    const code = crypto.randomBytes(32).toString("base64url");
    mockAuthorizationCodes.set(code, { email, ...parameters, expiresAt: Date.now() + MOCK_SSO_CODE_TTL_MS });
    redirect(response, mockSsoRedirect(parameters, { code }));
    return;
  }
  if (url.pathname === "/mock-sso/token" && request.method === "POST") {
    const body = await readFormBody(request);
    if (body.grant_type !== "authorization_code" || !body.code || !body.code_verifier) {
      throw new HttpError(400, "A valid authorization code and PKCE verifier are required.");
    }
    const authorization = mockAuthorizationCodes.get(body.code);
    if (!authorization || authorization.expiresAt <= Date.now()) throw new HttpError(400, "The authorization code is invalid or expired.");
    mockAuthorizationCodes.delete(body.code);
    if (body.client_id !== authorization.clientId || body.redirect_uri !== authorization.redirectUri) {
      throw new HttpError(400, "The authorization code was issued to a different client.");
    }
    const challenge = crypto.createHash("sha256").update(body.code_verifier).digest("base64url");
    const actual = Buffer.from(challenge);
    const expected = Buffer.from(authorization.codeChallenge);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new HttpError(400, "PKCE verification failed.");
    }
    const person = readDatabase().people.find((item) => normalizeEmail(item.email) === authorization.email);
    if (!person || person.status !== "Active") throw new HttpError(403, "This RESERVATA account is not active.");
    sendJson(response, 200, {
      access_token: createSession(authorization.email),
      token_type: "Bearer",
      expires_in: SESSION_TTL_MS / 1000,
      scope: authorization.scope,
      user: publicUser(person)
    });
    return;
  }
  throw new HttpError(404, "Mock SSO route not found.");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedRecords(before, after, key) {
  const previous = new Map(before[key].map((item) => [item.id, item]));
  const currentIds = new Set(after[key].map((item) => item.id));
  if (before[key].some((item) => !currentIds.has(item.id))) {
    throw new HttpError(403, `${key} records cannot be deleted through this workflow.`);
  }
  return after[key].filter((item) => !same(previous.get(item.id), item));
}

function fieldsExcept(record, allowedFields) {
  const allowed = new Set(allowedFields);
  return Object.fromEntries(Object.entries(record || {}).filter(([key]) => !allowed.has(key)));
}

function unchangedExcept(previous, next, allowedFields) {
  return same(fieldsExcept(previous, allowedFields), fieldsExcept(next, allowedFields));
}

function requesterOwnsFutureActiveReservation(previous, next, user) {
  return previous?.requester === user.name
    && next?.requester === user.name
    && ["Under Owner Review", "Under Additional Review", "For Payment", "Confirmed"].includes(previous.status)
    && !reservationStartPassed(previous);
}

function isRequesterReservationChange(previous, next, user, database) {
  if (!requesterOwnsFutureActiveReservation(previous, next, user)) return false;
  const supportOnly = unchangedExcept(previous, next, ["supportingDocuments"]);
  if (supportOnly) return true;
  const cancelled = next.status === "Cancelled"
    && unchangedExcept(previous, next, ["status", "cancelledAt", "cancelledBy", "cancellationReason", "approvalSteps"]);
  if (cancelled) return true;
  const rescheduled = next.status === "Under Owner Review"
    && unchangedExcept(previous, next, ["date", "start", "end", "status", "rescheduleCount", "rescheduledAt", "approvalSteps", "paymentId"]);
  if (!rescheduled) return false;
  assertReservationLeadTime(next);
  return reservationConflicts(database, next.resourceId, next.date, next.start, next.end, next.id).length === 0;
}

function assertActivityAppend(before, after, user) {
  if (same(before.activity, after.activity)) return;
  const addedCount = after.activity.length - before.activity.length;
  if (addedCount < 1 || !same(after.activity.slice(addedCount), before.activity)) {
    throw new HttpError(403, "Existing audit records cannot be changed.");
  }
  if (after.activity.slice(0, addedCount).some((item) => item.actor !== user.name)) {
    throw new HttpError(403, "Audit records must identify the signed-in account.");
  }
}

function assertScopedMutation(before, after, user, database) {
  const allowed = new Set(ROLE_MUTATIONS[user.role]);
  for (const key of Object.keys(after)) {
    if (!allowed.has(key) && !same(before[key], after[key])) {
      throw new HttpError(403, `${user.role} cannot modify ${key}.`);
    }
  }
  if (user.role === "Super Admin") {
    assertActivityAppend(before, after, user);
    ["resources", "people", "offices", "approvalTemplates", "systemSettings"].forEach((key) => changedRecords(before, after, key));
    const signedInBefore = before.people.find((item) => normalizeEmail(item.email) === normalizeEmail(user.email));
    const signedInAfter = after.people.find((item) => normalizeEmail(item.email) === normalizeEmail(user.email));
    if (!signedInAfter || signedInAfter.role !== signedInBefore?.role || signedInAfter.status !== signedInBefore?.status) {
      throw new HttpError(403, "A Super Admin cannot change or deactivate their own signed-in account.");
    }
    if (after.people.some((item) => !ROLE_MUTATIONS[item.role] || !["Active", "Inactive"].includes(item.status))) {
      throw new HttpError(400, "A user has an unsupported role or account status.");
    }
    if (after.people.some((item) => item.role === "Requester" && !REQUESTER_TYPES.has(item.requesterType))) {
      throw new HttpError(400, "Requester accounts must specify a valid affiliation.");
    }
    const assetTags = new Set();
    for (const resource of after.resources) {
      const assetTag = normalizeAssetTag(resource.assetTag);
      if (!assetTag) throw new HttpError(400, "Asset tag is required.");
      if (assetTags.has(assetTag)) throw new HttpError(400, "Asset tag must be unique.");
      assetTags.add(assetTag);
    }
    if (after.systemSettings.some((item) => normalizePaymentDeadlineHours(item.paymentDeadlineHours, null) === null)) {
      throw new HttpError(400, `Payment deadline must be a whole number from ${MIN_PAYMENT_DEADLINE_HOURS} to ${MAX_PAYMENT_DEADLINE_HOURS} hours.`);
    }
    return;
  }

  assertActivityAppend(before, after, user);
  const changedReservations = changedRecords(before, after, "reservations");
  const changedPayments = changedRecords(before, after, "payments");
  const changedResources = changedRecords(before, after, "resources");
  const changedVisitors = changedRecords(before, after, "visitors");
  const changedNotifications = changedRecords(before, after, "notifications");
  const reservationById = new Map(after.reservations.map((item) => [item.id, item]));
  const previousPaymentIds = new Set(before.payments.map((item) => item.id));
  const requesterNotificationTargets = new Set([user.name]);
  const assetTags = new Set();
  for (const resource of after.resources) {
    const assetTag = normalizeAssetTag(resource.assetTag);
    if (!assetTag) throw new HttpError(400, "Asset tag is required.");
    if (assetTags.has(assetTag)) throw new HttpError(400, "Asset tag must be unique.");
    assetTags.add(assetTag);
  }

  function paymentOffice(payment) {
    return payment.office || reservationById.get(payment.reservationId)?.office;
  }

  function isNewPaymentHandoff(payment) {
    const reservation = reservationById.get(payment.reservationId);
    return !previousPaymentIds.has(payment.id)
      && reservation?.approvalSteps?.some((step) => step.office === user.office)
      && reservation.status === "For Payment"
      && paymentOffice(payment) === reservation.office
      && payment.status === "Awaiting Receipt";
  }

  if (user.role === "Requester") {
    const full = normalizeState(database);
    for (const reservation of changedReservations) {
      const existed = before.reservations.some((item) => item.id === reservation.id);
      if (existed) {
        const previous = before.reservations.find((item) => item.id === reservation.id);
        if (!isRequesterReservationChange(previous, reservation, user, full)) {
          throw new HttpError(403, "Requesters may only update active future reservations assigned to their account.");
        }
        requesterNotificationTargets.add(reservation.office);
        continue;
      }
      if (reservation.requester !== user.name || reservation.status !== "Under Owner Review") {
        throw new HttpError(403, "Requesters may only submit new pending reservations for their own account.");
      }
      if (user.requesterType === "Student" && full.resources.find((item) => item.id === reservation.resourceId)?.type !== "Equipment") {
        throw new HttpError(403, "Student accounts may only reserve Equipment resources.");
      }
      assertReservationLeadTime(reservation);
      if (reservationConflicts(full, reservation.resourceId, reservation.date, reservation.start, reservation.end, reservation.id).length) {
        throw new HttpError(409, "That resource already has an overlapping reservation request.");
      }
      requesterNotificationTargets.add(reservation.office);
    }
    for (const payment of changedPayments) {
      const reservation = reservationById.get(payment.reservationId);
      if (reservation?.requester !== user.name) {
        throw new HttpError(403, "That payment does not belong to the signed-in requester.");
      }
      requesterNotificationTargets.add(paymentOffice(payment));
    }
  }

  if (user.role === "Office Admin") {
    if (changedReservations.some((item) => item.office !== user.office && !item.approvalSteps?.some((step) => step.office === user.office)) || changedResources.some((item) => item.office !== user.office)) {
      throw new HttpError(403, "Office Administrators may only change records assigned to their office.");
    }
    if (changedPayments.some((item) => paymentOffice(item) !== user.office && !isNewPaymentHandoff(item))) {
      throw new HttpError(403, "That payment is assigned to the resource-owning office.");
    }
  }

  const canManageOwnVisitors = user.role === "Requester" && VISITOR_CAPABLE_REQUESTER_TYPES.has(user.requesterType);
  if (canManageOwnVisitors && changedVisitors.some((item) => item.requester !== user.name || item.status !== "Pending")) {
    throw new HttpError(403, "Requesters may only submit pending visitor requests for their own account.");
  }

  if (user.role === "OSG Admin" && changedReservations.some((item) => !item.approvalSteps?.some((step) => step.office === "OSG"))) {
    throw new HttpError(403, "OSG may only decide reservation approval steps assigned to OSG.");
  }
  if (user.role === "OSG Admin" && changedPayments.some((payment) => {
    const reservation = reservationById.get(payment.reservationId);
    const existed = before.payments.some((item) => item.id === payment.id);
    return existed
      || !reservation?.approvalSteps?.some((step) => step.office === "OSG")
      || reservation.status !== "For Payment"
      || paymentOffice(payment) !== reservation.office
      || payment.status !== "Awaiting Receipt";
  })) {
    throw new HttpError(403, "OSG may only trigger a new awaiting-receipt record after its final required approval.");
  }

  if (!(user.role === "OSG Admin" || canManageOwnVisitors) && changedVisitors.length) {
    throw new HttpError(403, `${user.role} cannot modify visitor records.`);
  }
  if (user.role !== "Office Admin" && changedResources.length) {
    throw new HttpError(403, `${user.role} cannot modify resources.`);
  }
  if (!["Requester", "Office Admin", "OSG Admin"].includes(user.role) && (changedReservations.length || changedPayments.length)) {
    throw new HttpError(403, `${user.role} cannot modify reservation or payment records.`);
  }
  if (user.role === "Requester" && changedNotifications.some((item) => !requesterNotificationTargets.has(item.user))) {
    throw new HttpError(403, "Users may only update their own notifications or the office assigned to a new reservation.");
  }
}

function scopePredicates(database, user) {
  const scopedReservations = database.reservations.filter((item) => user.role === "Requester"
    ? item.requester === user.name
    : item.office === user.office || item.approvalSteps?.some((step) => step.office === user.office));
  const reservationIds = new Set(
    scopedReservations
      .map((item) => item.id)
  );
  function paymentOffice(payment) {
    return payment.office || database.reservations.find((item) => item.id === payment.reservationId)?.office;
  }

  const officeTargets = new Set([
    ...database.resources.filter((item) => item.office === user.office).map((item) => item.name),
    ...scopedReservations.map((item) => item.resourceName),
    ...database.payments.filter((item) => paymentOffice(item) === user.office).map((item) => item.reservationId)
  ]);
  const visitorTargets = new Set(database.visitors.map((item) => item.visitor));
  const canSeeOwnVisitors = user.role === "Requester" && VISITOR_CAPABLE_REQUESTER_TYPES.has(user.requesterType);

  function notificationVisible(item) {
    if (user.role === "Requester") return item.user === user.name;
    return item.user === user.name || item.office === user.office || item.user === user.office;
  }

  return {
    resources: (item) => user.role === "Requester"
      ? item.type !== "Visitor Service" && item.status !== "Archived" && (user.requesterType !== "Student" || item.type === "Equipment")
      : user.role === "Office Admin" && item.office === user.office,
    reservations: (item) => user.role === "Requester"
      ? item.requester === user.name
      : user.role === "Office Admin"
        ? item.office === user.office || item.approvalSteps?.some((step) => step.office === user.office)
        : user.role === "OSG Admin" && item.approvalSteps?.some((step) => step.office === "OSG"),
    payments: (item) => user.role === "Requester"
      ? reservationIds.has(item.reservationId)
      : user.role === "Office Admin"
        ? paymentOffice(item) === user.office
        : user.role === "OSG Admin" && reservationIds.has(item.reservationId),
    visitors: (item) => user.role === "OSG Admin" || (canSeeOwnVisitors && item.requester === user.name),
    people: (item) => normalizeEmail(item.email) === normalizeEmail(user.email),
    offices: (item) => user.role === "Office Admin" && item.status === "Active",
    approvalTemplates: (item) => ["Requester", "Office Admin"].includes(user.role) && item.status === "Active",
    systemSettings: () => true,
    notifications: notificationVisible,
    activity: (item) => {
      if (item.reservationId) return reservationIds.has(item.reservationId);
      if (user.role === "Requester") return item.actor === user.name;
      if (user.role === "Office Admin") return item.actor === user.name || officeTargets.has(item.target);
      if (user.role === "OSG Admin") return item.actor === user.name || visitorTargets.has(item.target);
      return false;
    }
  };
}

function scopedState(database, user) {
  const clean = normalizeState(database);
  if (user.role === "Super Admin") return clean;
  const predicates = scopePredicates(clean, user);
  return Object.fromEntries(Object.keys(clean).map((key) => [key, clean[key].filter(predicates[key])]));
}

function mergeScopedState(database, submitted, user) {
  const full = normalizeState(database);
  if (user.role === "Super Admin") return submitted;
  const predicates = scopePredicates(full, user);
  const merged = { ...full };
  for (const key of ROLE_MUTATIONS[user.role]) {
    merged[key] = [
      ...full[key].filter((item) => !predicates[key](item)),
      ...submitted[key]
    ];
  }
  return merged;
}

async function handleAuth(request, response, pathname) {
  if (pathname === "/api/auth/login" && request.method === "POST") {
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const credential = readAccounts().find((item) => normalizeEmail(item.email) === email);
    const person = readDatabase().people.find((item) => normalizeEmail(item.email) === email);
    if (!person || person.status !== "Active" || !verifyPassword(body.password, credential)) {
      throw new HttpError(401, "The email or password is incorrect.");
    }
    const token = createSession(email);
    sendJson(response, 200, { token, user: publicUser(person), expiresIn: SESSION_TTL_MS / 1000 });
    return true;
  }

  if (pathname === "/api/auth/session" && request.method === "GET") {
    sendJson(response, 200, { user: authenticatedUser(request) });
    return true;
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    sessions.delete(bearerToken(request));
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

async function handleApi(request, response, url) {
  const pathname = url.pathname;
  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, service: "Reservata local API" });
    return;
  }
  if (await handleAuth(request, response, pathname)) return;

  const user = authenticatedUser(request);

  if (pathname === "/api/users" && request.method === "POST") {
    if (user.role !== "Super Admin") throw new HttpError(403, "Only a Super Admin can provision accounts.");
    const body = await readBody(request);
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const office = String(body.office || "").trim();
    const role = body.role;
    const status = body.status || "Active";
    if (!name || !email || !office) throw new HttpError(400, "User name, email, and office are required.");
    if (!email.endsWith("@ust.edu.ph")) throw new HttpError(400, "Use a valid UST SSO email ending in @ust.edu.ph.");
    if (!ROLE_MUTATIONS[role]) throw new HttpError(400, "Unsupported role.");
    if (!["Active", "Inactive"].includes(status)) throw new HttpError(400, "Unsupported account status.");
    if (role === "Super Admin" && office !== "All Offices") throw new HttpError(400, "Super Admin accounts must use All Offices.");
    if (role === "Office Admin" && office === "All Offices") throw new HttpError(400, "Office Admin accounts must be assigned to a specific office.");
    if (role === "OSG Admin" && office !== "OSG") throw new HttpError(400, "OSG Admin accounts must be assigned to OSG.");
    const requesterType = role === "Requester" ? String(body.requesterType || "") : "";
    if (role === "Requester" && !REQUESTER_TYPES.has(requesterType)) {
      throw new HttpError(400, "Requester accounts must specify a valid affiliation.");
    }
    const database = readDatabase();
    const validOffice = role === "Requester" || office === "All Offices" || database.offices.some((item) => item.name === office && item.status === "Active");
    if (!validOffice) throw new HttpError(400, "Assign the user to an active office.");
    if (database.people.some((item) => normalizeEmail(item.email) === email)) {
      throw new HttpError(409, "That SSO email already has a RESERVATA account.");
    }
    const accounts = readAccounts();
    if (accounts.some((item) => normalizeEmail(item.email) === email)) {
      throw new HttpError(409, "That SSO email already has local login credentials.");
    }
    const person = { name, email, office, role, requesterType, status };
    database.people.push(person);
    database.activity.unshift({
      id: createRecordId("ACT"),
      action: "User account created",
      actor: user.name,
      target: name,
      details: email,
      time: nowIso()
    });
    writeDatabase(database);
    const tempPassword = generateTempPassword();
    accounts.push({ email, ...hashPassword(tempPassword) });
    writeAccounts(accounts);
    sendJson(response, 201, { user: publicUser(person), tempPassword });
    return;
  }

  if (pathname === "/api/resource-photos" && request.method === "POST") {
    if (user.role !== "Office Admin") throw new HttpError(403, "Only office admins can upload resource photos.");
    const { data } = await readBody(request);
    if (typeof data !== "string" || data.length > 400_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, "Choose a valid resource photo smaller than 300 KB after processing.");
    const bytes = Buffer.from(data.split(",")[1], "base64");
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new HttpError(400, "Invalid JPEG photo.");
    const prefix = crypto.createHash("sha256").update(user.office).digest("hex").slice(0, 16);
    const key = `${prefix}-${crypto.randomUUID()}.jpg`;
    fs.mkdirSync(RESOURCE_PHOTOS_PATH, { recursive: true });
    fs.writeFileSync(path.join(RESOURCE_PHOTOS_PATH, key), bytes, { flag: "wx" });
    sendJson(response, 201, { key });
    return;
  }
  const photoMatch = pathname.match(/^\/api\/resource-photos\/([a-f0-9]{16}-[a-f0-9-]{36}\.jpg)$/);
  if (photoMatch && request.method === "GET") {
    const resource = scopedState(readDatabase(), user).resources.find((item) => item.photoKey === photoMatch[1]);
    const file = path.join(RESOURCE_PHOTOS_PATH, photoMatch[1]);
    if (!resource || !fs.existsSync(file)) throw new HttpError(404, "Resource photo not found.");
    sendJson(response, 200, { url: `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}` });
    return;
  }
  if (pathname === "/api/state" && request.method === "GET") {
    sendJson(response, 200, scopedState(readLifecycleDatabase(), user));
    return;
  }

  const availabilityMatch = pathname.match(/^\/api\/resources\/([^/]+)\/availability$/);
  if (availabilityMatch && request.method === "GET") {
    const database = readLifecycleDatabase();
    const resourceId = decodeURIComponent(availabilityMatch[1]);
    const resource = database.resources.find((item) => item.id === resourceId);
    const visible = resource && (
      user.role === "Super Admin"
      || (user.role === "Requester" && resource.status !== "Archived" && resource.type !== "Visitor Service")
      || (user.role === "Office Admin" && resource.office === user.office)
    );
    if (!visible) throw new HttpError(404, "Resource not found.");
    sendJson(response, 200, resourceAvailability(
      database,
      resourceId,
      url.searchParams.get("date") || "",
      url.searchParams.get("start") || "",
      url.searchParams.get("end") || ""
    ));
    return;
  }

  if (pathname === "/api/state" && request.method === "PUT") {
    const database = readLifecycleDatabase();
    const before = scopedState(database, user);
    const after = sanitizeState(await readBody(request));
    assertScopedMutation(before, after, user, database);
    for (const resource of after.resources) {
      const previous = database.resources.find((item) => item.id === resource.id);
      if (!resource.photoKey || resource.photoKey === previous?.photoKey) continue;
      const prefix = crypto.createHash("sha256").update(user.office).digest("hex").slice(0, 16);
      if (user.role !== "Office Admin" || !new RegExp(`^${prefix}-[a-f0-9-]{36}\\.jpg$`).test(resource.photoKey) || !fs.existsSync(path.join(RESOURCE_PHOTOS_PATH, resource.photoKey))) throw new HttpError(400, "Upload a photo belonging to your office first.");
    }
    const merged = normalizeState(mergeScopedState(database, after, user));
    expireOverdueReservations(merged);
    writeDatabase(merged);
    sendJson(response, 200, { ok: true, savedAt: new Date().toISOString() });
    return;
  }

  if (pathname === "/api/notifications/read" && request.method === "PATCH") {
    const body = await readBody(request);
    const database = readLifecycleDatabase();
    const visibleIds = new Set(scopedState(database, user).notifications.map((item) => item.id));
    const requestedId = body.id ? String(body.id) : "";
    if (requestedId && !visibleIds.has(requestedId)) {
      throw new HttpError(404, "Notification not found.");
    }
    const targetIds = requestedId ? new Set([requestedId]) : visibleIds;
    database.notifications = database.notifications.map((item) =>
      targetIds.has(item.id) ? { ...item, unread: false } : item
    );
    writeDatabase(database);
    sendJson(response, 200, scopedState(database, user));
    return;
  }

  throw new HttpError(404, "API route not found.");
}

function serveStatic(request, response, pathname) {
  if (/^\/(data|aws|docs)(\/|$)/i.test(pathname)) {
    sendText(response, 404, "Not found");
    return;
  }
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(STATIC_ROOT, safePath));
  if (!filePath.startsWith(STATIC_ROOT)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  const acceptsGzip = /\bgzip\b/i.test(request.headers["accept-encoding"] || "") && COMPRESSIBLE_STATIC_TYPES.has(ext);
  const longLivedAsset = /^\/(assets|images)\//i.test(pathname);
  const headers = {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": longLivedAsset ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff"
  };
  if (acceptsGzip) {
    headers["Content-Encoding"] = "gzip";
    headers.Vary = "Accept-Encoding";
  }
  response.writeHead(200, headers);
  const file = fs.createReadStream(filePath);
  if (acceptsGzip) file.pipe(zlib.createGzip({ level: 6 })).pipe(response);
  else file.pipe(response);
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }
      if (url.pathname.startsWith("/mock-sso/")) {
        await handleMockSso(request, response, url);
        return;
      }
      serveStatic(request, response, decodeURIComponent(url.pathname));
    } catch (error) {
      sendJson(response, error.status || 500, { error: error.status ? error.message : "Server error." });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Reservata local API running at http://${HOST}:${PORT}/api/health`);
  });
}

module.exports = { createServer, scopedState, verifyPassword };
