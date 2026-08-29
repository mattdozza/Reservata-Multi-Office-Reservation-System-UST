export const STORAGE_KEYS = {
  session: "reservata.session.v2",
  offlineData: "reservata.offlineData.v2"
};

export const ROLE_IDS = {
  Requester: "requester",
  "Office Admin": "officeAdmin",
  "Super Admin": "superAdmin",
  "OSG Admin": "osgAdmin",
  "OSG Requester": "osgRequester"
};

export const USERS = {
  requester: {
    name: "Student Body Requester",
    initials: "MJ",
    roleLabel: "Requester",
    office: "Student Body",
    email: "student.body.requester@ust.edu.ph",
    portal: "Requester Portal",
    home: "dashboard"
  },
  officeAdmin: {
    name: "Simbahayan Office Admin",
    initials: "MS",
    roleLabel: "Office Admin",
    office: "Simbahayan Office",
    email: "simbahayan.admin@ust.edu.ph",
    portal: "Office Admin Portal",
    home: "dashboard"
  },
  superAdmin: {
    name: "All Offices Super Admin",
    initials: "SA",
    roleLabel: "Super Admin",
    office: "All Offices",
    email: "all.offices.admin@ust.edu.ph",
    portal: "Super Admin",
    home: "dashboard"
  },
  osgAdmin: {
    name: "OSG Admin",
    initials: "AR",
    roleLabel: "OSG Admin",
    office: "Office of the Secretary General",
    email: "osg.admin@ust.edu.ph",
    portal: "OSG Admin Portal",
    home: "dashboard"
  },
  osgRequester: {
    name: "CICS Visitor Requester",
    initials: "PR",
    roleLabel: "OSG Requester",
    office: "CICS",
    email: "cics.visitor.requester@ust.edu.ph",
    portal: "OSG Requester Portal",
    home: "dashboard"
  }
};

export const NAV_ITEMS = {
  requester: [
    ["dashboard", "Home"],
    ["resources", "Browse Resources"],
    ["newRequest", "New Request"],
    ["myRequests", "My Requests"],
    ["calendar", "Calendar"],
    ["notifications", "Alerts"],
    ["profile", "Profile"]
  ],
  officeAdmin: [
    ["dashboard", "Dashboard"],
    ["approvalQueue", "Approvals"],
    ["payments", "Payments"],
    ["resources", "Resources"],
    ["officeSettings", "Office Settings"],
    ["calendar", "Calendar"],
    ["notifications", "Alerts"],
    ["activity", "Activity"],
    ["profile", "Profile"]
  ],
  superAdmin: [
    ["dashboard", "Dashboard"],
    ["offices", "Offices"],
    ["users", "Users & Roles"],
    ["workflows", "Approval Workflows"],
    ["resources", "Coverage"],
    ["calendar", "Calendar"],
    ["notifications", "Alerts"],
    ["activity", "Activity"],
    ["profile", "Profile"]
  ],
  osgAdmin: [
    ["dashboard", "Dashboard"],
    ["visitorRequests", "Visitor Requests"],
    ["eventReviews", "Event Reviews"],
    ["parking", "Parking"],
    ["arrivals", "Arrivals"],
    ["visitorRecords", "Records"],
    ["notifications", "Alerts"],
    ["activity", "Activity"],
    ["profile", "Profile"]
  ],
  osgRequester: [
    ["dashboard", "Home"],
    ["newVisitor", "New Visitor Request"],
    ["myVisitorRequests", "My Requests"],
    ["profile", "Profile"]
  ]
};

export const ROLE_ACCESS = Object.fromEntries(
  Object.entries(NAV_ITEMS).map(([role, items]) => [role, items.map(([view]) => view)])
);

export function isViewAllowed(role, view) {
  return Boolean(role && ROLE_ACCESS[role]?.includes(view));
}

export const PAGE_TITLES = {
  dashboard: ["Dashboard", "RESERVATA / Overview"],
  resources: ["Resources", "RESERVATA / Resource Availability"],
  newRequest: ["New Reservation Request", "RESERVATA / Requester / New Request"],
  myRequests: ["My Requests", "RESERVATA / Requester / My Requests"],
  calendar: ["Calendar", "RESERVATA / Reservation Calendar"],
  notifications: ["Alerts", "RESERVATA / Notifications"],
  approvalQueue: ["Approval Queue", "RESERVATA / Office Admin / Approvals"],
  payments: ["Payment Verification", "RESERVATA / Office Admin / Payments"],
  officeSettings: ["Office Settings", "RESERVATA / Office Admin / Resource Maintenance"],
  activity: ["Activity Log", "RESERVATA / Audit Trail"],
  offices: ["Office Management", "RESERVATA / Super Admin / Offices"],
  users: ["Users & Roles", "RESERVATA / Super Admin / RBAC"],
  workflows: ["Approval Workflows", "RESERVATA / Super Admin / Routing Rules"],
  visitorRequests: ["Visitor Requests", "RESERVATA / OSG / Visitor Requests"],
  eventReviews: ["Event Reviews", "RESERVATA / OSG / Conditional Approvals"],
  parking: ["Parking Allocation", "RESERVATA / OSG / Parking"],
  arrivals: ["Arrival Monitor", "RESERVATA / OSG / Arrivals"],
  visitorRecords: ["Visitor Records", "RESERVATA / OSG / Records"],
  newVisitor: ["New Visitor Access Request", "RESERVATA / OSG Requester / New Request"],
  myVisitorRequests: ["My Visitor Requests", "RESERVATA / OSG Requester / My Requests"],
  profile: ["Profile", "RESERVATA / Account"]
};
