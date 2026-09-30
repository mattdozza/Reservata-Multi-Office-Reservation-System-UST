import { HttpError } from "./http.mjs";
import { TABLES } from "./tables.mjs";

export const ROLES = {
  requester: "Requester",
  officeAdmin: "Office Admin",
  superAdmin: "Super Admin",
  osgAdmin: "OSG Admin"
};

export const REQUESTER_TYPES = new Set(["Student", "Faculty", "Staff", "Student Org Rep"]);
export const VISITOR_CAPABLE_REQUESTER_TYPES = new Set(["Faculty", "Staff", "Student Org Rep"]);

function claimsFrom(event) {
  return event.requestContext?.authorizer?.jwt?.claims || event.requestContext?.authorizer?.claims || {};
}

export async function authenticatedUser(event, repo) {
  const claims = claimsFrom(event);
  const email = String(claims.email || claims.preferred_username || claims.upn || "").toLowerCase();
  if (!email) throw new HttpError(401, "The SSO token does not contain an email claim.");
  const user = await repo.get(TABLES.users, { email });
  if (!user || user.status !== "Active") throw new HttpError(403, "This account is not active in Reservata.");
  return { ...user, subject: claims.sub };
}

export function requireRole(user, ...allowedRoles) {
  if (!allowedRoles.includes(user.role)) throw new HttpError(403, "Your role is not permitted to perform this action.");
}

export function requireOffice(user, record) {
  if (!record || record.office !== user.office) throw new HttpError(403, "Only the office assigned to this request can approve or verify this record.");
}
