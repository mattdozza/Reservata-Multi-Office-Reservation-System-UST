import { awsApi } from "../awsApi.js";
import { nextId } from "../utils.js";
import { validPositiveNumber } from "./shared.js";

export const resourceMethods = {
  get officeResources() {
    if (!this.officeScope) return this.data.resources;
    return this.data.resources.filter((resource) => resource.office === this.officeScope);
  },

  async cycleResourceStatus(id) {
    this.requireRole("officeAdmin");
    const resource = this.data.resources.find((item) => item.id === id);
    if (!resource) return;
    this.requireOfficeRecord(resource);
    const previousData = this.snapshot();
    const statuses = ["Available", "Reserved", "In Use", "Under Maintenance", "Unavailable"];
    resource.status = statuses[(statuses.indexOf(resource.status) + 1) % statuses.length];
    this.addActivity("Resource status updated", this.currentUser.name, `${resource.name}: ${resource.status}`);
    this.data.reservations
      .filter((item) => item.resourceId === resource.id && BLOCKING_RESERVATION_STATUSES.includes(item.status))
      .forEach((item) => this.addNotification(item.requester, `${resource.name} status changed to ${resource.status}. Please monitor your request schedule.`, "Resource"));
    await this.save(() => awsApi.updateResourceStatus(id, resource.status), previousData);
  },

  async saveResource(values, id = "") {
    this.requireRole("officeAdmin");
    const previousData = this.snapshot();
    const existing = id ? this.data.resources.find((item) => item.id === id) : null;
    if (id && !existing) throw new Error("Resource not found.");
    if (existing) this.requireOfficeRecord(existing);
    if (!String(values.name || "").trim() || !String(values.location || "").trim()) {
      throw new Error("Resource name and location are required.");
    }
    const template = this.data.approvalTemplates.find((item) => item.id === values.workflowTemplateId && item.status === "Active");
    if (!template) throw new Error("Select an active approval workflow.");
    const resource = {
      ...(existing || {}),
      id: existing?.id || nextId("R", this.data.resources),
      name: String(values.name).trim(),
      type: values.type,
      office: this.officeScope,
      location: String(values.location).trim(),
      capacity: validPositiveNumber(values.capacity || 1, "Capacity"),
      status: values.status || "Available",
      requiresPayment: Boolean(values.requiresPayment),
      fee: values.requiresPayment ? validPositiveNumber(values.fee || 0, "Fee", 0) : 0,
      driver: values.type === "Vehicle" ? (values.driver || "Without Driver") : "Not applicable",
      workflowTemplateId: template.id
    };
    if (existing) Object.assign(existing, resource);
    else this.data.resources.push(resource);
    this.addActivity(existing ? "Resource updated" : "Resource created", this.currentUser.name, resource.name);
    await this.save(
      () => existing ? awsApi.updateResource(resource.id, resource) : awsApi.createResource(resource),
      previousData
    );
  },

  async archiveResource(id) {
    this.requireRole("officeAdmin");
    const resource = this.data.resources.find((item) => item.id === id);
    this.requireOfficeRecord(resource);
    const hasOpenReservations = this.data.reservations.some((item) =>
      item.resourceId === id && !["Rejected", "Cancelled", "Completed"].includes(item.status)
    );
    if (hasOpenReservations) throw new Error("This resource has an active reservation and cannot be archived.");
    const previousData = this.snapshot();
    resource.status = "Archived";
    this.addActivity("Resource archived", this.currentUser.name, resource.name);
    await this.save(() => awsApi.updateResource(id, { status: "Archived" }), previousData);
  },

  async addSampleResource() {
    this.requireRole("officeAdmin");
    const previousData = this.snapshot();
    const id = nextId("R", this.data.resources);
    const resource = {
      id,
      name: `Sample Resource ${this.data.resources.length + 1}`,
      type: "Equipment",
      office: this.currentUser.office.replace(" Office", ""),
      location: "Office Inventory",
      capacity: 1,
      status: "Available",
      requiresPayment: false,
      driver: "Not applicable"
    };
    this.data.resources.push(resource);
    this.addActivity("Resource created", this.currentUser.name, id);
    await this.save(() => awsApi.createResource(resource), previousData);
  }
};
