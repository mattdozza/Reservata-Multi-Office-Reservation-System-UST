import { authenticatedUser, requireRole, ROLES } from "../lib/auth.mjs";
import { HttpError, json, method, parseBody, requireFields, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { activityRecord, createId, newestFirst, now } from "../lib/records.mjs";
import { TABLES } from "../lib/tables.mjs";

async function listVisitors(repo, user) {
  if (user.role === ROLES.osgRequester) return repo.query(TABLES.visitors, "requester-index", "requesterEmail", user.email);
  if ([ROLES.osgAdmin, ROLES.superAdmin].includes(user.role)) return repo.scan(TABLES.visitors);
  throw new HttpError(403, "Your role cannot access visitor requests.");
}

function routeName(event) {
  const path = event.rawPath || event.path || "";
  if (path.endsWith("/decision")) return "decision";
  if (path.endsWith("/check-in")) return "check-in";
  if (path.endsWith("/parking")) return "parking";
  return "collection";
}

export function createHandler(repo = repository) {
  return wrap(async (event) => {
    const user = await authenticatedUser(event, repo);
    const requestMethod = method(event);

    if (requestMethod === "GET") return json(200, { items: newestFirst(await listVisitors(repo, user)) });

    if (requestMethod === "POST") {
      requireRole(user, ROLES.osgRequester);
      const body = parseBody(event);
      requireFields(body, ["visitor", "organization", "purpose", "date", "time", "guests"]);
      const createdAt = now();
      const visitor = {
        id: createId("VIS"),
        requester: user.name,
        requesterEmail: user.email,
        visitor: String(body.visitor).trim(),
        organization: String(body.organization).trim(),
        purpose: String(body.purpose).trim(),
        date: body.date,
        time: body.time,
        guests: Number(body.guests),
        cars: Number(body.cars || 0),
        plate: String(body.plate || "").trim(),
        parking: "",
        status: "Pending",
        createdAt,
        updatedAt: createdAt
      };
      const activity = activityRecord(user, "Visitor request submitted", visitor.visitor, "OSG");
      await repo.transact([
        { Put: { TableName: TABLES.visitors, Item: visitor, ConditionExpression: "attribute_not_exists(id)" } },
        { Put: { TableName: TABLES.activity, Item: activity } }
      ]);
      return json(201, visitor);
    }

    if (requestMethod === "PATCH") {
      requireRole(user, ROLES.osgAdmin);
      const visitor = await repo.get(TABLES.visitors, { id: event.pathParameters?.id });
      if (!visitor) throw new HttpError(404, "Visitor request not found.");
      const body = parseBody(event);
      const route = routeName(event);
      const updatedAt = now();
      let changes;
      let action;
      let condition;
      let conditionValues;

      if (route === "decision") {
        if (typeof body.approved !== "boolean") throw new HttpError(400, "approved must be true or false.");
        changes = { status: body.approved ? "Approved" : "Rejected", updatedAt };
        action = body.approved ? "Visitor request approved" : "Visitor request declined";
        condition = "#status = :pending";
        conditionValues = { ":pending": "Pending" };
      } else if (route === "check-in") {
        changes = { status: "Arrived", arrivedAt: updatedAt, updatedAt };
        action = "Visitor arrival recorded";
        condition = "#status = :approved";
        conditionValues = { ":approved": "Approved" };
      } else if (route === "parking") {
        requireFields(body, ["bay"]);
        if (!/^[A-D][1-5]$/.test(body.bay)) throw new HttpError(400, "Parking bay must be A1 through D5.");
        const visitors = await repo.scan(TABLES.visitors);
        if (visitors.some((item) => item.id !== visitor.id && item.parking === body.bay && item.status !== "Rejected")) {
          throw new HttpError(409, "That parking bay is already allocated.");
        }
        changes = { parking: body.bay, updatedAt };
        action = "Parking allocated";
        condition = "#status = :approved";
        conditionValues = { ":approved": "Approved" };
      } else {
        throw new HttpError(404, "Visitor action not found.");
      }

      const names = { "#status": "status" };
      const valueEntries = Object.entries(changes);
      const updateParts = valueEntries.map(([name], index) => {
        names[`#change${index}`] = name;
        return `#change${index} = :change${index}`;
      });
      const values = Object.fromEntries(valueEntries.map(([, value], index) => [`:change${index}`, value]));
      const activity = activityRecord(user, action, route === "parking" ? `${visitor.visitor}: ${body.bay}` : visitor.visitor, "OSG");
      await repo.transact([
        { Update: {
          TableName: TABLES.visitors,
          Key: { id: visitor.id },
          UpdateExpression: `SET ${updateParts.join(", ")}`,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: { ...values, ...conditionValues }
        } },
        { Put: { TableName: TABLES.activity, Item: activity } }
      ]);
      return json(200, { ...visitor, ...changes });
    }

    throw new HttpError(405, "Method not allowed.");
  });
}

export const handler = createHandler();
