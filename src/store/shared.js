import { todayIso, tomorrowIso } from "../utils.js";
import { REQUIREMENT_OPTIONS } from "../workflows.js";

export const BLOCKING_RESERVATION_STATUSES = ["Under Owner Review", "Under Additional Review", "Approved", "Confirmed", "For Payment"];
export const RESOLVED_RESERVATION_STATUSES = ["Confirmed", "Rejected", "Cancelled", "Completed"];
export const MAX_RECEIPT_PREVIEW_BYTES = 700_000;
export const BUSINESS_DAY_START = 8 * 60;
export const BUSINESS_DAY_END = 17 * 60;
export const DEFAULT_SLOT_MINUTES = 60;

export function cleanText(value) {
  return String(value || "").trim();
}

export function requireText(value, label, minimum = 1) {
  const text = cleanText(value);
  if (text.length < minimum) {
    throw new Error(minimum > 1 ? `${label} must be at least ${minimum} characters.` : `${label} is required.`);
  }
  return text;
}

export function requireFutureDate(value, label) {
  const date = cleanText(value);
  if (!date) throw new Error(`${label} is required.`);
  if (date < todayIso()) throw new Error(`${label} cannot be in the past.`);
  return date;
}

export function requireReservationLeadDate(value) {
  const date = requireFutureDate(value, "Reservation date");
  if (date < tomorrowIso()) throw new Error("Reservations must be submitted at least one day before the time of use.");
  return date;
}

export function validPositiveNumber(value, label, minimum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) throw new Error(`${label} must be at least ${minimum}.`);
  return number;
}

export function toMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

export function fromMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function selectedDuration(start, end) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return DEFAULT_SLOT_MINUTES;
  return Math.min(endMinutes - startMinutes, 12 * 60);
}

export function addDaysIso(date, days) {
  const value = date || tomorrowIso();
  const next = new Date(`${value}T00:00:00`);
  next.setDate(next.getDate() + days);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 10);
}

export function isUstSsoEmail(email) {
  return /^[^\s@]+@ust\.edu\.ph$/i.test(email);
}

export function defaultRequirementOptions() {
  return REQUIREMENT_OPTIONS.map((option) => ({ ...option, status: "Active", locked: true }));
}

export function notificationWithOffice(notification, offices) {
  if (notification.office) return notification;
  const message = String(notification.message || "");
  const office = offices.find((item) =>
    message.includes(item.name) && /(routed to|needs review|verification|uploaded a receipt)/i.test(message)
  );
  return office ? { ...notification, office: office.name } : notification;
}

export function uniqueNotifications(notifications, offices) {
  const seen = new Set();
  return notifications.map((notification, index) => {
    const item = notificationWithOffice(notification, offices);
    const base = item.id || `N-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    return id === item.id ? item : { ...item, id };
  });
}
