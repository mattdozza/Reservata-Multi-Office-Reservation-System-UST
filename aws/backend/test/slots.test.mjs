import test from "node:test";
import assert from "node:assert/strict";
import { reservationSlots } from "../src/lib/slots.mjs";

test("creates 15-minute lock keys for a reservation", () => {
  assert.deepEqual(reservationSlots("R-1", "2026-09-01", "09:00", "10:00"), [
    "R-1#2026-09-01#09:00",
    "R-1#2026-09-01#09:15",
    "R-1#2026-09-01#09:30",
    "R-1#2026-09-01#09:45"
  ]);
});

test("rounds a start time down to the occupied slot", () => {
  assert.equal(reservationSlots("R-1", "2026-09-01", "09:10", "09:20").length, 2);
});

test("rejects invalid and excessive time ranges", () => {
  assert.throws(() => reservationSlots("R-1", "2026-09-01", "10:00", "09:00"), /later/);
  assert.throws(() => reservationSlots("R-1", "2026-09-01", "00:00", "13:00"), /12 hours/);
});
