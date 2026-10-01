import { todayIso, tomorrowIso } from "../shared/utils.js";
import { REQUIREMENT_OPTIONS } from "../domain/workflows.js";

export const BLOCKING_RESERVATION_STATUSES = ["Under Owner Review", "Under Additional Review", "Approved", "Confirmed", "For Payment", "In Use"];
export const RESOLVED_RESERVATION_STATUSES = ["Rejected", "Cancelled", "Completed", "Expired", "No Show"];
export const ACTIVE_PAYMENT_STATUSES = ["Awaiting Receipt", "Pending Verification"];
export const CLOSED_PAYMENT_STATUSES = ["Verified", "Rejected", "Cancelled", "Expired"];
export const DEFAULT_PAYMENT_DEADLINE_HOURS = 24;
export const MIN_PAYMENT_DEADLINE_HOURS = 1;
export const MAX_PAYMENT_DEADLINE_HOURS = 168;
export const MAX_RECEIPT_PREVIEW_BYTES = 700_000;
export const BUSINESS_DAY_START = 8 * 60;
export const BUSINESS_DAY_END = 17 * 60;
export const DEFAULT_SLOT_MINUTES = 60;
export const OFFICE_RESOURCE_TYPES = {
  EdTech: ["Equipment"],
  Simbahayan: ["Vehicle"],
  "Dominican Residence": ["Vehicle"],
  OSG: ["Visitor Service"]
};

export function allowedResourceTypes(office) {
  return OFFICE_RESOURCE_TYPES[office] || null;
}

export function cleanText(value) {
  return String(value || "").trim();
}

export function normalizeAssetTag(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function assetTagPrefix(office, type) {
  const officeWords = cleanText(office).toUpperCase().match(/[A-Z0-9]+/g) || ["OFFICE"];
  const officeCode = officeWords.length > 1
    ? officeWords.map((word) => word.slice(0, 3)).join("").slice(0, 8)
    : officeWords[0].slice(0, 6);
  const typeCodes = {
    Vehicle: "VEH",
    Equipment: "EQP",
    "Visitor Service": "VIS"
  };
  return `${officeCode || "OFFICE"}-${typeCodes[type] || "RES"}`;
}

export function generateAssetTag(resources = [], office = "", type = "Equipment", excludeId = "") {
  const prefix = assetTagPrefix(office, type);
  const numbers = resources
    .filter((resource) => resource.id !== excludeId)
    .map((resource) => normalizeAssetTag(resource.assetTag || ""))
    .filter((assetTag) => assetTag.startsWith(`${prefix}-`))
    .map((assetTag) => Number(assetTag.slice(prefix.length + 1)))
    .filter(Number.isInteger);
  let nextNumber = Math.max(0, ...numbers) + 1;
  let candidate = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  const used = new Set(resources.filter((resource) => resource.id !== excludeId).map((resource) => normalizeAssetTag(resource.assetTag || "")));
  while (used.has(candidate)) {
    nextNumber += 1;
    candidate = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
  }
  return candidate;
}

export function normalizeResourceTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source
    .map((item) => cleanText(item))
    .filter(Boolean)
    .map((item) => item.slice(0, 32)))].slice(0, 8);
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

export function normalizePaymentDeadlineHours(value, fallback = DEFAULT_PAYMENT_DEADLINE_HOURS) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= MIN_PAYMENT_DEADLINE_HOURS && number <= MAX_PAYMENT_DEADLINE_HOURS) {
    return number;
  }
  return fallback;
}

export function requirePaymentDeadlineHours(value, label = "Payment deadline") {
  const number = Number(value);
  if (!Number.isInteger(number) || number < MIN_PAYMENT_DEADLINE_HOURS || number > MAX_PAYMENT_DEADLINE_HOURS) {
    throw new Error(`${label} must be a whole number from ${MIN_PAYMENT_DEADLINE_HOURS} to ${MAX_PAYMENT_DEADLINE_HOURS} hours.`);
  }
  return number;
}

export function effectivePaymentDeadlineHours(resource, settings = {}) {
  return normalizePaymentDeadlineHours(
    resource?.paymentDeadlineHours,
    normalizePaymentDeadlineHours(settings?.paymentDeadlineHours)
  );
}

export function toMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

export function fromMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function resourceOperatingWindow(resource) {
  const openMinutes = toMinutes(resource?.openTime);
  const closeMinutes = toMinutes(resource?.closeTime);
  const start = openMinutes === null ? BUSINESS_DAY_START : openMinutes;
  const end = closeMinutes === null || closeMinutes <= start ? BUSINESS_DAY_END : closeMinutes;
  return { start, end };
}

export function resourceBlockedDate(resource, date) {
  return (resource?.blockedDates || []).find((item) => item.date === date) || null;
}

export function normalizeBlockedDates(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  return source
    .map((item) => ({ date: cleanText(item?.date), reason: cleanText(item?.reason).slice(0, 140) }))
    .filter((item) => item.date && !seen.has(item.date) && seen.add(item.date))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 200);
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
