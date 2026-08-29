import { HttpError } from "./http.mjs";

function toMinutes(value) {
  const [hours, minutes] = String(value).split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) throw new HttpError(400, "Time values must use HH:MM format.");
  return hours * 60 + minutes;
}

function fromMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function reservationSlots(resourceId, date, start, end) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes >= endMinutes) throw new HttpError(400, "End time must be later than start time.");
  if (endMinutes - startMinutes > 12 * 60) throw new HttpError(400, "Reservations may not exceed 12 hours.");

  const firstSlot = Math.floor(startMinutes / 15) * 15;
  const slots = [];
  for (let minute = firstSlot; minute < endMinutes; minute += 15) {
    slots.push(`${resourceId}#${date}#${fromMinutes(minute)}`);
  }
  return slots;
}

export function lockExpiry(date) {
  return Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000) + 86400;
}
