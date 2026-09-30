import { REQUESTER_TYPES, ROLE_IDS } from "../config.js";
import { createLocalUserAccount, loadDatabase } from "../services/api.js";
import { awsApi } from "../services/awsApi.js";
import { cleanText, isUstSsoEmail, requirePaymentDeadlineHours, requireText } from "./shared.js";

export const adminMethods = {
  async updatePaymentDeadlineSettings(value) {
    this.requireRole("superAdmin");
    const paymentDeadlineHours = requirePaymentDeadlineHours(value, "Default payment window");
    const previousData = this.snapshot();
    this.settings.paymentDeadlineHours = paymentDeadlineHours;
    this.addActivity("Payment window updated", this.currentUser.name, `${paymentDeadlineHours} hours`);
    await this.save(() => awsApi.updateSystemSettings(this.settings), previousData);
  },

  async addSampleOffice() {
    this.requireRole("superAdmin");
    const previousData = this.snapshot();
    this.data.resources.push({
      id: `R-${Date.now()}`,
      name: "New Office Sample Resource",
      type: "Facility",
      office: "New Sample Office",
      location: "TBD",
      capacity: 40,
      status: "Available",
      requiresPayment: false,
      driver: "Not applicable"
    });
    this.addActivity("Office created", this.currentUser.name, "New Sample Office");
    await this.save(() => awsApi.createOffice("New Sample Office"), previousData);
  },

  async saveOffice(values, id = "") {
    this.requireRole("superAdmin");
    const name = String(values.name || "").trim();
    if (!name) throw new Error("Office name is required.");
    const previousData = this.snapshot();
    const existing = id ? this.data.offices.find((item) => item.id === id) : null;
    const office = {
      ...(existing || {}),
      id: existing?.id || `OFF-${Date.now()}`,
      name,
      status: values.status || existing?.status || "Active"
    };
    if (existing) {
      const previousName = existing.name;
      Object.assign(existing, office);
      if (previousName !== office.name) {
        this.data.resources.filter((item) => item.office === previousName).forEach((item) => { item.office = office.name; });
        this.data.people.filter((item) => item.office === previousName).forEach((item) => { item.office = office.name; });
      }
    }
    else this.data.offices.push(office);
    this.addActivity(existing ? "Office updated" : "Office created", this.currentUser.name, office.name);
    await this.save(() => existing ? awsApi.updateOffice(office.id, office) : awsApi.createOffice(office), previousData);
  },

  async archiveOffice(id) {
    this.requireRole("superAdmin");
    const office = this.data.offices.find((item) => item.id === id);
    if (!office) throw new Error("Office not found.");
    if (this.data.resources.some((item) => item.office === office.name && item.status !== "Archived")) {
      throw new Error("Archive or transfer this office's resources first.");
    }
    const previousData = this.snapshot();
    office.status = "Inactive";
    this.addActivity("Office archived", this.currentUser.name, office.name);
    await this.save(() => awsApi.updateOffice(office.id, office), previousData);
  },

  async saveWorkflow(template, id = "") {
    this.requireRole("superAdmin");
    const name = String(template.name || "").trim();
    const steps = (template.steps || []).map((step, index) => ({
      id: step.id || `STEP-${index + 1}`,
      name: String(step.name || "").trim(),
      office: step.office,
      sequence: Number(step.sequence || 1),
      condition: step.condition || "always",
      approvingBodyId: step.approvingBodyId || ""
    }));
    if (!name || !steps.length || !steps.some((step) => step.office === "$OWNER" && step.sequence === 1)) {
      throw new Error("A workflow needs a name and a sequence-one Resource Owner step.");
    }
    const previousData = this.snapshot();
    const existing = id ? this.data.approvalTemplates.find((item) => item.id === id) : null;
    const workflow = {
      ...(existing || {}),
      id: existing?.id || `WF-${Date.now()}`,
      name,
      resourceType: template.resourceType || "All",
      status: template.status || existing?.status || "Active",
      steps
    };
    if (existing) Object.assign(existing, workflow);
    else this.data.approvalTemplates.push(workflow);
    this.addActivity(existing ? "Approval workflow updated" : "Approval workflow created", this.currentUser.name, workflow.name);
    await this.save(() => existing ? awsApi.updateWorkflow(workflow.id, workflow) : awsApi.createWorkflow(workflow), previousData);
  },

  async saveApprovingBody(values, id = "") {
    this.requireRole("superAdmin");
    const bodyName = requireText(values.bodyName, "Approving body name", 2);
    const office = String(values.office || "").trim();
    if (!this.data.offices.some((item) => item.name === office && item.status === "Active")) {
      throw new Error("Assign the approving body to an active office.");
    }
    const previousData = this.snapshot();
    const existing = id ? this.data.approvingBodies.find((item) => item.id === id) : null;
    const approvingBody = {
      ...(existing || {}),
      id: existing?.id || `AB-${Date.now()}`,
      office,
      bodyName,
      description: cleanText(values.description),
      status: values.status || existing?.status || "Active"
    };
    if (existing) Object.assign(existing, approvingBody);
    else this.data.approvingBodies.push(approvingBody);
    this.addActivity(existing ? "Approving body updated" : "Approving body created", this.currentUser.name, approvingBody.bodyName);
    await this.save(() => existing ? awsApi.updateApprovingBody(approvingBody.id, approvingBody) : awsApi.createApprovingBody(approvingBody), previousData);
  },

  async saveRequirementOption(values, id = "") {
    this.requireRole("superAdmin");
    const label = requireText(values.label, "Requirement label", 3);
    const help = requireText(values.help, "Requirement help text", 8);
    const optionId = id || cleanText(values.id)
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
      .replace(/^[^a-zA-Z]+/, "")
      .replace(/^./, (char) => char.toLowerCase());
    if (!optionId) throw new Error("Requirement key is required.");
    if (!/^[a-z][a-zA-Z0-9]*$/.test(optionId)) throw new Error("Requirement key must use camelCase letters and numbers.");
    const previousData = this.snapshot();
    const existing = id ? this.allRequirementOptions.find((item) => item.id === id) : null;
    if (!existing && this.allRequirementOptions.some((item) => item.id === optionId)) {
      throw new Error("A requirement with that key already exists.");
    }
    const option = {
      ...(existing || {}),
      id: existing?.id || optionId,
      label,
      help,
      status: values.status || existing?.status || "Active",
      locked: Boolean(existing?.locked)
    };
    if (existing) Object.assign(existing, option);
    else this.settings.requirementOptions.push(option);
    this.addActivity(existing ? "Requirement updated" : "Requirement created", this.currentUser.name, option.label);
    await this.save(() => awsApi.updateSystemSettings(this.settings), previousData);
  },

  async archiveRequirementOption(id) {
    this.requireRole("superAdmin");
    const option = this.allRequirementOptions.find((item) => item.id === id);
    if (!option) throw new Error("Requirement not found.");
    const previousData = this.snapshot();
    option.status = "Archived";
    this.addActivity("Requirement archived", this.currentUser.name, option.label);
    await this.save(() => awsApi.updateSystemSettings(this.settings), previousData);
  },

  async archiveWorkflow(id) {
    this.requireRole("superAdmin");
    const workflow = this.data.approvalTemplates.find((item) => item.id === id);
    if (!workflow) throw new Error("Workflow not found.");
    if (this.data.resources.some((item) => item.workflowTemplateId === id && item.status !== "Archived")) {
      throw new Error("Assign affected resources to another workflow before archiving this one.");
    }
    const previousData = this.snapshot();
    workflow.status = "Archived";
    this.addActivity("Approval workflow archived", this.currentUser.name, workflow.name);
    await this.save(() => awsApi.updateWorkflow(id, workflow), previousData);
  },

  async createUser(values) {
    this.requireRole("superAdmin");
    const email = String(values.email || "").trim().toLowerCase();
    const name = String(values.name || "").trim();
    const office = String(values.office || "").trim();
    const role = values.role;
    const status = values.status || "Active";
    if (!name || !email || !office) throw new Error("User name, email, and office are required.");
    if (!isUstSsoEmail(email)) throw new Error("Use a valid UST SSO email ending in @ust.edu.ph.");
    if (!ROLE_IDS[role]) throw new Error("Unsupported role.");
    if (!["Active", "Inactive"].includes(status)) throw new Error("Unsupported account status.");
    if (role === "Super Admin" && office !== "All Offices") throw new Error("Super Admin accounts must use All Offices.");
    if (role === "Office Admin" && office === "All Offices") throw new Error("Office Admin accounts must be assigned to a specific office.");
    if (role === "OSG Admin" && office !== "OSG") throw new Error("OSG Admin accounts must be assigned to OSG.");
    const requesterType = role === "Requester" ? String(values.requesterType || "") : "";
    if (role === "Requester" && !REQUESTER_TYPES.includes(requesterType)) {
      throw new Error("Requester accounts must specify a valid affiliation.");
    }
    if (this.data.people.some((item) => item.email.toLowerCase() === email)) throw new Error("That SSO email already has a RESERVATA account.");
    if (role !== "Requester" && office !== "All Offices" && !this.data.offices.some((item) => item.name === office && item.status === "Active")) {
      throw new Error("Assign the user to an active office.");
    }
    const person = { name, email, office, role, status, requesterType };
    if (this.backendMode === "local" && this.apiAvailable) {
      const result = await createLocalUserAccount(person);
      const refreshed = await loadDatabase();
      this.setData(refreshed.data);
      this.pendingTempPassword = result.tempPassword;
      return;
    }
    const previousData = this.snapshot();
    this.data.people.push(person);
    this.addActivity("User account created", this.currentUser.name, person.name);
    await this.save(() => awsApi.createUser(person), previousData);
  },

  async updateUserRole(email, role) {
    this.requireRole("superAdmin");
    if (email === this.currentUser.email) throw new Error("You cannot change your own role while signed in.");
    const person = this.data.people.find((item) => item.email === email);
    if (!person) return;
    if (!ROLE_IDS[role]) throw new Error("Unsupported role.");
    const previousData = this.snapshot();
    person.role = role;
    if (role === "Requester" && !REQUESTER_TYPES.includes(person.requesterType)) person.requesterType = "Student";
    else if (role !== "Requester") person.requesterType = "";
    this.addActivity("User role updated", this.currentUser.name, person.name);
    await this.save(() => awsApi.updateUserRole(email, person.role, person.requesterType), previousData);
  },

  async updateUserRequesterType(email, requesterType) {
    this.requireRole("superAdmin");
    const person = this.data.people.find((item) => item.email === email);
    if (!person) throw new Error("User not found.");
    if (person.role !== "Requester") throw new Error("Only Requester accounts have an affiliation.");
    if (!REQUESTER_TYPES.includes(requesterType)) throw new Error("Unsupported affiliation.");
    const previousData = this.snapshot();
    person.requesterType = requesterType;
    this.addActivity("Affiliation updated", this.currentUser.name, person.name);
    await this.save(() => awsApi.updateUserRequesterType(email, requesterType), previousData);
  },

  async updateUserStatus(email, status) {
    this.requireRole("superAdmin");
    if (email === this.currentUser.email) throw new Error("You cannot deactivate your own account while signed in.");
    const person = this.data.people.find((item) => item.email === email);
    if (!person) throw new Error("User not found.");
    const previousData = this.snapshot();
    person.status = status;
    this.addActivity("User access updated", this.currentUser.name, `${person.name}: ${status}`);
    await this.save(() => awsApi.updateUserAccess(email, { status }), previousData);
  }
};
