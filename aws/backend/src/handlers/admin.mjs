import { authenticatedUser, requireRole, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, createId, newestFirst, now } from "../lib/records.mjs";
import { TABLES } from "../lib/tables.mjs";

const ALLOWED_ROLES = new Set(Object.values(ROLES));

function routeName(event) {
  const path = event.rawPath || event.path || "";
  if (path === "/users") return "users";
  if (path.includes("/users/") && path.endsWith("/role")) return "user-role";
  if (path.includes("/users/") && path.endsWith("/access")) return "user-access";
  if (path === "/offices") return "offices";
  if (path.includes("/offices/")) return "office-item";
  if (path === "/workflows") return "workflows";
  if (path.includes("/workflows/")) return "workflow-item";
  if (path === "/notifications") return "notifications";
  if (path.endsWith("/notifications/read")) return "notification-read";
  if (path === "/activity") return "activity";
  return "unknown";
}

function workflowFrom(body, existing = {}) {
  const steps = (body.steps || existing.steps || []).map((step, index) => ({
    id: step.id || `STEP-${index + 1}`,
    name: String(step.name || "").trim(),
    office: step.office,
    sequence: Number(step.sequence || 1),
    condition: step.condition || "always"
  }));
  if (!String(body.name || existing.name || "").trim() || !steps.some((step) => step.office === "$OWNER" && step.sequence === 1)) {
    throw new HttpError(400, "A workflow needs a name and a sequence-one Resource Owner step.");
  }
  return {
    ...existing,
    name: String(body.name || existing.name).trim(),
    resourceType: body.resourceType || existing.resourceType || "All",
    status: body.status || existing.status || "Active",
    steps,
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
  const offices = await repo.scan(TABLES.offices);
  const validOffice = office === "All Offices" || offices.some((item) => item.name === office && item.status === "Active");
  if (!validOffice) throw new HttpError(400, "Assign the user to an active office.");
  return { email, name, office, role, status };
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
      const updatedAt = now();
      const activity = activityRecord(user, "User role updated", target.name, target.office);
      await repo.transact([
        { Update: {
          TableName: TABLES.users,
          Key: { email },
          UpdateExpression: "SET #role = :role, updatedAt = :updatedAt",
          ExpressionAttributeNames: { "#role": "role" },
          ExpressionAttributeValues: { ":role": body.role, ":updatedAt": updatedAt }
        } },
        { Put: { TableName: TABLES.activity, Item: activity } }
      ]);
      return json(200, { ...target, role: body.role, updatedAt });
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
      if (resources.length + users.length > 90) throw new HttpError(409, "This office has too many assignments for an atomic rename. Transfer them in batches first.");
      const transaction = [
        { Update: { TableName: TABLES.offices, Key: { id: office.id }, UpdateExpression: "SET #name = :name, #status = :status, updatedAt = :updatedAt", ExpressionAttributeNames: { "#name": "name", "#status": "status" }, ExpressionAttributeValues: { ":name": name, ":status": status, ":updatedAt": updatedAt } } },
        ...resources.map((item) => ({ Update: { TableName: TABLES.resources, Key: { id: item.id }, UpdateExpression: "SET office = :name, updatedAt = :updatedAt", ExpressionAttributeValues: { ":name": name, ":updatedAt": updatedAt } } })),
        ...users.map((item) => ({ Update: { TableName: TABLES.users, Key: { email: item.email }, UpdateExpression: "SET office = :name, updatedAt = :updatedAt", ExpressionAttributeValues: { ":name": name, ":updatedAt": updatedAt } } })),
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, status === "Inactive" ? "Office archived" : "Office updated", name, name) } }
      ];
      await repo.transact(transaction);
      return json(200, { ...office, name, status, updatedAt });
    }

    if (route === "workflows" && requestMethod === "GET") {
      requireRole(user, ROLES.superAdmin);
      return json(200, { items: await repo.scan(TABLES.approvalWorkflows) });
    }

    if (route === "workflows" && requestMethod === "POST") {
      requireRole(user, ROLES.superAdmin);
      const createdAt = now();
      const workflow = { ...workflowFrom(parseBody(event)), id: createId("WF"), createdAt };
      await repo.transact([
        { Put: { TableName: TABLES.approvalWorkflows, Item: workflow, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.activity, Item: activityRecord(user, "Approval workflow created", workflow.name) } }
      ]);
      return json(201, workflow);
    }

    if (route === "workflow-item" && requestMethod === "PATCH") {
      requireRole(user, ROLES.superAdmin);
      const existing = await repo.get(TABLES.approvalWorkflows, { id: event.pathParameters?.id });
      if (!existing) throw new HttpError(404, "Approval workflow not found.");
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

    if (route === "notifications" && requestMethod === "GET") {
      const items = await repo.query(TABLES.notifications, "user-index", "userEmail", user.email);
      return json(200, { items: newestFirst(items) });
    }

    if (route === "notification-read" && requestMethod === "PATCH") {
      requireRole(user, ROLES.requester, ROLES.osgRequester);
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
