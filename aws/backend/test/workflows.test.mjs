import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovalSteps, canDecideStep, decideApprovalStep } from "../src/lib/workflows.mjs";

test("Lambda workflow engine activates parallel supporting offices", () => {
  const reservation = {
    requiresPayment: true,
    status: "Under Owner Review",
    approvalSteps: buildApprovalSteps({ steps: [
      { id: "OWNER", name: "Owner", office: "$OWNER", sequence: 1, condition: "always" },
      { id: "FAC", name: "Facilities", office: "Facilities Management", sequence: 2, condition: "setupRequired" },
      { id: "OSG", name: "OSG", office: "OSG", sequence: 2, condition: "externalVisitors" }
    ] }, { office: "Simbahayan" }, { setupRequired: true, externalVisitors: true }, "REQ-1")
  };
  const owner = decideApprovalStep(reservation, "REQ-1-OWNER", true, "Owner Admin", "now");
  reservation.approvalSteps = owner.steps;
  reservation.status = owner.status;
  assert.equal(owner.status, "Under Additional Review");
  assert.deepEqual(owner.steps.map((step) => step.status), ["Approved", "Pending", "Pending"]);
  assert.equal(canDecideStep({ role: "Office Admin", office: "Facilities Management" }, owner.steps[1]), true);
  assert.equal(canDecideStep({ role: "OSG Admin", office: "OSG" }, owner.steps[2]), true);
});
