export const REQUESTER_CALENDAR_LEGEND = [
  { label: "Reservation confirmed", className: "confirmed" },
  { label: "Pick up equipment", className: "pickup" },
  { label: "Return equipment", className: "return" }
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const EVENT_TONES = ["confirmed", "pickup", "return"];
const EVENT_STATUSES = ["Confirmed", "In Use", "Completed"];
const TONE_LABELS = {
  confirmed: "Reservation confirmed",
  pickup: "Pick up equipment",
  return: "Return equipment"
};

function localIso(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function nextDayIso(date) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + 1);
  return localIso(value);
}

export function monthCells(month) {
  const [year, monthNumber] = String(month || "").split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return [];
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, monthNumber - 1, index - firstWeekday + 1);
    return {
      key: localIso(date),
      date: localIso(date),
      day: date.getDate(),
      inMonth: date.getMonth() === monthNumber - 1
    };
  });
}

export function shiftMonth(month, offset) {
  const [year, monthNumber] = String(month || "").split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return localIso(date).slice(0, 7);
}

function calendarEvent(reservation, tone, date) {
  return {
    id: `${reservation.id}-${tone}-${date}`,
    date,
    tone,
    label: TONE_LABELS[tone],
    reservationId: reservation.id,
    resourceName: reservation.resourceName || "Reservation",
    type: reservation.type || "",
    office: reservation.office || "",
    status: reservation.status,
    start: reservation.start || "",
    end: reservation.end || "",
    time: tone === "return" ? reservation.end || "" : reservation.start || ""
  };
}

function reservationEvents(reservation) {
  if (!EVENT_STATUSES.includes(reservation?.status) || !reservation?.date) return [];
  const pickupDate = reservation.date;
  // RESERVATA reserves a single date, so equipment is picked up and returned on that date.
  // A multi-day return field keeps the same shape if loans ever span several days.
  const rawReturnDate = reservation.returnDate || reservation.endDate || pickupDate;
  const returnDate = rawReturnDate < pickupDate ? pickupDate : rawReturnDate;
  if (reservation.type !== "Equipment") return [calendarEvent(reservation, "confirmed", pickupDate)];
  if (pickupDate === returnDate) {
    return [calendarEvent(reservation, reservation.status === "Completed" ? "return" : "pickup", pickupDate)];
  }
  const events = [calendarEvent(reservation, "pickup", pickupDate), calendarEvent(reservation, "return", returnDate)];
  for (let date = nextDayIso(pickupDate); date < returnDate; date = nextDayIso(date)) {
    events.push(calendarEvent(reservation, "confirmed", date));
  }
  return events;
}

export function requesterCalendarEvents(reservations = []) {
  return reservations
    .flatMap(reservationEvents)
    .sort((left, right) => left.date.localeCompare(right.date)
      || String(left.start || "").localeCompare(String(right.start || ""))
      || EVENT_TONES.indexOf(left.tone) - EVENT_TONES.indexOf(right.tone)
      || String(left.resourceName).localeCompare(String(right.resourceName), undefined, { sensitivity: "base" }));
}

export function eventsByDate(events = []) {
  const index = new Map();
  for (const event of events) {
    const held = index.get(event.date);
    if (held) held.push(event);
    else index.set(event.date, [event]);
  }
  return index;
}

export function eventsForDate(index, date) {
  return index?.get(date) || [];
}
