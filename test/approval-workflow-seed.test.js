const assert = require("node:assert/strict");
const test = require("node:test");
const database = require("../data/db.default.json");

function templateFor(resource) {
  return database.approvalTemplates.find((item) => item.id === resource.workflowTemplateId);
}

test("the seeded event workflow routes vehicles through the multi-office route", async () => {
  const { buildApprovalSteps } = await import("../src/domain/workflows.js");
  const resource = database.resources.find((item) => item.id === "R-005");
  assert.ok(resource, "the Community Outreach Van is seeded");
  assert.equal(resource.workflowTemplateId, "WF-EVENT");

  const workflow = templateFor(resource);
  assert.ok(workflow, "the event workflow template is seeded");
  assert.equal(workflow.status, "Active");

  const full = buildApprovalSteps(workflow, resource, "REQ-PREVIEW");
  assert.deepEqual(full.map((step) => step.name), [
    "Resource Owner Review",
    "Facilities Setup",
    "OSG Event Review",
    "Visitor Parking Review"
  ]);
  assert.deepEqual(full.map((step) => step.sequence), [1, 2, 2, 2]);
  assert.deepEqual(full.map((step) => step.status), ["Pending", "Waiting", "Waiting", "Waiting"]);
  assert.deepEqual(full.slice(1).map((step) => step.office), ["Facilities Management", "OSG", "OSG"]);
});

test("only the seeded event resources use the multi-office workflow", () => {
  const eventResources = database.resources.filter((item) => item.workflowTemplateId === "WF-EVENT");
  assert.deepEqual(eventResources.map((item) => item.id).sort(), ["R-005", "R-006"]);

  const equipment = database.resources.filter((item) => item.type === "Equipment");
  assert.ok(equipment.length > 0);
  // Equipment keeps the fallback basic route (the seed/store default a missing id to WF-BASIC).
  assert.ok(equipment.every((item) => !item.workflowTemplateId || item.workflowTemplateId === "WF-BASIC"));
});
