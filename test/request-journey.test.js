const assert = require("node:assert/strict");
const test = require("node:test");

const TEMPLATE = {
  id: "WF-EVENT",
  steps: [
    { id: "OWNER", name: "Resource Owner Review", office: "$OWNER", sequence: 1 },
    { id: "FAC", name: "Facilities Setup", office: "Facilities Management", sequence: 2 },
    { id: "OSG", name: "OSG Event Review", office: "OSG", sequence: 2 }
  ]
};

async function loadJourney() {
  const { buildApprovalSteps } = await import("../src/domain/workflows.js");
  const { effectivePaymentDeadlineHours } = await import("../src/store/shared.js");
  return (resource) => {
    const steps = buildApprovalSteps(TEMPLATE, resource, "REQ-PREVIEW");
    const stages = [{ title: "Submit request", owner: "You" }];
    for (const step of steps) stages.push({ title: step.name, owner: step.office });
    if (resource.requiresPayment) {
      stages.push({ title: "Upload payment receipt", owner: "You" });
      stages.push({ title: "Payment verification", owner: resource.office });
    }
    stages.push({ title: "Reservation confirmed", owner: "You" });
    return { stages, deadlineHours: effectivePaymentDeadlineHours(resource, {}) };
  };
}

test("paid resources show the receipt upload and admin verification stages", async () => {
  const journey = await loadJourney();
  const paid = { id: "R-1", name: "Robot 01", office: "EdTech", requiresPayment: true, fee: 500, paymentDeadlineHours: 6 };

  const { stages, deadlineHours } = journey(paid);
  assert.deepEqual(stages.map((stage) => stage.title), [
    "Submit request",
    "Resource Owner Review",
    "Facilities Setup",
    "OSG Event Review",
    "Upload payment receipt",
    "Payment verification",
    "Reservation confirmed"
  ]);
  // The verifying office owns the payment, not the requester.
  assert.equal(stages[5].owner, "EdTech");
  assert.equal(deadlineHours, 6);
});

test("the journey includes every office in the configured route", async () => {
  const journey = await loadJourney();
  const paid = { id: "R-1", name: "Robot 01", office: "EdTech", requiresPayment: true, fee: 500, paymentDeadlineHours: 6 };
  const { stages } = journey(paid);
  const titles = stages.map((stage) => stage.title);

  assert.ok(stages.some((stage) => stage.title === "Facilities Setup" && stage.owner === "Facilities Management"));
  assert.ok(stages.some((stage) => stage.title === "OSG Event Review" && stage.owner === "OSG"));
  // Payment stages must always follow every approval step.
  assert.ok(titles.indexOf("Upload payment receipt") > titles.lastIndexOf("OSG Event Review"));
  assert.equal(titles[titles.length - 1], "Reservation confirmed");
});

test("free resources skip the payment stages entirely", async () => {
  const journey = await loadJourney();
  const free = { id: "R-2", name: "Projector", office: "EdTech", requiresPayment: false };
  const { stages } = journey(free);
  assert.deepEqual(stages.map((stage) => stage.title), [
    "Submit request",
    "Resource Owner Review",
    "Facilities Setup",
    "OSG Event Review",
    "Reservation confirmed"
  ]);
  assert.ok(!stages.some((stage) => /payment|receipt/i.test(stage.title)));
});
