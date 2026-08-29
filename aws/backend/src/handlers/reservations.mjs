import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authenticatedUser, requireOffice, requireRole, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, createId, newestFirst, notificationRecord, now } from "../lib/records.mjs";
import { lockExpiry, reservationSlots } from "../lib/slots.mjs";
import { TABLES } from "../lib/tables.mjs";
import { buildApprovalSteps, canDecideStep, decideApprovalStep } from "../lib/workflows.mjs";

const BLOCKING_STATUSES = new Set(["Under Owner Review", "Under Additional Review", "Approved", "Confirmed", "For Payment"]);
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

async function reservationsForDate(repo, resourceId, date) {
  return repo.query(TABLES.reservations, "resource-date-index", "resourceDate", `${resourceId}#${date}`);
}

function conflictsFor(items, start, end) {
  if (!start || !end || start >= end) return [];
  return items.filter((item) => BLOCKING_STATUSES.has(item.status) && overlaps(item, { start, end }));
}

async function slotOptions(repo, resource, date, start, end) {
  if (!resource || !date) return [];
  const duration = selectedDuration(start, end);
  const step = duration >= DEFAULT_SLOT_MINUTES ? DEFAULT_SLOT_MINUTES : 30;
  const unavailableDay = resource.status !== "Available" || date < tomorrowIso();
  const sameDay = unavailableDay ? [] : await reservationsForDate(repo, resource.id, date);
  const options = [];
  for (let minute = BUSINESS_DAY_START; minute + duration <= BUSINESS_DAY_END; minute += step) {
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
  if (start >= end) return {
    status: "unavailable",
    message: "End time must be later than start time.",
    conflicts: [],
    slots: await slotOptions(repo, resource, date, start, end),
    alternatives: []
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
  if (user.role === ROLES.requester) return repo.query(TABLES.reservations, "requester-index", "requesterEmail", user.email);
  if (user.role === ROLES.officeAdmin) {
    const items = await repo.scan(TABLES.reservations);
    return items.filter((item) => item.office === user.office || item.approvalSteps?.some((step) => step.office === user.office));
  }
  if (user.role === ROLES.osgAdmin) {
    const items = await repo.scan(TABLES.reservations);
    return items.filter((item) => item.approvalSteps?.some((step) => step.office === "OSG"));
  }
  if (user.role === ROLES.superAdmin) return repo.scan(TABLES.reservations);
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
      if (reservation.requesterEmail !== user.email) throw new HttpError(403, "This reservation does not belong to your account.");
      if (["Rejected", "Cancelled", "Completed"].includes(reservation.status)) {
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
      const activity = activityRecord(user, "Supporting document uploaded", reservation.resourceName, reservation.office);
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
      const requirements = {
        setupRequired: Boolean(body.setupRequired),
        externalVisitors: Boolean(body.externalVisitors),
        parkingRequired: Boolean(body.parkingRequired)
      };
      const reservation = {
        id,
        requester: user.name,
        requesterEmail: user.email,
        resourceId: resource.id,
        resourceName: resource.name,
        resourceDate,
        office: resource.office,
        type: resource.type,
        date: body.date,
        start: body.start,
        end: body.end,
        quantity: Number(body.quantity || 1),
        purpose: String(body.purpose).trim(),
        ...requirements,
        status: "Under Owner Review",
        submittedAt,
        createdAt: submittedAt,
        requiresPayment: Boolean(resource.requiresPayment),
        workflowTemplateId,
        workflowName: workflow.name,
        workflowVersion: 1,
        slotLockVersion: 1,
        approvalSteps: buildApprovalSteps(workflow, resource, requirements, id)
      };
      const notification = notificationRecord(user.email, user.name, `${resource.name} request was submitted for ${resource.office} review.`);
      const activity = activityRecord(user, "Reservation submitted", resource.name, resource.office);
      await repo.transact([
        { Put: { TableName: TABLES.reservations, Item: reservation, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.notifications, Item: notification } },
        { Put: { TableName: TABLES.activity, Item: activity } },
        ...slots.map((slotKey) => ({ Put: {
          TableName: TABLES.reservationLocks,
          Item: { slotKey, reservationId: reservation.id, expiresAt: lockExpiry(reservation.date) },
          ConditionExpression: "attribute_not_exists(slotKey)"
        } }))
      ]);
      return json(201, reservation);
    }

    if (requestMethod === "PATCH") {
      requireRole(user, ROLES.officeAdmin, ROLES.osgAdmin);
      const reservation = await repo.get(TABLES.reservations, { id: event.pathParameters?.id });
      if (!reservation) throw new HttpError(404, "Reservation not found.");
      const body = parseBody(event);
      if (typeof body.approved !== "boolean") throw new HttpError(400, "approved must be true or false.");
      requireFields(body, ["stepId"]);
      const pendingStep = reservation.approvalSteps?.find((item) => item.id === body.stepId);
      if (!pendingStep || !canDecideStep(user, pendingStep)) throw new HttpError(403, "This approval step is not assigned to your office.");
      const updatedAt = now();
      const decision = decideApprovalStep(reservation, body.stepId, body.approved, user.name, updatedAt);
      const status = decision.status;
      const nextVersion = Number(reservation.workflowVersion || 1) + 1;
      const activity = activityRecord(user, body.approved ? "Approval step approved" : "Approval step rejected", `${reservation.resourceName}: ${pendingStep.name}`);
      const notification = notificationRecord(
        reservation.requesterEmail,
        reservation.requester,
        body.approved ? `${pendingStep.name} was approved. Current status: ${status}.` : `${reservation.resourceName} was rejected during ${pendingStep.name}.`
      );
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
        { Put: { TableName: TABLES.activity, Item: activity } }
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
          payment = {
            id: createId("PAY"),
            reservationId: reservation.id,
            requester: reservation.requester,
            requesterEmail: reservation.requesterEmail,
            office: reservation.office,
            amount: Number(resource?.fee || 0),
            receipt: "Awaiting upload",
            status: "Awaiting Receipt",
            createdAt: updatedAt
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
