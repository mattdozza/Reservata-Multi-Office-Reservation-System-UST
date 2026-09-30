export const TABLES = {
  resources: process.env.RESOURCES_TABLE,
  reservations: process.env.RESERVATIONS_TABLE,
  reservationLocks: process.env.RESERVATION_LOCKS_TABLE,
  payments: process.env.PAYMENTS_TABLE,
  visitors: process.env.VISITORS_TABLE,
  users: process.env.USERS_TABLE,
  offices: process.env.OFFICES_TABLE,
  approvalWorkflows: process.env.APPROVAL_WORKFLOWS_TABLE,
  systemSettings: process.env.SYSTEM_SETTINGS_TABLE,
  notifications: process.env.NOTIFICATIONS_TABLE,
  activity: process.env.ACTIVITY_TABLE,
  drivers: process.env.DRIVERS_TABLE,
  reservationDrivers: process.env.RESERVATION_DRIVERS_TABLE,
  approvingBodies: process.env.APPROVING_BODIES_TABLE,
  approvals: process.env.APPROVALS_TABLE,
  reservationHistory: process.env.RESERVATION_HISTORY_TABLE
};

export function requireTableNames() {
  const missing = Object.entries(TABLES).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing table environment variables: ${missing.join(", ")}`);
}
