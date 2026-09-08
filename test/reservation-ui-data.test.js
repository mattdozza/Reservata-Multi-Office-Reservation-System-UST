const assert = require("node:assert/strict");
const test = require("node:test");

test("reservation timeline includes linked events but excludes unrelated bookings of the same resource", async () => {
  const { reservationTimeline } = await import("../src/domain/reservations/timeline.js");
  const reservation = { id: "REQ-1", resourceName: "Hall", requester: "Requester", createdAt: "2026-01-01T08:00:00Z", paymentId: "PAY-1" };
  const events = reservationTimeline(reservation, [{ id: "PAY-1", reservationId: "REQ-1", uploadedAt: "2026-01-03T08:00:00Z", receipt: "proof.jpg" }], [
    { id: "linked", reservationId: "REQ-1", action: "Approved", time: "2026-01-02T08:00:00Z" },
    { id: "other", reservationId: "REQ-2", target: "Hall", action: "Rejected" },
    { id: "ambiguous", target: "Hall", action: "Cancelled" },
    { id: "legacy", target: "REQ-1", action: "Reviewed", time: "2026-01-02T09:00:00Z" }
  ]);
  assert.deepEqual(events.map((item) => item.title), ["Reservation submitted", "Approved", "Reviewed", "Receipt uploaded"]);
});

test("reservation drafts are account scoped and tolerate corrupt storage", async () => {
  const { readReservationDraft, reservationDraftKey } = await import("../src/domain/reservations/drafts.js");
  const values = new Map();
  global.localStorage = { getItem: (key) => values.get(key) || null };
  const key = reservationDraftKey(" Student@ust.edu.ph ");
  assert.equal(key, reservationDraftKey("student@ust.edu.ph"));
  values.set(key, JSON.stringify({ resourceId: "R-1", purpose: "Class activity", slot: { date: "2026-09-20", start: "08:00", end: "09:00", quantity: 2 } }));
  assert.equal(readReservationDraft(key).slot.quantity, "2");
  assert.equal(readReservationDraft(reservationDraftKey("other@ust.edu.ph")), null);
  values.set(key, "broken JSON");
  assert.equal(readReservationDraft(key), null);
  values.set(key, "{}");
  assert.equal(readReservationDraft(key), null);
  delete global.localStorage;
});
