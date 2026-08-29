import { authenticatedUser, requireOffice, requireRole, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, createId, now } from "../lib/records.mjs";
import { TABLES } from "../lib/tables.mjs";

const STATUSES = ["Available", "Reserved", "In Use", "Under Maintenance", "Unavailable"];
const TYPES = ["Facility", "Vehicle", "Equipment", "Visitor Service"];

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
      const workflowTemplateId = body.workflowTemplateId || "WF-BASIC";
      const workflow = await repo.get(TABLES.approvalWorkflows, { id: workflowTemplateId });
      if (!workflow || workflow.status !== "Active") throw new HttpError(400, "Select an active approval workflow.");
      const createdAt = now();
      const resource = {
        id: createId("R"),
        name: String(body.name).trim(),
        type: body.type,
        office: user.office,
        location: String(body.location).trim(),
        capacity: Number(body.capacity),
        status: "Available",
        requiresPayment: Boolean(body.requiresPayment),
        fee: body.requiresPayment ? Number(body.fee || 0) : 0,
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
      if (body.workflowTemplateId) {
        const workflow = await repo.get(TABLES.approvalWorkflows, { id: body.workflowTemplateId });
        if (!workflow || workflow.status !== "Active") throw new HttpError(400, "Select an active approval workflow.");
      }
      const changes = statusOnly ? { status: body.status, updatedAt } : {
        name: body.name === undefined ? undefined : String(body.name).trim(),
        type: body.type,
        location: body.location === undefined ? undefined : String(body.location).trim(),
        capacity: body.capacity === undefined ? undefined : Number(body.capacity),
        status: body.status,
        requiresPayment: body.requiresPayment === undefined ? undefined : Boolean(body.requiresPayment),
        fee: body.fee === undefined ? undefined : Number(body.fee),
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
