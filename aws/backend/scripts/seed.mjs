import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { reservationSlots } from "../src/lib/slots.mjs";
import { buildApprovalSteps } from "../src/lib/workflows.mjs";

if (process.env.SEED_CONFIRM !== "reservata-dev") {
  throw new Error("Set SEED_CONFIRM=reservata-dev before loading sample data.");
}

const tables = {
  resources: process.env.RESOURCES_TABLE,
  reservations: process.env.RESERVATIONS_TABLE,
  reservationLocks: process.env.RESERVATION_LOCKS_TABLE,
  payments: process.env.PAYMENTS_TABLE,
  visitors: process.env.VISITORS_TABLE,
  users: process.env.USERS_TABLE,
  offices: process.env.OFFICES_TABLE,
  approvalWorkflows: process.env.APPROVAL_WORKFLOWS_TABLE,
  systemSettings: process.env.SYSTEM_SETTINGS_TABLE,
  notifications: process.env.NOTIFICATIONS_TABLE,
  activity: process.env.ACTIVITY_TABLE,
  drivers: process.env.DRIVERS_TABLE,
  reservationDrivers: process.env.RESERVATION_DRIVERS_TABLE,
  approvingBodies: process.env.APPROVING_BODIES_TABLE,
  approvals: process.env.APPROVALS_TABLE,
  reservationHistory: process.env.RESERVATION_HISTORY_TABLE
};
const missing = Object.entries(tables).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) throw new Error(`Missing table variables: ${missing.join(", ")}`);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(scriptDirectory, "../../../data/db.default.json");
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const timestamp = "2026-08-24T08:00:00.000Z";

const peopleByName = new Map(source.people.map((person) => [person.name, person]));
const reservationById = new Map(source.reservations.map((reservation) => [reservation.id, reservation]));

function emailFor(name) {
  return peopleByName.get(name)?.email || `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, ".")}@ust.edu.ph`;
}

const workflowById = new Map(source.approvalTemplates.map((item) => [item.id, item]));
const resourceById = new Map(source.resources.map((item) => [item.id, item]));
const reservations = source.reservations.map((item) => {
  const resource = resourceById.get(item.resourceId);
  const workflow = workflowById.get(resource?.workflowTemplateId || "WF-BASIC");
  const steps = buildApprovalSteps(workflow, resource, item.id);
  if (item.status !== "Pending") {
    steps.forEach((step) => {
      step.status = item.status === "Rejected" ? "Rejected" : "Approved";
      step.decidedBy = "Seed migration";
      step.decidedAt = timestamp;
    });
  }
  return {
    ...item,
    status: item.status === "Pending" ? "Under Owner Review" : item.status,
    requesterEmail: emailFor(item.requester),
    resourceDate: `${item.resourceId}#${item.date}`,
    workflowTemplateId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: 1,
    approvalSteps: steps,
    createdAt: timestamp,
    updatedAt: timestamp
  };
});
const payments = source.payments.map((item) => {
  const reservation = reservationById.get(item.reservationId);
  return { ...item, requesterEmail: emailFor(item.requester), office: reservation?.office, createdAt: timestamp, updatedAt: timestamp };
});
const visitors = source.visitors.map((item) => ({ ...item, requesterEmail: emailFor(item.requester), createdAt: timestamp, updatedAt: timestamp }));
const users = source.people.map((item) => ({ ...item, email: item.email.toLowerCase(), createdAt: timestamp, updatedAt: timestamp }));
const offices = source.offices.map((item) => ({ ...item, createdAt: timestamp, updatedAt: timestamp }));
const officeByName = new Map(offices.map((item) => [item.name, item]));
const drivers = source.drivers.map((item) => ({ ...item, createdAt: timestamp, updatedAt: timestamp }));
const approvingBodies = source.approvingBodies.map((item) => ({
  ...item,
  officeId: officeByName.get(item.office)?.id || "",
  createdAt: timestamp,
  updatedAt: timestamp
}));
const approvingBodyById = new Map(approvingBodies.map((item) => [item.id, item]));
function approvingBodyFor(office) {
  return approvingBodies.find((item) => item.office === office && item.status === "Active") || null;
}
const notifications = source.notifications.map((item) => ({ ...item, userEmail: emailFor(item.user), createdAt: timestamp }));
const activity = source.activity.map((item, index) => {
  const resource = source.resources.find((candidate) => candidate.name === item.target);
  return { ...item, id: `ACT-SEED-${index + 1}`, actorEmail: emailFor(item.actor), office: resource?.office || "OSG", createdAt: timestamp };
});
const locks = reservations
  .filter((item) => ["Approved", "Confirmed", "For Payment"].includes(item.status))
  .flatMap((item) => reservationSlots(item.resourceId, item.date, item.start, item.end).map((slotKey) => ({
    slotKey,
    reservationId: item.id,
    expiresAt: Math.floor(new Date(`${item.date}T23:59:59Z`).getTime() / 1000) + 86400
  })));

const reservationDrivers = reservations
  .filter((item) => {
    const resource = resourceById.get(item.resourceId);
    return resource?.driver === "With Driver" && item.status !== "Rejected";
  })
  .map((item, index) => {
    const resource = resourceById.get(item.resourceId);
    const driver = drivers.find((candidate) => candidate.office === resource.office);
    if (!driver) return null;
    return {
      id: `RD-SEED-${index + 1}`,
      reservationId: item.id,
      driverId: driver.id,
      driverName: driver.name,
      vehicleResourceId: resource.id,
      office: resource.office,
      status: "Assigned",
      assignedAt: timestamp,
      assignedBy: "Seed migration",
      assignedByEmail: "seed-migration@ust.edu.ph",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  })
  .filter(Boolean);

const approvals = reservations.flatMap((item) =>
  item.approvalSteps
    .filter((step) => ["Approved", "Rejected"].includes(step.status))
    .map((step, index) => {
      const workflow = workflowById.get(item.workflowTemplateId);
      const templateStep = workflow?.steps?.find((candidate) => candidate.id === step.templateStepId);
      const approvingBody = (templateStep?.approvingBodyId && approvingBodyById.get(templateStep.approvingBodyId)) || approvingBodyFor(step.office);
      return {
        id: `APR-SEED-${item.id}-${index + 1}`,
        reservationId: item.id,
        stepId: step.id,
        templateStepId: step.templateStepId,
        office: step.office,
        approvingBodyId: approvingBody?.id || "",
        approvingBodyName: approvingBody?.bodyName || step.office,
        approverEmail: "seed-migration@ust.edu.ph",
        approverName: "Seed migration",
        decision: step.status,
        remarks: "",
        sequence: step.sequence,
        decidedAt: timestamp,
        createdAt: timestamp
      };
    })
);

const reservationHistory = reservations.map((item, index) => ({
  id: `RH-SEED-${index + 1}`,
  reservationId: item.id,
  previousStatus: "Created",
  newStatus: item.status,
  changedBy: "Seed migration",
  changedByEmail: "seed-migration@ust.edu.ph",
  office: item.office,
  remarks: "",
  changedAt: timestamp,
  createdAt: timestamp
}));

const collections = {
  resources: source.resources.map((item) => ({ ...item, workflowTemplateId: item.workflowTemplateId || "WF-BASIC", createdAt: timestamp, updatedAt: timestamp })),
  reservations,
  reservationLocks: locks,
  payments,
  visitors,
  users,
  offices,
  approvalWorkflows: source.approvalTemplates.map((item) => ({ ...item, createdAt: timestamp, updatedAt: timestamp })),
  systemSettings: source.systemSettings.map((item) => ({ ...item, createdAt: timestamp, updatedAt: timestamp })),
  notifications,
  activity,
  drivers,
  reservationDrivers,
  approvingBodies,
  approvals,
  reservationHistory
};

for (const [name, items] of Object.entries(collections)) {
  for (let index = 0; index < items.length; index += 25) {
    await client.send(new BatchWriteCommand({
      RequestItems: {
        [tables[name]]: items.slice(index, index + 25).map((Item) => ({ PutRequest: { Item } }))
      }
    }));
  }
  console.log(`Seeded ${items.length} ${name} records.`);
}

console.log("Reservata sample data is ready.");
