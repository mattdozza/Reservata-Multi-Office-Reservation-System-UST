import { tomorrowIso, todayIso } from "../../shared/utils.js";
import { addDaysIso, toMinutes } from "../../store/shared.js";

export function reservationErrors({ date, start, end, quantity, purpose }, resource) {
  const errors = {};
  if (!date || date < tomorrowIso()) errors.date = "Choose tomorrow or a later date.";
  if (resource && date > addDaysIso(todayIso(), resource.maxAdvanceDays || 30)) {
    errors.date = `Cannot book more than ${resource.maxAdvanceDays || 30} days in advance.`;
  }
  if (!start) errors.start = "Choose a start time.";
  if (!end || start >= end) errors.end = "End time must be after start time.";
  if (resource && start && end) {
    const durationMinutes = toMinutes(end) - toMinutes(start);
    const minMinutes = (resource.minBookingHours || 1) * 60;
    const maxMinutes = (resource.maxBookingHours || 4) * 60;
    if (durationMinutes < minMinutes) {
      errors.end = `Minimum booking duration is ${resource.minBookingHours || 1} hour(s).`;
    } else if (durationMinutes > maxMinutes) {
      errors.end = `Maximum booking duration is ${resource.maxBookingHours || 4} hour(s).`;
    }
  }
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) errors.quantity = "Enter a quantity greater than zero.";
  else if (resource && Number(quantity) > Number(resource.capacity)) errors.quantity = `Maximum capacity is ${resource.capacity}.`;
  if (String(purpose || "").trim().length < 10) errors.purpose = "Enter a purpose of at least 10 characters.";
  return errors;
}
