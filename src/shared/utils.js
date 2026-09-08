export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function badgeClass(value) {
  return String(value).toLowerCase().replace(/\s+/g, "-");
}

export function formatDate(value) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function todayIso() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function compareDateTime(leftDate, leftTime, rightDate, rightTime) {
  return new Date(`${leftDate}T${leftTime || "00:00"}`).getTime() - new Date(`${rightDate}T${rightTime || "00:00"}`).getTime();
}

export function sortBy(items, field, direction = "asc") {
  const sign = direction === "desc" ? -1 : 1;
  return [...items].sort((left, right) => String(left[field] ?? "").localeCompare(String(right[field] ?? ""), undefined, {
    numeric: true,
    sensitivity: "base"
  }) * sign);
}

export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function nextId(prefix) {
  const entropy = crypto.randomUUID().split("-")[0].toUpperCase();
  return `${prefix}-${entropy}`;
}

export function nowLabel() {
  return new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function displayTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.toLowerCase() === "just now" ? "Recent activity" : text;
}
