import { authenticatedUser, requireRole, REQUESTER_TYPES, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, createId, newestFirst, now } from "../lib/records.mjs";
import {
  DEFAULT_PAYMENT_DEADLINE_HOURS,
  MAX_PAYMENT_DEADLINE_HOURS,
  MIN_PAYMENT_DEADLINE_HOURS,
  normalizePaymentDeadlineHours,
  normalizePaymentSteps
} from "../lib/reservationLifecycle.mjs";
import { TABLES } from "../lib/tables.mjs";

const ALLOWED_ROLES = new Set(Object.values(ROLES));

function routeName(event) {
  const path = event.rawPath || event.path || "";
  if (path === "/users") return "users";
  if (path.includes("/users/") && path.endsWith("/role")) return "user-role";
  if (path.includes("/users/") && path.endsWith("/access")) return "user-access";
  if (path.includes("/users/") && path.endsWith("/requester-type")) return "user-requester-type";
  if (path === "/offices") return "offices";
  if (path.includes("/offices/")) return "office-item";
  if (path === "/workflows") return "workflows";
  if (path.includes("/workflows/")) return "workflow-item";
  if (path === "/approving-bodies") return "approving-bodies";
  if (path.includes("/approving-bodies/")) return "approving-body-item";
  if (path === "/settings") return "settings";
  if (path === "/notifications") return "notifications";
  if (path.endsWith("/notifications/read")) return "notification-read";
  if (path === "/activity") return "activity";
  return "unknown";
}

function settingsFrom(body, existing = {}) {
  const paymentDeadlineHours = Number(body.paymentDeadlineHours ?? existing.paymentDeadlineHours ?? DEFAULT_PAYMENT_DEADLINE_HOURS);
  if (!Number.isInteger(paymentDeadlineHours) || paymentDeadlineHours < MIN_PAYMENT_DEADLINE_HOURS || paymentDeadlineHours > MAX_PAYMENT_DEADLINE_HOURS) {
    throw new HttpError(400, `Payment deadline must be a whole number from ${MIN_PAYMENT_DEADLINE_HOURS} to ${MAX_PAYMENT_DEADLINE_HOURS} hours.`);
  }
  return {
    ...existing,
    id: "SYSTEM",
    defaultWorkflowTemplateId: body.defaultWorkflowTemplateId ?? existing.defaultWorkflowTemplateId ?? "WF-BASIC",
    maxReservationHours: body.maxReservationHours ?? existing.maxReservationHours,
    parkingCapacity: body.parkingCapacity ?? existing.parkingCapacity,
    paymentDeadlineHours: normalizePaymentDeadlineHours(paymentDeadlineHours),
    paymentInstructions: String(body.paymentInstructions ?? existing.paymentInstructions ?? "").trim().slice(0, 1200),
    paymentSteps: normalizePaymentSteps(body.paymentSteps ?? existing.paymentSteps),
    updatedAt: now()
  };
}

function workflowFrom(body, existing = {}) {
  const steps = (body.steps || existing.steps || []).map((step, index) => ({
    id: step.id || `STEP-${index + 1}`,
    name: String(step.name || "").trim(),
    office: step.office,
    sequence: Number(step.sequence || 1),
    approvingBodyId: step.approvingBodyId || ""
  }));
  if (!String(body.name || existing.name || "").trim() || !steps.some((step) => step.office === "$OWNER" && step.sequence === 1)) {
    throw new HttpError(400, "A workflow needs a name and a sequence-one Resource Owner step.");
  }
  const office = String(body.office ?? existing.office ?? "").trim();
  return {
    ...existing,
    name: String(body.name || existing.name).trim(),
    resourceType: body.resourceType || existing.resourceType || "All",
    status: body.status || existing.status || "Active",
    steps,
    ...(office ? { office } : {}),
    updatedAt: now()
  };
}

async function userFrom(body, repo) {
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const office = String(body.office || "").trim();
  const role = body.role;
  const status = body.status || "Active";
  if (!email || !name || !office) throw new HttpError(400, "User name, email, and office are required.");
  if (!email.endsWith("@ust.edu.ph")) throw new HttpError(400, "Use a valid UST SSO email ending in @ust.edu.ph.");
  if (!ALLOWED_ROLES.has(role)) throw new HttpError(400, "Unsupported role.");
  if (!["Active", "Inactive"].includes(status)) throw new HttpError(400, "Unsupported account status.");
  if (role === ROLES.superAdmin && office !== "All Offices") throw new HttpError(400, "Super Admin accounts must use All Offices.");
  if (role === ROLES.officeAdmin && office === "All Offices") throw new HttpError(400, "Office Admin accounts must be assigned to a specific office.");
  if (role === ROLES.osgAdmin && office !== "OSG") throw new HttpError(400, "OSG Admin accounts must be assigned to OSG.");
  const requesterType = role === ROLES.requester ? String(body.requesterType || "") : "";
  if (role === ROLES.requester && !REQUESTER_TYPES.has(requesterType)) {
    throw new HttpError(400, "Requester accounts must specify a valid affiliation.");
  }
  const offices = await repo.scan(TABLES.offices);
  const validOffice = role === ROLES.requester || office === "All Offices" || offices.some((item) => item.name === office && item.status === "Active");
  if (!validOffice) throw new HttpError(400, "Assign the user to an active office.");
  return { email, name, office, role, status, requesterType };
}

async function approvingBodyFrom(body, repo, existing = {}) {
  const bodyName = String(body.bodyName || existing.bodyName || "").trim();
  const office = String(body.office || existing.office || "").trim();
  const description = body.description === undefined ? (existing.description || "") : String(body.description || "").trim();
  const status = body.status || existing.status || "Active";
  if (!bodyName || !office) throw new HttpError(400, "Approving body name and office are required.");
  if (!["Active", "Inactive"].includes(status)) throw new HttpError(400, "Unsupported approving body status.");
  const offices = await repo.scan(TABLES.offices);
  const matchedOffice = offices.find((item) => item.name === office && item.status === "Active");
  if (!matchedOffice) throw new HttpError(400, "Assign the approving body to an active office.");
  return { ...existing, office, officeId: matchedOffice.id, bodyName, description, status };
}

async function listActivity(repo, user) {
  if (user.role === ROLES.superAdmin) return repo.scan(TABLES.activity);
  if (user.role === ROLES.officeAdmin) return repo.query(TABLES.activity, "office-index", "office", user.office);
  if (user.role === ROLES.osgAdmin) return repo.query(TABLES.activity, "office-index", "office", "OSG");
  const all = await repo.scan(TABLES.activity);
  return all.filter((item) => item.actorEmail === user.email);
}

export function createHandler(repo = repository) {
  return wrap(async (event) => {
    const user = await authenticatedUser(event, repo);
    const requestMethod = method(event);
    const route = routeName(event);

    if (route === "users" && requestMethod === "GET") {
      requireRole(user, ROLES.superAdmin);
      return json(200, { items: await repo.scan(TABLES.users) });
    }

    if (route === "users" && requestMethod === "POST") {
      requireRole(user, ROLES.superAdmin);
      const account = await userFrom(parseBody(event), repo);
      if (account.email === user.email) throw new HttpError(400, "Your signed-in account already exists.");
      const createdAt = now();
      const item = { ...account, createdAt, updatedAt: createdAt };
      await repo.transact([
        { Put: { TableName: TABLES.users, Item: item, ConditionExpression: "attribute_not_exists(email)" } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, "User account created", item.name, item.office) } }
      ]);
      return json(201, item);
    }

    if (route === "user-role" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin);
      const email = decodeURIComponent(event.pathParameters?.email || "").toLowerCase();
      if (email === user.email) throw new HttpError(400, "You cannot change your own role while signed in.");
      const target = await repo.get(TABLES.users, { email });
      if (!target) throw new HttpError(404, "User not found.");
      const body = parseBody(event);
      if (!ALLOWED_ROLES.has(body.role)) throw new HttpError(400, "Unsupported role.");
      const requestedType = String(body.requesterType || target.requesterType || "");
      const requesterType = body.role === ROLES.requester
        ? (REQUESTER_TYPES.has(requestedType) ? requestedType : "Student")
        : "";
      const updatedAt = now();
      const activity = activityRecord(user, "User role updated", target.name, target.office);
      await repo.transact([
        { Update: {
          TableName: TABLES.users,
          Key: { email },
          UpdateExpression: "SET #role = :role, requesterType = :requesterType, updatedAt = :updatedAt",
          ExpressionAttributeNames: { "#role": "role" },
          ExpressionAttributeValues: { ":role": body.role, ":requesterType": requesterType, ":updatedAt": updatedAt }
        } },
        { Put: { TableName: TABLES.activity, Item: activity } }
      ]);
      return json(200, { ...target, role: body.role, requesterType, updatedAt });
    }

    if (route === "user-requester-type" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin);
      const email = decodeURIComponent(event.pathParameters?.email || "").toLowerCase();
      const target = await repo.get(TABLES.users, { email });
      if (!target) throw new HttpError(404, "User not found.");
      if (target.role !== ROLES.requester) throw new HttpError(400, "Only Requester accounts have an affiliation.");
      const body = parseBody(event);
      if (!REQUESTER_TYPES.has(body.requesterType)) throw new HttpError(400, "Unsupported affiliation.");
      const updatedAt = now();
      await repo.transact([
        { Update: {
          TableName: TABLES.users,
          Key: { email },
          UpdateExpression: "SET requesterType = :requesterType, updatedAt = :updatedAt",
          ExpressionAttributeValues: { ":requesterType": body.requesterType, ":updatedAt": updatedAt }
        } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Affiliation updated", target.name, target.office) } }
      ]);
      return json(200, { ...target, requesterType: body.requesterType, updatedAt });
    }

    if (route === "user-access" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin);
      const email = decodeURIComponent(event.pathParameters?.email || "").toLowerCase();
      if (email === user.email) throw new HttpError(400, "You cannot deactivate your own account while signed in.");
      const body = parseBody(event);
      if (!["Active", "Inactive"].includes(body.status)) throw new HttpError(400, "Unsupported account status.");
      const target = await repo.get(TABLES.users, { email });
      if (!target) throw new HttpError(404, "User not found.");
      const updated = await repo.update(TABLES.users, { email }, { status: body.status, updatedAt: now() });
      await repo.put(TABLES.activity, activityRecord(user, "User access updated", `${target.name}: ${body.status}`, target.office));
      return json(200, updated);
    }

    if (route === "offices" && requestMethod === "GET") {
      requireRole(user, ROLES.superAdmin);
      return json(200, { items: await repo.scan(TABLES.offices) });
    }

    if (route === "offices" && requestMethod === "POST") {
      requireRole(user, ROLES.superAdmin);
      const body = parseBody(event);
      requireFields(body, ["name"]);
      const createdAt = now();
      const office = { id: createId("OFF"), name: String(body.name).trim(), status: "Active", createdAt, updatedAt: createdAt };
      const activity = activityRecord(user, "Office created", office.name, office.name);
      await repo.transact([
        { Put: { TableName: TABLES.offices, Item: office, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.activity, Item: activity } }
      ]);
      return json(201, office);
    }

    if (route === "office-item" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin);
      const office = await repo.get(TABLES.offices, { id: event.pathParameters?.id });
      if (!office) throw new HttpError(404, "Office not found.");
      const body = parseBody(event);
      const name = String(body.name || office.name).trim();
      const status = body.status || office.status;
      if (!name || !["Active", "Inactive"].includes(status)) throw new HttpError(400, "Invalid office settings.");
      const updatedAt = now();
      const resources = name === office.name ? [] : await repo.query(TABLES.resources, "office-index", "office", office.name);
      const users = name === office.name ? [] : await repo.query(TABLES.users, "office-index", "office", office.name);
      const approvingBodies = name === office.name ? [] : await repo.query(TABLES.approvingBodies, "office-index", "office", office.name);
      if (resources.length + users.length + approvingBodies.length > 90) throw new HttpError(409, "This office has too many assignments for an atomic rename. Transfer them in batches first.");
      const transaction = [
        { Update: { TableName: TABLES.offices, Key: { id: office.id }, UpdateExpression: "SET #name = :name, #status = :status, updatedAt = :updatedAt", ExpressionAttributeNames: { "#name": "name", "#status": "status" }, ExpressionAttributeValues: { ":name": name, ":status": status, ":updatedAt": updatedAt } } },
        ...resources.map((item) => ({ Update: { TableName: TABLES.resources, Key: { id: item.id }, UpdateExpression: "SET office = :name, updatedAt = :updatedAt", ExpressionAttributeValues: { ":name": name, ":updatedAt": updatedAt } } })),
        ...users.map((item) => ({ Update: { TableName: TABLES.users, Key: { email: item.email }, UpdateExpression: "SET office = :name, updatedAt = :updatedAt", ExpressionAttributeValues: { ":name": name, ":updatedAt": updatedAt } } })),
        ...approvingBodies.map((item) => ({ Update: { TableName: TABLES.approvingBodies, Key: { id: item.id }, UpdateExpression: "SET office = :name, updatedAt = :updatedAt", ExpressionAttributeValues: { ":name": name, ":updatedAt": updatedAt } } })),
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, status === "Inactive" ? "Office archived" : "Office updated", name, name) } }
      ];
      await repo.transact(transaction);
      return json(200, { ...office, name, status, updatedAt });
    }

    if (route === "approving-bodies" && requestMethod === "GET") {
      requireRole(user, ROLES.superAdmin);
      return json(200, { items: await repo.scan(TABLES.approvingBodies) });
    }

    if (route === "approving-bodies" && requestMethod === "POST") {
      requireRole(user, ROLES.superAdmin);
      const approvingBody = await approvingBodyFrom(parseBody(event), repo);
      const createdAt = now();
      const item = { ...approvingBody, id: createId("AB"), createdAt, updatedAt: createdAt };
      await repo.transact([
        { Put: { TableName: TABLES.approvingBodies, Item: item, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Approving body created", item.bodyName, item.office) } }
      ]);
      return json(201, item);
    }

    if (route === "approving-body-item" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin);
      const existing = await repo.get(TABLES.approvingBodies, { id: event.pathParameters?.id });
      if (!existing) throw new HttpError(404, "Approving body not found.");
      const approvingBody = await approvingBodyFrom(parseBody(event), repo, existing);
      const updatedAt = now();
      const item = { ...approvingBody, updatedAt };
      await repo.transact([
        { Put: { TableName: TABLES.approvingBodies, Item: item } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, item.status === "Inactive" ? "Approving body archived" : "Approving body updated", item.bodyName, item.office) } }
      ]);
      return json(200, item);
    }

    if (route === "workflows" && requestMethod === "GET") {
      requireRole(user, ROLES.superAdmin);
      return json(200, { items: await repo.scan(TABLES.approvalWorkflows) });
    }

    if (route === "workflows" && requestMethod === "POST") {
      requireRole(user, ROLES.superAdmin, ROLES.officeAdmin);
      const createdAt = now();
      const workflow = { ...workflowFrom(parseBody(event)), id: createId("WF"), createdAt };
      if (user.role === ROLES.officeAdmin) {
        if (workflow.office && workflow.office !== user.office) {
          throw new HttpError(403, "Office Administrators can only create approval workflows for their office.");
        }
        workflow.office = user.office;
      }
      await repo.transact([
        { Put: { TableName: TABLES.approvalWorkflows, Item: workflow, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Approval workflow created", workflow.name) } }
      ]);
      return json(201, workflow);
    }

    if (route === "workflow-item" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin, ROLES.officeAdmin);
      const existing = await repo.get(TABLES.approvalWorkflows, { id: event.pathParameters?.id });
      if (!existing) throw new HttpError(404, "Approval workflow not found.");
      if (user.role === ROLES.officeAdmin && existing.office !== user.office) {
        throw new HttpError(403, "Office Administrators can only edit approval workflows created for their office.");
      }
      const workflow = workflowFrom(parseBody(event), existing);
      if (workflow.status === "Archived") {
        const resources = await repo.scan(TABLES.resources);
        if (resources.some((item) => item.workflowTemplateId === workflow.id && item.status !== "Archived")) {
          throw new HttpError(409, "Assign affected resources to another workflow before archiving this one.");
        }
      }
      await repo.transact([
        { Put: { TableName: TABLES.approvalWorkflows, Item: workflow } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, workflow.status === "Archived" ? "Approval workflow archived" : "Approval workflow updated", workflow.name) } }
      ]);
      return json(200, workflow);
    }

    if (route === "settings" && requestMethod === "GET") {
      requireRole(user, ROLES.superAdmin);
      return json(200, { items: await repo.scan(TABLES.systemSettings) });
    }

    if (route === "settings" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin);
      const existing = await repo.get(TABLES.systemSettings, { id: "SYSTEM" }) || {};
      const settings = settingsFrom(parseBody(event), existing);
      await repo.transact([
        { Put: { TableName: TABLES.systemSettings, Item: settings } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, "System settings updated", `${settings.paymentDeadlineHours}h payment window`) } }
      ]);
      return json(200, settings);
    }

    if (route === "notifications" && requestMethod === "GET") {
      const items = await repo.query(TABLES.notifications, "user-index", "userEmail", user.email);
      return json(200, { items: newestFirst(items) });
    }

    if (route === "notification-read" && requestMethod === "PATCH") {
      requireRole(user, ROLES.requester);
      const items = await repo.query(TABLES.notifications, "user-index", "userEmail", user.email);
      const unread = items.filter((item) => item.unread);
      for (let index = 0; index < unread.length; index += 100) {
        await repo.transact(unread.slice(index, index + 100).map((item) => ({ Update: {
          TableName: TABLES.notifications,
          Key: { id: item.id },
          UpdateExpression: "SET unread = :false, updatedAt = :updatedAt",
          ConditionExpression: "userEmail = :email",
          ExpressionAttributeValues: { ":false": false, ":updatedAt": now(), ":email": user.email }
        } })));
      }
      return json(200, { updated: unread.length });
    }

    if (route === "activity" && requestMethod === "GET") {
      return json(200, { items: newestFirst(await listActivity(repo, user)) });
    }

    throw new HttpError(404, "Admin route not found.");
  });
}

export const handler = createHandler();
