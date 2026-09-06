import { authenticatedUser, requireOffice, requireRole, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, createId, now } from "../lib/records.mjs";
import { MAX_PAYMENT_DEADLINE_HOURS, MIN_PAYMENT_DEADLINE_HOURS } from "../lib/reservationLifecycle.mjs";
import { TABLES } from "../lib/tables.mjs";

const STATUSES = ["Available", "Reserved", "In Use", "Under Maintenance", "Unavailable"];
const TYPES = ["Facility", "Vehicle", "Equipment", "Visitor Service"];

function normalizeAssetTag(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function assetTagPrefix(office, type) {
  const officeWords = String(office || "").trim().toUpperCase().match(/[A-Z0-9]+/g) || ["OFFICE"];
  const officeCode = officeWords.length > 1
    ? officeWords.map((word) => word.slice(0, 3)).join("").slice(0, 8)
    : officeWords[0].slice(0, 6);
  const typeCodes = {
    Facility: "FAC",
    Vehicle: "VEH",
    Equipment: "EQP",
    "Visitor Service": "VIS"
  };
  return `${officeCode || "OFFICE"}-${typeCodes[type] || "RES"}`;
}

function generateAssetTag(resources = [], office = "", type = "Equipment", currentId = "") {
  const prefix = assetTagPrefix(office, type);
  const used = new Set(resources.filter((resource) => resource.id !== currentId).map((resource) => normalizeAssetTag(resource.assetTag || "")));
  const numbers = [...used]
    .filter((assetTag) => assetTag.startsWith(`${prefix}-`))
    .map((assetTag) => Number(assetTag.slice(prefix.length + 1)))
    .filter(Number.isInteger);
  let nextNumber = Math.max(0, ...numbers) + 1;
  let candidate = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  while (used.has(candidate)) {
    nextNumber += 1;
    candidate = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  }
  return candidate;
}

function normalizeResourceTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 32)))].slice(0, 8);
}

function paymentDeadlineHoursFrom(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < MIN_PAYMENT_DEADLINE_HOURS || number > MAX_PAYMENT_DEADLINE_HOURS) {
    throw new HttpError(400, `Payment window must be a whole number from ${MIN_PAYMENT_DEADLINE_HOURS} to ${MAX_PAYMENT_DEADLINE_HOURS} hours.`);
  }
  return number;
}

function assertUniqueAssetTag(resources, assetTag, currentId = "") {
  if (!assetTag) throw new HttpError(400, "Asset tag is required.");
  if (resources.some((item) => item.id !== currentId && normalizeAssetTag(item.assetTag) === assetTag)) {
    throw new HttpError(409, "Asset tag must be unique.");
  }
}

export function createHandler(repo = repository) {
  return wrap(async (event) => {
    const user = await authenticatedUser(event, repo);
    const requestMethod = method(event);

    if (requestMethod === "GET") {
      let items;
      if (user.role === ROLES.officeAdmin) items = await repo.query(TABLES.resources, "office-index", "office", user.office);
      else if ([ROLES.requester, ROLES.superAdmin].includes(user.role)) {
        items = await repo.scan(TABLES.resources);
        if (user.role === ROLES.requester) items = items.filter((item) => item.status !== "Archived" && item.type !== "Visitor Service");
      }
      else items = await repo.query(TABLES.resources, "office-index", "office", "OSG");
      return json(200, { items });
    }

    if (requestMethod === "POST") {
      requireRole(user, ROLES.officeAdmin);
      const body = parseBody(event);
      requireFields(body, ["name", "type", "location", "capacity"]);
      if (!TYPES.includes(body.type)) throw new HttpError(400, "Unsupported resource type.");
      const resources = await repo.scan(TABLES.resources);
      const assetTag = normalizeAssetTag(body.assetTag || generateAssetTag(resources, user.office, body.type));
      assertUniqueAssetTag(resources, assetTag);
      const workflowTemplateId = body.workflowTemplateId || "WF-BASIC";
      const workflow = await repo.get(TABLES.approvalWorkflows, { id: workflowTemplateId });
      if (!workflow || workflow.status !== "Active") throw new HttpError(400, "Select an active approval workflow.");
      const createdAt = now();
      const resource = {
        id: createId("R"),
        assetTag,
        name: String(body.name).trim(),
        type: body.type,
        office: user.office,
        location: String(body.location).trim(),
        serialNumber: String(body.serialNumber || "").trim(),
        tags: normalizeResourceTags(body.tags || [body.type, user.office]),
        capacity: Number(body.capacity),
        status: "Available",
        requiresPayment: Boolean(body.requiresPayment),
        fee: body.requiresPayment ? Number(body.fee || 0) : 0,
        paymentDeadlineHours: body.requiresPayment ? paymentDeadlineHoursFrom(body.paymentDeadlineHours) : null,
        driver: body.driver || "Not applicable",
        workflowTemplateId,
        createdAt,
        updatedAt: createdAt
      };
      const activity = activityRecord(user, "Resource created", resource.name);
      await repo.transact([
        { Put: { TableName: TABLES.resources, Item: resource, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.activity, Item: activity } }
      ]);
      return json(201, resource);
    }

    if (requestMethod === "PATCH") {
      requireRole(user, ROLES.officeAdmin);
      const resource = await repo.get(TABLES.resources, { id: event.pathParameters?.id });
      if (!resource) throw new HttpError(404, "Resource not found.");
      requireOffice(user, resource);
      const body = parseBody(event);
      const statusOnly = (event.rawPath || event.path || "").endsWith("/status");
      if (body.status && ![...STATUSES, "Archived"].includes(body.status)) throw new HttpError(400, "Unsupported resource status.");
      const updatedAt = now();
      if (statusOnly && !body.status) throw new HttpError(400, "status is required.");
      const assetTag = body.assetTag === undefined ? undefined : normalizeAssetTag(body.assetTag);
      if (assetTag !== undefined) assertUniqueAssetTag(await repo.scan(TABLES.resources), assetTag, resource.id);
      if (body.workflowTemplateId) {
        const workflow = await repo.get(TABLES.approvalWorkflows, { id: body.workflowTemplateId });
        if (!workflow || workflow.status !== "Active") throw new HttpError(400, "Select an active approval workflow.");
      }
      const changes = statusOnly ? { status: body.status, updatedAt } : {
        name: body.name === undefined ? undefined : String(body.name).trim(),
        assetTag,
        type: body.type,
        location: body.location === undefined ? undefined : String(body.location).trim(),
        serialNumber: body.serialNumber === undefined ? undefined : String(body.serialNumber || "").trim(),
        tags: body.tags === undefined ? undefined : normalizeResourceTags(body.tags),
        capacity: body.capacity === undefined ? undefined : Number(body.capacity),
        status: body.status,
        requiresPayment: body.requiresPayment === undefined ? undefined : Boolean(body.requiresPayment),
        fee: body.requiresPayment === false ? 0 : body.fee === undefined ? undefined : Number(body.fee),
        paymentDeadlineHours: body.requiresPayment === false ? null : body.paymentDeadlineHours === undefined ? undefined : paymentDeadlineHoursFrom(body.paymentDeadlineHours),
        driver: body.driver,
        workflowTemplateId: body.workflowTemplateId,
        updatedAt
      };
      if (changes.type && !TYPES.includes(changes.type)) throw new HttpError(400, "Unsupported resource type.");
      const action = body.status === "Archived" ? "Resource archived" : statusOnly ? "Resource status updated" : "Resource updated";
      const updated = await repo.update(TABLES.resources, { id: resource.id }, changes, {
        ConditionExpression: "office = :office",
        ExpressionAttributeValues: { ":office": user.office }
      });
      await repo.put(TABLES.activity, activityRecord(user, action, updated.name));
      return json(200, updated);
    }

    throw new HttpError(405, "Method not allowed.");
  });
}

export const handler = createHandler();
