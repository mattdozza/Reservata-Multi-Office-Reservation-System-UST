const API_BASE_URL = String(import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "reservata.ssoAccessToken";

export const awsBackendConfigured = Boolean(API_BASE_URL);

export function setSsoAccessToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function hasSsoAccessToken() {
  return Boolean(sessionStorage.getItem(TOKEN_KEY));
}

async function request(path, options = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error("University SSO authentication is required.");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `API request failed with status ${response.status}.`);
  return body;
}

function body(value) {
  return JSON.stringify(value);
}

export const awsApi = {
  bootstrap: () => request("/bootstrap"),
  resourceAvailability: (id, date, start, end) => request(`/resources/${encodeURIComponent(id)}/availability?${new URLSearchParams({ date, start, end })}`),
  createReservation: (values) => request("/reservations", { method: "POST", body: body(values) }),
  decideReservation: (id, stepId, approved, reason = "") => request(`/reservations/${encodeURIComponent(id)}/decision`, { method: "PATCH", body: body({ stepId, approved, reason }) }),
  createResource: (resource) => request("/resources", { method: "POST", body: body(resource) }),
  updateResource: (id, resource) => request(`/resources/${encodeURIComponent(id)}`, { method: "PATCH", body: body(resource) }),
  updateResourceStatus: (id, status) => request(`/resources/${encodeURIComponent(id)}/status`, { method: "PATCH", body: body({ status }) }),
  verifyPayment: (id, verified, reason = "") => request(`/payments/${encodeURIComponent(id)}/verification`, { method: "PATCH", body: body({ verified, reason }) }),
  createOffice: (office) => request("/offices", { method: "POST", body: body(office) }),
  updateOffice: (id, office) => request(`/offices/${encodeURIComponent(id)}`, { method: "PATCH", body: body(office) }),
  createUser: (user) => request("/users", { method: "POST", body: body(user) }),
  updateUserRole: (email, role) => request(`/users/${encodeURIComponent(email)}/role`, { method: "PATCH", body: body({ role }) }),
  updateUserAccess: (email, values) => request(`/users/${encodeURIComponent(email)}/access`, { method: "PATCH", body: body(values) }),
  createWorkflow: (workflow) => request("/workflows", { method: "POST", body: body(workflow) }),
  updateWorkflow: (id, workflow) => request(`/workflows/${encodeURIComponent(id)}`, { method: "PATCH", body: body(workflow) }),
  createVisitor: (values) => request("/visitors", { method: "POST", body: body(values) }),
  decideVisitor: (id, approved, reason = "") => request(`/visitors/${encodeURIComponent(id)}/decision`, { method: "PATCH", body: body({ approved, reason }) }),
  checkInVisitor: (id) => request(`/visitors/${encodeURIComponent(id)}/check-in`, { method: "PATCH", body: body({}) }),
  allocateParking: (id, bay) => request(`/visitors/${encodeURIComponent(id)}/parking`, { method: "PATCH", body: body({ bay }) }),
  markNotificationsRead: () => request("/notifications/read", { method: "PATCH", body: body({}) }),
  markNotificationRead: (id) => request("/notifications/read", { method: "PATCH", body: body({ id }) }),
  async uploadReceipt(id, file) {
    if (!file) throw new Error("Select a receipt file first.");
    const signed = await request(`/payments/${encodeURIComponent(id)}/receipt-upload`, {
      method: "POST",
      body: body({ filename: file.name, contentType: file.type })
    });
    const upload = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type, "x-amz-server-side-encryption": "AES256" },
      body: file
    });
    if (!upload.ok) throw new Error("Receipt upload to S3 failed.");
    return signed;
  },
  async uploadSupportingDocument(id, file) {
    if (!file) throw new Error("Select a supporting document first.");
    const signed = await request(`/reservations/${encodeURIComponent(id)}/document-upload`, {
      method: "POST",
      body: body({ filename: file.name, contentType: file.type, size: file.size })
    });
    const upload = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type, "x-amz-server-side-encryption": "AES256" },
      body: file
    });
    if (!upload.ok) throw new Error("Supporting document upload to S3 failed.");
    return signed;
  }
};
