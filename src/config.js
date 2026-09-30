export const STORAGE_KEYS = {
  session: "reservata.session.v2",
  offlineData: "reservata.offlineData.v2"
};

export const ROLE_IDS = {
  Requester: "requester",
  "Office Admin": "officeAdmin",
  "Super Admin": "superAdmin",
  "OSG Admin": "osgAdmin"
};

export const REQUESTER_TYPES = ["Student", "Faculty", "Staff", "Student Org Rep"];
export const VISITOR_CAPABLE_REQUESTER_TYPES = ["Faculty", "Staff", "Student Org Rep"];

export const USERS = {
  requester: {
    name: "Student Body Requester",
    initials: "MJ",
    roleLabel: "Requester",
    office: "Student Body",
    email: "student.body.requester@ust.edu.ph",
    portal: "Requester Portal",
    home: "dashboard",
    requesterType: "Student"
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
  }
};

const REQUESTER_VISITOR_VIEWS = new Set(["newVisitor"]);

export const NAV_ITEMS = {
  requester: [
    ["dashboard", "Home"],
    ["resources", "Browse Resources"],
    ["newRequest", "New Request"],
    ["myRequests", "My Requests"],
    ["newVisitor", "New Visitor Request"],
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
  ]
};

export function navItemsFor(role, requesterType) {
  const items = NAV_ITEMS[role] || [];
  if (role !== "requester" || requesterType === "Student") {
    return items.filter(([view]) => !REQUESTER_VISITOR_VIEWS.has(view));
  }
  return items;
}

export function isViewAllowed(role, view, requesterType) {
  return navItemsFor(role, requesterType).some(([item]) => item === view);
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
  newVisitor: ["New Visitor Access Request", "RESERVATA / Requester / New Visitor Request"],
  profile: ["Profile", "RESERVATA / Account"]
};
