import { authenticatedUser, ROLES } from "../lib/auth.mjs";
import { json, wrap } from "../lib/http.mjs";
import { repository } from "../lib/repository.mjs";
import { newestFirst } from "../lib/records.mjs";
import { expireReservations } from "../lib/reservationLifecycle.mjs";
import { TABLES } from "../lib/tables.mjs";

async function ownActivity(repo, user) {
  const items = await repo.scan(TABLES.activity);
  return items.filter((item) => item.actorEmail === user.email);
}

export function createHandler(repo = repository) {
  return wrap(async (event) => {
    const user = await authenticatedUser(event, repo);
    const data = {
      resources: [],
      reservations: [],
      payments: [],
      visitors: [],
      people: [user],
      offices: [],
      approvalTemplates: [],
      systemSettings: [],
      notifications: [],
      activity: []
    };

    if (user.role === ROLES.superAdmin) {
      [data.resources, data.reservations, data.payments, data.visitors, data.people, data.offices, data.approvalTemplates, data.systemSettings, data.notifications, data.activity] = await Promise.all([
        repo.scan(TABLES.resources), repo.scan(TABLES.reservations), repo.scan(TABLES.payments), repo.scan(TABLES.visitors),
        repo.scan(TABLES.users), repo.scan(TABLES.offices), repo.scan(TABLES.approvalWorkflows), repo.scan(TABLES.systemSettings), repo.scan(TABLES.notifications), repo.scan(TABLES.activity)
      ]);
    } else if (user.role === ROLES.officeAdmin) {
      [data.resources, data.reservations, data.payments, data.offices, data.approvalTemplates, data.systemSettings, data.activity] = await Promise.all([
        repo.query(TABLES.resources, "office-index", "office", user.office),
        repo.scan(TABLES.reservations),
        repo.query(TABLES.payments, "office-index", "office", user.office),
        repo.scan(TABLES.offices),
        repo.scan(TABLES.approvalWorkflows),
        repo.scan(TABLES.systemSettings),
        repo.query(TABLES.activity, "office-index", "office", user.office)
      ]);
      data.reservations = data.reservations.filter((item) => item.office === user.office || item.approvalSteps?.some((step) => step.office === user.office));
      data.approvalTemplates = data.approvalTemplates.filter((item) => item.status === "Active");
    } else if (user.role === ROLES.requester) {
      [data.resources, data.reservations, data.payments, data.approvalTemplates, data.systemSettings, data.notifications, data.activity] = await Promise.all([
        repo.scan(TABLES.resources),
        repo.query(TABLES.reservations, "requester-index", "requesterEmail", user.email),
        repo.query(TABLES.payments, "requester-index", "requesterEmail", user.email),
        repo.scan(TABLES.approvalWorkflows),
        repo.scan(TABLES.systemSettings),
        repo.query(TABLES.notifications, "user-index", "userEmail", user.email),
        ownActivity(repo, user)
      ]);
      data.resources = data.resources.filter((item) => item.status !== "Archived" && item.type !== "Visitor Service");
      data.approvalTemplates = data.approvalTemplates.filter((item) => item.status === "Active");
    } else if (user.role === ROLES.osgAdmin) {
      [data.reservations, data.visitors, data.activity] = await Promise.all([
        repo.scan(TABLES.reservations),
        repo.scan(TABLES.visitors),
        repo.query(TABLES.activity, "office-index", "office", "OSG")
      ]);
      data.reservations = data.reservations.filter((item) => item.approvalSteps?.some((step) => step.office === "OSG"));
    } else if (user.role === ROLES.osgRequester) {
      [data.visitors, data.notifications, data.activity] = await Promise.all([
        repo.query(TABLES.visitors, "requester-index", "requesterEmail", user.email),
        repo.query(TABLES.notifications, "user-index", "userEmail", user.email),
        ownActivity(repo, user)
      ]);
    }

    await expireReservations(repo, data.reservations, data.payments, data.resources, data.systemSettings[0]);
    if (user.role !== ROLES.superAdmin && data.reservations.length) {
      const ids = new Set(data.reservations.map((item) => item.id));
      const linked = (await repo.scan(TABLES.activity)).filter((item) => ids.has(item.reservationId));
      data.activity = [...new Map([...data.activity, ...linked].map((item) => [item.id, item])).values()];
    }

    for (const key of ["reservations", "payments", "visitors", "notifications", "activity"]) {
      data[key] = newestFirst(data[key]);
    }
    return json(200, { user, data });
  });
}

export const handler = createHandler();
