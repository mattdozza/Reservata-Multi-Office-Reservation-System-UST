import { tomorrowIso } from "../../shared/utils.js";

export function reservationErrors({ date, start, end, quantity, purpose }, resource) {
  const errors = {};
  if (!date || date < tomorrowIso()) errors.date = "Choose tomorrow or a later date.";
  if (!start) errors.start = "Choose a start time.";
  if (!end || start >= end) errors.end = "End time must be after start time.";
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) errors.quantity = "Enter a quantity greater than zero.";
  else if (resource && Number(quantity) > Number(resource.capacity)) errors.quantity = `Maximum capacity is ${resource.capacity}.`;
  if (String(purpose || "").trim().length < 10) errors.purpose = "Enter a purpose of at least 10 characters.";
  return errors;
}
