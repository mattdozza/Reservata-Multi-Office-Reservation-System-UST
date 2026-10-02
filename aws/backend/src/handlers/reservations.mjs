import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authenticatedUser, requireOffice, requireRole, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, approvalRecord, createId, newestFirst, notificationRecord, now, reservationHistoryRecord } from "../lib/records.mjs";
import { effectivePaymentDeadlineHours, expireReservations, paymentDeadlineFor, RESOLVED_RESERVATION_STATUSES } from "../lib/reservationLifecycle.mjs";
import { lockExpiry, reservationSlots } from "../lib/slots.mjs";
import { TABLES } from "../lib/tables.mjs";
import { buildApprovalSteps, canDecideStep, decideApprovalStep } from "../lib/workflows.mjs";

const BLOCKING_STATUSES = new Set(["Under Owner Review", "Under Additional Review", "Approved", "Confirmed", "For Payment", "In Use"]);
const ACTIVE_PAYMENT_STATUSES = new Set(["Awaiting Receipt", "Pending Verification"]);
const ALLOWED_DOCUMENTS = new Set(["image/jpeg", "image/png", "application/pdf"]);
const BUSINESS_DAY_START = 8 * 60;
const BUSINESS_DAY_END = 17 * 60;
const DEFAULT_SLOT_MINUTES = 60;

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

function assertReservationLeadTime(date) {
  if (date < todayIso()) throw new HttpError(400, "Reservation date cannot be in the past.");
  if (date < tomorrowIso()) throw new HttpError(400, "Reservations must be submitted at least one day before the time of use.");
}

function overlaps(left, right) {
  return left.start < right.end && left.end > right.start;
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

function resourceOperatingWindow(resource) {
  const openMinutes = toMinutes(resource?.openTime);
  const closeMinutes = toMinutes(resource?.closeTime);
  const start = openMinutes === null ? BUSINESS_DAY_START : openMinutes;
  const end = closeMinutes === null || closeMinutes <= start ? BUSINESS_DAY_END : closeMinutes;
  return { start, end };
}

function resourceBlockedDate(resource, date) {
  return (resource?.blockedDates || []).find((item) => item.date === date) || null;
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

function safeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
}

function requireText(value, label, minimum = 1) {
  const text = String(value || "").trim();
  if (text.length < minimum) throw new HttpError(400, `${label} must be at least ${minimum} characters.`);
  return text;
}

function reservationStartPassed(reservation) {
  const startTime = new Date(`${reservation.date}T${reservation.start || "00:00"}`).getTime();
  return Number.isFinite(startTime) && startTime <= Date.now();
}

function resetRouteSteps(steps = []) {
  const firstSequence = Math.min(...steps.map((step) => Number(step.sequence || 1)));
  return steps.map((step) => ({
    ...step,
    status: Number(step.sequence || 1) === firstSequence ? "Pending" : "Waiting",
    decidedBy: "",
    decidedAt: "",
    reason: ""
  }));
}

function skippedPendingSteps(steps = []) {
  return steps.map((step) => ["Pending", "Waiting"].includes(step.status) ? { ...step, status: "Skipped" } : step);
}

function canManageStatus(user, reservation) {
  return user.role === ROLES.superAdmin || (user.role === ROLES.officeAdmin && reservation.office === user.office);
}

async function reservationsForDate(repo, resourceId, date) {
  const items = await repo.query(TABLES.reservations, "resource-date-index", "resourceDate", `${resourceId}#${date}`);
  await expireReservations(repo, items);
  return items;
}

function conflictsFor(items, start, end) {
  if (!start || !end || start >= end) return [];
  return items.filter((item) => BLOCKING_STATUSES.has(item.status) && overlaps(item, { start, end }));
}

async function slotOptions(repo, resource, date, start, end) {
  if (!resource || !date) return [];
  const duration = selectedDuration(start, end);
  const step = duration >= DEFAULT_SLOT_MINUTES ? DEFAULT_SLOT_MINUTES : 30;
  const unavailableDay = resource.status !== "Available" || date < tomorrowIso() || !!resourceBlockedDate(resource, date);
  const sameDay = unavailableDay ? [] : await reservationsForDate(repo, resource.id, date);
  const window = resourceOperatingWindow(resource);
  const options = [];
  for (let minute = window.start; minute + duration <= window.end; minute += step) {
    const slotStart = fromMinutes(minute);
    const slotEnd = fromMinutes(minute + duration);
    const conflicts = unavailableDay ? [] : conflictsFor(sameDay, slotStart, slotEnd);
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

async function alternatives(repo, resource, date, start, end, limit = 6) {
  const startDate = date && date >= tomorrowIso() ? date : tomorrowIso();
  const results = [];
  for (let day = 0; day < 10 && results.length < limit; day += 1) {
    const candidateDate = addDaysIso(startDate, day);
    const daily = (await slotOptions(repo, resource, candidateDate, start, end))
      .filter((slot) => slot.status === "available");
    results.push(...daily.slice(0, limit - results.length));
  }
  return results;
}

async function availabilityResponse(repo, resource, date, start, end) {
  const emptySlots = { slots: [], alternatives: [] };
  if (resource.status !== "Available") return { status: "unavailable", message: `${resource.name} is currently ${resource.status}.`, conflicts: [], ...emptySlots };
  if (!date || !start || !end) return { status: "pending", message: "Choose a date, start time, and end time to check availability.", conflicts: [], ...emptySlots };
  if (date < tomorrowIso()) return {
    status: "unavailable",
    message: "Reservations must be made at least one day before the time of use.",
    conflicts: [],
    slots: await slotOptions(repo, resource, tomorrowIso(), start, end),
    alternatives: await alternatives(repo, resource, tomorrowIso(), start, end)
  };
  const blocked = resourceBlockedDate(resource, date);
  if (blocked) return {
    status: "unavailable",
    message: `${resource.name} is closed on ${date}${blocked.reason ? ` (${blocked.reason})` : ""}.`,
    conflicts: [],
    slots: await slotOptions(repo, resource, date, start, end),
    alternatives: await alternatives(repo, resource, date, start, end)
  };
  if (start >= end) return {
    status: "unavailable",
    message: "End time must be later than start time.",
    conflicts: [],
    slots: await slotOptions(repo, resource, date, start, end),
    alternatives: []
  };
  const window = resourceOperatingWindow(resource);
  if (toMinutes(start) < window.start || toMinutes(end) > window.end) return {
    status: "unavailable",
    message: `${resource.name} is only available ${fromMinutes(window.start)}-${fromMinutes(window.end)}.`,
    conflicts: [],
    slots: await slotOptions(repo, resource, date, start, end),
    alternatives: await alternatives(repo, resource, date, start, end)
  };
  const sameDay = await reservationsForDate(repo, resource.id, date);
  const conflicts = conflictsFor(sameDay, start, end);
  if (conflicts.length) return {
    status: "conflict",
    message: `${resource.name} has an overlapping request in that slot.`,
    conflicts: publicConflicts(conflicts),
    slots: await slotOptions(repo, resource, date, start, end),
    alternatives: await alternatives(repo, resource, date, start, end)
  };
  return {
    status: "available",
    message: `${resource.name} is available for the selected slot.`,
    conflicts: [],
    slots: await slotOptions(repo, resource, date, start, end),
    alternatives: await alternatives(repo, resource, date, start, end)
  };
}

async function listReservations(repo, user) {
  if (user.role === ROLES.requester) {
    const items = await repo.query(TABLES.reservations, "requester-index", "requesterEmail", user.email);
    await expireReservations(repo, items);
    return items;
  }
  if (user.role === ROLES.officeAdmin) {
    const items = await repo.scan(TABLES.reservations);
    const scoped = items.filter((item) => item.office === user.office || item.approvalSteps?.some((step) => step.office === user.office));
    await expireReservations(repo, scoped);
    return scoped;
  }
  if (user.role === ROLES.osgAdmin) {
    const items = await repo.scan(TABLES.reservations);
    const scoped = items.filter((item) => item.approvalSteps?.some((step) => step.office === "OSG"));
    await expireReservations(repo, scoped);
    return scoped;
  }
  if (user.role === ROLES.superAdmin) {
    const items = await repo.scan(TABLES.reservations);
    await expireReservations(repo, items);
    return items;
  }
  throw new HttpError(403, "Your role cannot access reservations.");
}

export function createHandler(repo = repository, s3 = new S3Client({}), signer = getSignedUrl) {
  return wrap(async (event) => {
    const user = await authenticatedUser(event, repo);
    const requestMethod = method(event);

    const rawPath = event.rawPath || event.path || "";
    if (requestMethod === "GET" && rawPath.endsWith("/availability")) {
      requireRole(user, ROLES.requester, ROLES.officeAdmin, ROLES.superAdmin);
      const resource = await repo.get(TABLES.resources, { id: event.pathParameters?.id });
      const visible = resource && (
        user.role === ROLES.superAdmin
        || (user.role === ROLES.requester && resource.status !== "Archived" && resource.type !== "Visitor Service")
        || (user.role === ROLES.officeAdmin && resource.office === user.office)
      );
      if (!visible) throw new HttpError(404, "Resource not found.");
      const query = event.queryStringParameters || {};
      return json(200, await availabilityResponse(repo, resource, query.date || "", query.start || "", query.end || ""));
    }

    if (requestMethod === "GET") {
      return json(200, { items: newestFirst(await listReservations(repo, user)) });
    }

    if (requestMethod === "POST" && rawPath.endsWith("/document-upload")) {
      requireRole(user, ROLES.requester);
      const reservation = await repo.get(TABLES.reservations, { id: event.pathParameters?.id });
      if (!reservation) throw new HttpError(404, "Reservation not found.");
      await expireReservations(repo, [reservation]);
      if (reservation.status === "Expired") throw new HttpError(409, "This reservation expired before final confirmation.");
      if (reservation.requesterEmail !== user.email) throw new HttpError(403, "This reservation does not belong to your account.");
      if (["Rejected", "Cancelled", "Completed", "Expired"].includes(reservation.status)) {
        throw new HttpError(409, "Supporting documents can only be uploaded while a reservation is active.");
      }
      const body = parseBody(event);
      requireFields(body, ["filename", "contentType"]);
      if (!ALLOWED_DOCUMENTS.has(body.contentType)) throw new HttpError(400, "Supporting documents must be JPG, PNG, or PDF files.");
      const updatedAt = now();
      const document = {
        id: createId("DOC"),
        name: safeFilename(body.filename),
        type: body.contentType,
        size: Number(body.size || 0),
        key: `documents/${encodeURIComponent(user.email)}/${reservation.id}/${safeFilename(body.filename)}`,
        status: "Submitted",
        uploadedAt: updatedAt
      };
      const command = new PutObjectCommand({
        Bucket: process.env.RECEIPTS_BUCKET,
        Key: document.key,
        ContentType: document.type,
        ServerSideEncryption: "AES256"
      });
      const uploadUrl = await signer(s3, command, { expiresIn: 300 });
      const supportingDocuments = [document, ...(reservation.supportingDocuments || [])];
      const notification = notificationRecord(user.email, user.name, `${reservation.resourceName} supporting document was uploaded.`);
      const activity = activityRecord(user, "Supporting document uploaded", reservation.resourceName, reservation.office, reservation.id, document.name);
      await repo.transact([
        { Update: {
          TableName: TABLES.reservations,
          Key: { id: reservation.id },
          UpdateExpression: "SET supportingDocuments = :documents, updatedAt = :updatedAt",
          ConditionExpression: "requesterEmail = :requesterEmail",
          ExpressionAttributeValues: { ":documents": supportingDocuments, ":updatedAt": updatedAt, ":requesterEmail": user.email }
        } },
        { Put: { TableName: TABLES.notifications, Item: notification } },
        { Put: { TableName: TABLES.activity, Item: activity } }
      ]);
      return json(200, { uploadUrl, objectKey: document.key, document, expiresIn: 300 });
    }

    if (requestMethod === "POST") {
      requireRole(user, ROLES.requester);
      const body = parseBody(event);
      requireFields(body, ["resourceId", "date", "start", "end", "purpose"]);
      assertReservationLeadTime(body.date);
      const slots = reservationSlots(body.resourceId, body.date, body.start, body.end);
      const resource = await repo.get(TABLES.resources, { id: body.resourceId });
      if (!resource) throw new HttpError(404, "Selected resource was not found.");
      if (resource.status !== "Available") throw new HttpError(409, "Selected resource is not available.");
      if (user.requesterType === "Student" && resource.type !== "Equipment") {
        throw new HttpError(403, "Student accounts may only reserve Equipment resources.");
      }
      const submittedBlock = resourceBlockedDate(resource, body.date);
      if (submittedBlock) {
        throw new HttpError(409, `${resource.name} is closed on ${body.date}${submittedBlock.reason ? ` (${submittedBlock.reason})` : ""}.`);
      }
      const submittedWindow = resourceOperatingWindow(resource);
      if (toMinutes(body.start) < submittedWindow.start || toMinutes(body.end) > submittedWindow.end) {
        throw new HttpError(409, `${resource.name} is only available ${fromMinutes(submittedWindow.start)}-${fromMinutes(submittedWindow.end)}.`);
      }

      const resourceDate = `${resource.id}#${body.date}`;
      const sameDay = await repo.query(TABLES.reservations, "resource-date-index", "resourceDate", resourceDate);
      if (sameDay.some((item) => BLOCKING_STATUSES.has(item.status) && overlaps(item, body))) {
        throw new HttpError(409, "That resource already has an overlapping approved reservation.");
      }

      const submittedAt = now();
      const id = createId("REQ");
      const workflowTemplateId = resource.workflowTemplateId || "WF-BASIC";
      const workflow = await repo.get(TABLES.approvalWorkflows, { id: workflowTemplateId });
      if (!workflow || workflow.status !== "Active") throw new HttpError(409, "The resource does not have an active approval workflow.");
      const reservation = {
        id,
        requester: user.name,
        requesterEmail: user.email,
        resourceId: resource.id,
        resourceName: resource.name,
        resourceAssetTag: resource.assetTag,
        resourceDate,
        office: resource.office,
        type: resource.type,
        date: body.date,
        start: body.start,
        end: body.end,
        quantity: Number(body.quantity || 1),
        purpose: String(body.purpose).trim(),
        status: "Under Owner Review",
        submittedAt,
        createdAt: submittedAt,
        requiresPayment: Boolean(resource.requiresPayment),
        workflowTemplateId,
        workflowName: workflow.name,
        workflowVersion: 1,
        slotLockVersion: 1,
        approvalSteps: buildApprovalSteps(workflow, resource, id)
      };
      const notification = notificationRecord(user.email, user.name, `${resource.name} request was submitted for ${resource.office} review.`);
      const activity = activityRecord(user, "Reservation submitted", resource.name, resource.office, reservation.id);
      await repo.transact([
        { Put: { TableName: TABLES.reservations, Item: reservation, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.notifications, Item: notification } },
        { Put: { TableName: TABLES.activity, Item: activity } },
        { Put: { TableName: TABLES.reservationHistory, Item: reservationHistoryRecord(user, reservation, "Created", reservation.status) } },
        ...slots.map((slotKey) => ({ Put: {
          TableName: TABLES.reservationLocks,
          Item: { slotKey, reservationId: reservation.id, expiresAt: lockExpiry(reservation.date) },
          ConditionExpression: "attribute_not_exists(slotKey)"
        } }))
      ]);
      return json(201, reservation);
    }

    if (requestMethod === "PATCH") {
      const reservation = await repo.get(TABLES.reservations, { id: event.pathParameters?.id });
      if (!reservation) throw new HttpError(404, "Reservation not found.");
      await expireReservations(repo, [reservation]);
      if (reservation.status === "Expired") throw new HttpError(409, "This reservation expired before final confirmation.");
      const body = parseBody(event);
      const updatedAt = now();

      if (rawPath.endsWith("/cancel")) {
        requireRole(user, ROLES.requester);
        if (reservation.requesterEmail !== user.email) throw new HttpError(403, "This reservation does not belong to your account.");
        if (!["Under Owner Review", "Under Additional Review", "For Payment", "Confirmed"].includes(reservation.status)) throw new HttpError(409, "Only active upcoming reservations can be cancelled.");
        if (reservationStartPassed(reservation)) throw new HttpError(409, "Reservations cannot be cancelled after the scheduled start time.");
        const reason = requireText(body.reason, "Cancellation reason", 8);
        const payment = reservation.paymentId ? await repo.get(TABLES.payments, { id: reservation.paymentId }) : null;
        const transaction = [
          { Update: {
            TableName: TABLES.reservations,
            Key: { id: reservation.id },
            UpdateExpression: "SET #status = :cancelled, cancelledAt = :updatedAt, cancelledBy = :actor, cancellationReason = :reason, approvalSteps = :steps, updatedAt = :updatedAt",
            ConditionExpression: "#status = :previous",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":cancelled": "Cancelled", ":updatedAt": updatedAt, ":actor": user.name, ":reason": reason, ":steps": skippedPendingSteps(reservation.approvalSteps), ":previous": reservation.status }
          } },
          { Put: { TableName: TABLES.notifications, Item: notificationRecord(reservation.office, reservation.office, `${reservation.resourceName}: ${reservation.requester} cancelled the reservation. Reason: ${reason}`) } },
          { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Reservation cancelled", reservation.resourceName, reservation.office, reservation.id, body.reason) } },
          { Put: { TableName: TABLES.reservationHistory, Item: reservationHistoryRecord(user, reservation, reservation.status, "Cancelled", reason) } },
          ...reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end).map((slotKey) => ({
            Delete: { TableName: TABLES.reservationLocks, Key: { slotKey } }
          }))
        ];
        if (payment && ACTIVE_PAYMENT_STATUSES.has(payment.status)) {
          transaction.push({ Update: {
            TableName: TABLES.payments,
            Key: { id: payment.id },
            UpdateExpression: "SET #status = :cancelled, rejectionReason = :reason, updatedAt = :updatedAt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":cancelled": "Cancelled", ":reason": reason, ":updatedAt": updatedAt }
          } });
        }
        await repo.transact(transaction);
        return json(200, { ...reservation, status: "Cancelled", cancellationReason: reason, cancelledAt: updatedAt });
      }

      if (rawPath.endsWith("/reschedule")) {
        requireRole(user, ROLES.requester);
        if (reservation.requesterEmail !== user.email) throw new HttpError(403, "This reservation does not belong to your account.");
        if (!["Under Owner Review", "Under Additional Review", "For Payment", "Confirmed"].includes(reservation.status)) throw new HttpError(409, "Only active upcoming reservations can be rescheduled.");
        if (reservationStartPassed(reservation)) throw new HttpError(409, "Reservations cannot be rescheduled after the scheduled start time.");
        requireFields(body, ["date", "start", "end"]);
        assertReservationLeadTime(body.date);
        if (body.start >= body.end) throw new HttpError(400, "End time must be later than start time.");
        const rescheduleResource = await repo.get(TABLES.resources, { id: reservation.resourceId });
        const rescheduleBlock = resourceBlockedDate(rescheduleResource, body.date);
        if (rescheduleBlock) {
          throw new HttpError(409, `${reservation.resourceName} is closed on ${body.date}${rescheduleBlock.reason ? ` (${rescheduleBlock.reason})` : ""}.`);
        }
        const rescheduleWindow = resourceOperatingWindow(rescheduleResource);
        if (toMinutes(body.start) < rescheduleWindow.start || toMinutes(body.end) > rescheduleWindow.end) {
          throw new HttpError(409, `${reservation.resourceName} is only available ${fromMinutes(rescheduleWindow.start)}-${fromMinutes(rescheduleWindow.end)}.`);
        }
        const resourceDate = `${reservation.resourceId}#${body.date}`;
        const sameDay = await repo.query(TABLES.reservations, "resource-date-index", "resourceDate", resourceDate);
        if (sameDay.some((item) => item.id !== reservation.id && BLOCKING_STATUSES.has(item.status) && overlaps(item, body))) {
          throw new HttpError(409, "That resource already has an overlapping reservation request.");
        }
        const steps = resetRouteSteps(reservation.approvalSteps);
        const payment = reservation.paymentId ? await repo.get(TABLES.payments, { id: reservation.paymentId }) : null;
        const transaction = [
          { Update: {
            TableName: TABLES.reservations,
            Key: { id: reservation.id },
            UpdateExpression: "SET #status = :status, #date = :date, #start = :start, #end = :end, resourceDate = :resourceDate, approvalSteps = :steps, paymentId = :empty, rescheduledAt = :updatedAt, rescheduleCount = :count, updatedAt = :updatedAt",
            ConditionExpression: "#status = :previous",
            ExpressionAttributeNames: { "#status": "status", "#date": "date", "#start": "start", "#end": "end" },
            ExpressionAttributeValues: {
              ":status": "Under Owner Review",
              ":date": body.date,
              ":start": body.start,
              ":end": body.end,
              ":resourceDate": resourceDate,
              ":steps": steps,
              ":empty": "",
              ":updatedAt": updatedAt,
              ":count": Number(reservation.rescheduleCount || 0) + 1,
              ":previous": reservation.status
            }
          } },
          { Put: { TableName: TABLES.notifications, Item: notificationRecord(reservation.office, reservation.office, `${reservation.resourceName}: ${reservation.requester} requested a reschedule to ${body.date} ${body.start}-${body.end}.`) } },
          { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Reservation rescheduled", reservation.resourceName, reservation.office, reservation.id, `${reservation.date} ${reservation.start}-${reservation.end} -> ${body.date} ${body.start}-${body.end}`) } },
          { Put: { TableName: TABLES.reservationHistory, Item: reservationHistoryRecord(user, reservation, reservation.status, "Under Owner Review", `${reservation.date} ${reservation.start}-${reservation.end} -> ${body.date} ${body.start}-${body.end}`) } },
          ...reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end).map((slotKey) => ({
            Delete: { TableName: TABLES.reservationLocks, Key: { slotKey } }
          })),
          ...reservationSlots(reservation.resourceId, body.date, body.start, body.end).map((slotKey) => ({ Put: {
            TableName: TABLES.reservationLocks,
            Item: { slotKey, reservationId: reservation.id, expiresAt: lockExpiry(body.date) },
            ConditionExpression: "attribute_not_exists(slotKey)"
          } }))
        ];
        if (payment && ACTIVE_PAYMENT_STATUSES.has(payment.status)) {
          transaction.push({ Update: {
            TableName: TABLES.payments,
            Key: { id: payment.id },
            UpdateExpression: "SET #status = :cancelled, rejectionReason = :reason, updatedAt = :updatedAt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":cancelled": "Cancelled", ":reason": "Reservation was rescheduled and sent back for approval.", ":updatedAt": updatedAt }
          } });
        }
        await repo.transact(transaction);
        return json(200, { ...reservation, status: "Under Owner Review", date: body.date, start: body.start, end: body.end, approvalSteps: steps });
      }

      if (rawPath.endsWith("/status")) {
        requireRole(user, ROLES.officeAdmin, ROLES.superAdmin);
        if (!canManageStatus(user, reservation)) throw new HttpError(403, "Only the owning office or Super Admin can update this reservation lifecycle.");
        const nextStatus = String(body.status || "").trim();
        if (!["In Use", "Completed", "No Show", "Cancelled", "Expired"].includes(nextStatus)) throw new HttpError(400, "Unsupported reservation status.");
        const reason = ["No Show", "Cancelled", "Expired"].includes(nextStatus) ? requireText(body.reason, "Reason", 8) : String(body.reason || "").trim();
        if (nextStatus === "In Use" && reservation.status !== "Confirmed") throw new HttpError(409, "Only confirmed reservations can be marked in use.");
        if (nextStatus === "Completed" && !["Confirmed", "In Use"].includes(reservation.status)) throw new HttpError(409, "Only confirmed or in-use reservations can be completed.");
        if (nextStatus === "No Show" && (reservation.status !== "Confirmed" || !reservationStartPassed(reservation))) throw new HttpError(409, "No-show can only be recorded after a confirmed reservation's scheduled start.");
        if (["Cancelled", "Expired"].includes(nextStatus) && RESOLVED_RESERVATION_STATUSES.has(reservation.status)) throw new HttpError(409, "This reservation is already closed.");
        const payment = reservation.paymentId ? await repo.get(TABLES.payments, { id: reservation.paymentId }) : null;
        let extraFields = {
          "In Use": "startedAt = :updatedAt",
          Completed: "completedAt = :updatedAt",
          "No Show": "noShowAt = :updatedAt, noShowReason = :reason",
          Cancelled: "overrideAt = :updatedAt, overrideBy = :actor, overrideReason = :reason, approvalSteps = :steps",
          Expired: "overrideAt = :updatedAt, overrideBy = :actor, overrideReason = :reason, approvalSteps = :steps"
        }[nextStatus];
        const values = { ":next": nextStatus, ":updatedAt": updatedAt, ":previous": reservation.status };
        if (extraFields.includes(":reason")) values[":reason"] = reason;
        if (extraFields.includes(":actor")) values[":actor"] = user.name;
        if (extraFields.includes(":steps")) values[":steps"] = skippedPendingSteps(reservation.approvalSteps);
        const transaction = [
          { Update: {
            TableName: TABLES.reservations,
            Key: { id: reservation.id },
            UpdateExpression: `SET #status = :next, updatedAt = :updatedAt, ${extraFields}`,
            ConditionExpression: "#status = :previous",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: values
          } },
          { Put: { TableName: TABLES.notifications, Item: notificationRecord(reservation.requesterEmail, reservation.requester, `${reservation.resourceName} status changed to ${nextStatus}${reason ? `. Reason: ${reason}` : "."}`) } },
          { Put: { TableName: TABLES.activity, Item: activityRecord(user, `Reservation marked ${nextStatus}`, reservation.resourceName, reservation.office, reservation.id, body.reason) } },
          { Put: { TableName: TABLES.reservationHistory, Item: reservationHistoryRecord(user, reservation, reservation.status, nextStatus, reason) } }
        ];
        if (["Completed", "No Show", "Cancelled", "Expired"].includes(nextStatus)) {
          transaction.push(...reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end).map((slotKey) => ({
            Delete: { TableName: TABLES.reservationLocks, Key: { slotKey } }
          })));
        }
        if (payment && ["Cancelled", "Expired"].includes(nextStatus) && ACTIVE_PAYMENT_STATUSES.has(payment.status)) {
          transaction.push({ Update: {
            TableName: TABLES.payments,
            Key: { id: payment.id },
            UpdateExpression: "SET #status = :paymentStatus, rejectionReason = :reason, updatedAt = :updatedAt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":paymentStatus": nextStatus, ":reason": reason, ":updatedAt": updatedAt }
          } });
        }
        await repo.transact(transaction);
        return json(200, { ...reservation, status: nextStatus, updatedAt });
      }

      if (rawPath.endsWith("/driver/unassign")) {
        requireRole(user, ROLES.officeAdmin, ROLES.superAdmin);
        if (!canManageStatus(user, reservation)) throw new HttpError(403, "Only the owning office or Super Admin can manage driver assignment.");
        const assignments = await repo.query(TABLES.reservationDrivers, "reservation-index", "reservationId", reservation.id);
        const active = assignments.find((item) => item.status === "Assigned");
        if (!active) throw new HttpError(409, "This reservation has no active driver assignment.");
        await repo.transact([
          { Update: {
            TableName: TABLES.reservationDrivers,
            Key: { id: active.id },
            UpdateExpression: "SET #status = :unassigned, unassignedAt = :updatedAt, unassignedBy = :actor, updatedAt = :updatedAt",
            ConditionExpression: "#status = :assigned",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":unassigned": "Unassigned", ":assigned": "Assigned", ":updatedAt": updatedAt, ":actor": user.name }
          } },
          { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Driver unassigned", `${reservation.resourceName}: ${active.driverName}`, reservation.office, reservation.id) } }
        ]);
        return json(200, { reservationId: reservation.id, driverId: null });
      }

      if (rawPath.endsWith("/driver")) {
        requireRole(user, ROLES.officeAdmin, ROLES.superAdmin);
        if (!canManageStatus(user, reservation)) throw new HttpError(403, "Only the owning office or Super Admin can manage driver assignment.");
        requireFields(body, ["driverId"]);
        const resource = await repo.get(TABLES.resources, { id: reservation.resourceId });
        if (!resource || resource.type !== "Vehicle" || resource.driver !== "With Driver") throw new HttpError(409, "This reservation does not require a driver.");
        const driver = await repo.get(TABLES.drivers, { id: body.driverId });
        if (!driver || driver.office !== reservation.office) throw new HttpError(404, "Driver not found for this office.");
        if (driver.status !== "Available") throw new HttpError(409, "This driver is not available.");
        const existingForReservation = await repo.query(TABLES.reservationDrivers, "reservation-index", "reservationId", reservation.id);
        if (existingForReservation.some((item) => item.status === "Assigned")) throw new HttpError(409, "This reservation already has an assigned driver. Unassign it first.");
        const driverAssignments = await repo.query(TABLES.reservationDrivers, "driver-index", "driverId", driver.id);
        const activeReservationIds = driverAssignments.filter((item) => item.status === "Assigned").map((item) => item.reservationId);
        if (activeReservationIds.length) {
          const conflicting = await Promise.all(activeReservationIds.map((id) => repo.get(TABLES.reservations, { id })));
          const hasConflict = conflicting.some((item) => item && item.date === reservation.date && !RESOLVED_RESERVATION_STATUSES.has(item.status) && overlaps(item, reservation));
          if (hasConflict) throw new HttpError(409, "This driver is already assigned to an overlapping reservation.");
        }
        const assignment = {
          id: createId("RD"),
          reservationId: reservation.id,
          driverId: driver.id,
          driverName: driver.name,
          vehicleResourceId: resource.id,
          office: reservation.office,
          status: "Assigned",
          assignedAt: updatedAt,
          assignedBy: user.name,
          assignedByEmail: user.email,
          createdAt: updatedAt,
          updatedAt
        };
        await repo.transact([
          { Put: { TableName: TABLES.reservationDrivers, Item: assignment, ConditionExpression: "attribute_not_exists(id)" } },
          { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Driver assigned", `${reservation.resourceName}: ${driver.name}`, reservation.office, reservation.id) } }
        ]);
        return json(200, assignment);
      }

      requireRole(user, ROLES.officeAdmin, ROLES.osgAdmin);
      if (typeof body.approved !== "boolean") throw new HttpError(400, "approved must be true or false.");
      requireFields(body, ["stepId"]);
      const pendingStep = reservation.approvalSteps?.find((item) => item.id === body.stepId);
      if (!pendingStep || !canDecideStep(user, pendingStep)) throw new HttpError(403, "This approval step is not assigned to your office.");
      const decision = decideApprovalStep(reservation, body.stepId, body.approved, user.name, updatedAt);
      const status = decision.status;
      const nextVersion = Number(reservation.workflowVersion || 1) + 1;
      const activity = activityRecord(user, body.approved ? "Approval step approved" : "Approval step rejected", `${reservation.resourceName}: ${pendingStep.name}`, reservation.office, reservation.id, body.reason);
      const notification = notificationRecord(
        reservation.requesterEmail,
        reservation.requester,
        body.approved ? `${pendingStep.name} was approved. Current status: ${status}.` : `${reservation.resourceName} was rejected during ${pendingStep.name}.`
      );
      const workflow = await repo.get(TABLES.approvalWorkflows, { id: reservation.workflowTemplateId });
      const templateStep = workflow?.steps?.find((item) => item.id === pendingStep.templateStepId);
      let approvingBody = null;
      if (templateStep?.approvingBodyId) {
        approvingBody = await repo.get(TABLES.approvingBodies, { id: templateStep.approvingBodyId });
      } else {
        const bodies = await repo.query(TABLES.approvingBodies, "office-index", "office", pendingStep.office);
        approvingBody = bodies.find((item) => item.status === "Active") || null;
      }
      const transaction = [
        { Update: {
          TableName: TABLES.reservations,
          Key: { id: reservation.id },
          UpdateExpression: "SET #status = :next, approvalSteps = :steps, workflowVersion = :nextVersion, updatedAt = :updatedAt",
          ConditionExpression: "workflowVersion = :expectedVersion",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":next": status, ":steps": decision.steps, ":nextVersion": nextVersion, ":updatedAt": updatedAt, ":expectedVersion": Number(reservation.workflowVersion || 1) }
        } },
        { Put: { TableName: TABLES.notifications, Item: notification } },
        { Put: { TableName: TABLES.activity, Item: activity } },
        { Put: { TableName: TABLES.approvals, Item: approvalRecord(user, reservation, decision.step, body.approved, approvingBody, body.reason || "") } },
        { Put: { TableName: TABLES.reservationHistory, Item: reservationHistoryRecord(user, reservation, reservation.status, status, body.reason || "") } }
      ];

      let payment;
      if (body.approved && Number(pendingStep.sequence) === 1 && !reservation.slotLockVersion) {
        const slots = reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end);
        const expiresAt = lockExpiry(reservation.date);
        transaction.push(...slots.map((slotKey) => ({ Put: {
          TableName: TABLES.reservationLocks,
          Item: { slotKey, reservationId: reservation.id, expiresAt },
          ConditionExpression: "attribute_not_exists(slotKey)"
        } })));
      }

      if (!body.approved) {
        transaction.push(...reservationSlots(reservation.resourceId, reservation.date, reservation.start, reservation.end).map((slotKey) => ({
          Delete: { TableName: TABLES.reservationLocks, Key: { slotKey } }
        })));
      }

      if (body.approved && status === "For Payment" && !reservation.paymentId) {
          const resource = await repo.get(TABLES.resources, { id: reservation.resourceId });
          const settings = await repo.get(TABLES.systemSettings, { id: "SYSTEM" }) || {};
          const paymentDeadlineHours = effectivePaymentDeadlineHours(resource, settings);
          payment = {
            id: createId("PAY"),
            reservationId: reservation.id,
            requester: reservation.requester,
            requesterEmail: reservation.requesterEmail,
            office: reservation.office,
            amount: Number(resource?.fee || 0),
            receipt: "Awaiting upload",
            status: "Awaiting Receipt",
            createdAt: updatedAt,
            paymentDeadlineHours,
            paymentDeadlineAt: paymentDeadlineFor(reservation, null, updatedAt, paymentDeadlineHours)
          };
          transaction.push({ Put: { TableName: TABLES.payments, Item: payment, ConditionExpression: "attribute_not_exists(id)" } });
          transaction[0].Update.UpdateExpression += ", paymentId = :paymentId";
          transaction[0].Update.ExpressionAttributeValues[":paymentId"] = payment.id;
      }

      await repo.transact(transaction);
      return json(200, { ...reservation, approvalSteps: decision.steps, workflowVersion: nextVersion, status, updatedAt, paymentId: payment?.id || reservation.paymentId });
    }

    throw new HttpError(405, "Method not allowed.");
  });
}

export const handler = createHandler();
