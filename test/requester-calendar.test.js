const assert = require("node:assert/strict");
const test = require("node:test");

const calendarModule = () => import("../src/domain/reservations/requesterCalendar.js");

test("requester legend lists the three reservation events in order", async () => {
  const { REQUESTER_CALENDAR_LEGEND } = await calendarModule();
  assert.deepEqual(REQUESTER_CALENDAR_LEGEND, [
    { label: "Reservation confirmed", className: "confirmed" },
    { label: "Pick up equipment", className: "pickup" },
    { label: "Return equipment", className: "return" }
  ]);
});

test("month cells cover the full six-week grid with adjacent-month days", async () => {
  const { monthCells } = await calendarModule();
  const cells = monthCells("2026-07");
  assert.equal(cells.length, 42);
  assert.equal(cells[0].date, "2026-06-28");
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[3].date, "2026-07-01");
  assert.equal(cells[3].inMonth, true);
  assert.equal(cells[33].date, "2026-07-31");
  assert.equal(cells[34].date, "2026-08-01");
  assert.equal(cells[34].inMonth, false);
  assert.deepEqual(monthCells("2026-13"), []);
});

test("month navigation moves across year boundaries", async () => {
  const { shiftMonth } = await calendarModule();
  assert.equal(shiftMonth("2026-07", 1), "2026-08");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("only confirmed and later reservations appear on the calendar", async () => {
  const { requesterCalendarEvents } = await calendarModule();
  const events = requesterCalendarEvents([
    { id: "REQ-1", resourceName: "Projector Set A", type: "Equipment", date: "2026-09-20", status: "Under Owner Review" },
    { id: "REQ-2", resourceName: "Projector Set A", type: "Equipment", date: "2026-09-20", status: "For Payment" },
    { id: "REQ-3", resourceName: "Projector Set A", type: "Equipment", date: "2026-09-20", status: "Rejected" },
    { id: "REQ-4", resourceName: "Projector Set A", type: "Equipment", date: "2026-09-20", status: "Cancelled" }
  ]);
  assert.deepEqual(events, []);
});


test("equipment reservations use pickup events and flip to return events once completed", async () => {
  const { requesterCalendarEvents } = await calendarModule();
  const events = requesterCalendarEvents([
    { id: "REQ-1", resourceName: "Projector Set A", type: "Equipment", office: "EdTech", date: "2026-09-20", start: "09:00", end: "15:00", status: "Confirmed" },
    { id: "REQ-2", resourceName: "Camera Kit", type: "Equipment", office: "EdTech", date: "2026-09-21", start: "08:00", end: "12:00", status: "In Use" },
    { id: "REQ-3", resourceName: "Laptop Loaner", type: "Equipment", office: "CICS", date: "2026-09-22", start: "09:00", end: "17:00", status: "Completed" }
  ]);
  assert.deepEqual(events.map((item) => [item.date, item.tone, item.label, item.resourceName, item.time]), [
    ["2026-09-20", "pickup", "Pick up equipment", "Projector Set A", "09:00"],
    ["2026-09-21", "pickup", "Pick up equipment", "Camera Kit", "08:00"],
    ["2026-09-22", "return", "Return equipment", "Laptop Loaner", "17:00"]
  ]);
});

test("vehicle reservations use confirmed events with their time window", async () => {
  const { requesterCalendarEvents } = await calendarModule();
  const events = requesterCalendarEvents([
    { id: "REQ-1", resourceName: "Community Outreach Van", type: "Vehicle", office: "Simbahayan", date: "2026-09-22", start: "08:00", end: "10:00", status: "In Use" },
    { id: "REQ-2", resourceName: "Service Vehicle G4", type: "Vehicle", office: "Simbahayan", date: "2026-09-23", start: "07:00", end: "18:00", status: "Confirmed" }
  ]);
  assert.deepEqual(events.map((item) => [item.date, item.tone, item.label]), [
    ["2026-09-22", "confirmed", "Reservation confirmed"],
    ["2026-09-23", "confirmed", "Reservation confirmed"]
  ]);
  assert.equal(events[0].start, "08:00");
  assert.equal(events[0].office, "Simbahayan");
});

test("multi-day equipment loans add confirmed events between pickup and return", async () => {
  const { requesterCalendarEvents } = await calendarModule();
  const events = requesterCalendarEvents([
    { id: "REQ-1", resourceName: "Projector Set A", type: "Equipment", date: "2026-09-25", returnDate: "2026-09-27", start: "09:00", end: "12:00", status: "Confirmed" }
  ]);
  assert.deepEqual(events.map((item) => [item.date, item.tone]), [
    ["2026-09-25", "pickup"],
    ["2026-09-26", "confirmed"],
    ["2026-09-27", "return"]
  ]);
});

test("calendar events are grouped per date for the grid and details panel", async () => {
  const { eventsByDate, eventsForDate, requesterCalendarEvents } = await calendarModule();
  const events = requesterCalendarEvents([
    { id: "REQ-1", resourceName: "Projector Set A", type: "Equipment", date: "2026-09-22", start: "09:00", end: "15:00", status: "Confirmed" },
    { id: "REQ-2", resourceName: "Community Outreach Van", type: "Vehicle", date: "2026-09-22", start: "13:00", end: "16:00", status: "Confirmed" }
  ]);
  const index = eventsByDate(events);
  assert.deepEqual(eventsForDate(index, "2026-09-22").map((item) => item.resourceName), ["Projector Set A", "Community Outreach Van"]);
  assert.deepEqual(eventsForDate(index, "2026-09-23"), []);
  assert.deepEqual(events.map((item) => item.id), ["REQ-1-pickup-2026-09-22", "REQ-2-confirmed-2026-09-22"]);
});
