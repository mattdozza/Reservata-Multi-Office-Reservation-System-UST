import { awsApi } from "../services/awsApi.js";
import { nextId, todayIso } from "../shared/utils.js";
import { uploadResourcePhoto } from "../services/resourcePhotos.js";
import { allowedResourceTypes, BLOCKING_RESERVATION_STATUSES, generateAssetTag, normalizeAssetTag, normalizeBlockedDates, normalizeResourceTags, requirePaymentDeadlineHours, toMinutes, validPositiveNumber } from "./shared.js";

function normalizeOperatingHours(values, existing) {
  const openTime = values.openTime === undefined ? existing?.openTime || "" : String(values.openTime || "").trim();
  const closeTime = values.closeTime === undefined ? existing?.closeTime || "" : String(values.closeTime || "").trim();
  if (openTime && toMinutes(openTime) === null) throw new Error("Open time must be a valid time.");
  if (closeTime && toMinutes(closeTime) === null) throw new Error("Close time must be a valid time.");
  if (openTime && closeTime && toMinutes(openTime) >= toMinutes(closeTime)) {
    throw new Error("Open time must be earlier than close time.");
  }
  return { openTime, closeTime };
}

export const resourceMethods = {
  get officeResources() {
    if (!this.officeScope) return this.data.resources;
    return this.data.resources.filter((resource) => resource.office === this.officeScope);
  },

  /**
   * When a resource leaves Available, hold every affected request for review: pending
   * requests are flagged for the owning office to decide, and confirmed requests notify
   * both the office and the requester.
   */
  flagResourceOutage(resource) {
    if (!resource || resource.status === "Available") return 0;
    const affected = this.data.reservations.filter((item) =>
      item.resourceId === resource.id
      && ["Under Owner Review", "Under Additional Review", "Approved", "For Payment", "In Use", "Confirmed"].includes(item.status));
    for (const reservation of affected) {
      reservation.resourceConflict = true;
      reservation.resourceConflictReason = `${resource.name} is currently ${resource.status}.`;
      this.addNotification(
        reservation.office,
        `${resource.name} is ${resource.status}. Review ${reservation.id} (${reservation.requester}) and decide whether to reject it or offer an alternative.`,
        "Resource"
      );
      if (["Confirmed", "In Use"].includes(reservation.status)) {
        this.addNotification(
          reservation.requester,
          `${resource.name}: your confirmed reservation ${reservation.id} is affected because the resource is ${resource.status}. The owning office will contact you with the next step.`,
          "Resource"
        );
      }
      this.addActivity("Resource conflict flagged", this.currentUser.name, `${resource.name}: ${reservation.id}`, reservation.id, reservation.id);
    }
    return affected.length;
  },

  async cycleResourceStatus(id) {
    this.requireRole("officeAdmin", "superAdmin");
    const resource = this.data.resources.find((item) => item.id === id);
    if (!resource) return;
    if (this.session.activeRole === "officeAdmin") this.requireOfficeRecord(resource);
    const previousData = this.snapshot();
    const statuses = ["Available", "Reserved", "In Use", "Under Maintenance", "Unavailable"];
    const previousStatus = resource.status;
    resource.status = statuses[(statuses.indexOf(resource.status) + 1) % statuses.length];
    this.addActivity("Resource status updated", this.currentUser.name, `${resource.name}: ${resource.status}`);
    this.flagResourceOutage(resource);
    this.data.reservations
      .filter((item) => item.resourceId === resource.id && BLOCKING_RESERVATION_STATUSES.includes(item.status))
      .forEach((item) => this.addNotification(item.requester, `${resource.name} status changed from ${previousStatus} to ${resource.status}. Please monitor your request schedule.`, "Resource"));
    await this.save(() => awsApi.updateResourceStatus(id, resource.status), previousData);
  },

  async saveResource(values, id = "") {
    this.requireRole("officeAdmin", "superAdmin");
    const previousData = this.snapshot();
    const existing = id ? this.data.resources.find((item) => item.id === id) : null;
    if (id && !existing) throw new Error("Resource not found.");
    if (existing && this.session.activeRole === "officeAdmin") this.requireOfficeRecord(existing);
    if (!String(values.name || "").trim() || !String(values.location || "").trim()) {
      throw new Error("Resource name and location are required.");
    }
    const type = values.type || existing?.type || "Equipment";
    const allowedTypes = allowedResourceTypes(this.officeScope);
    if (allowedTypes && !allowedTypes.includes(type)) {
      throw new Error(`${this.officeScope} can only manage ${allowedTypes.join(" or ")} resources.`);
    }
    const assetTag = normalizeAssetTag(values.assetTag || generateAssetTag(this.data.resources, this.officeScope, type, existing?.id));
    if (this.data.resources.some((item) => item.id !== existing?.id && normalizeAssetTag(item.assetTag) === assetTag)) {
      throw new Error("Asset tag must be unique.");
    }
    const template = this.data.approvalTemplates.find((item) => item.id === values.workflowTemplateId && item.status === "Active");
    if (!template) throw new Error("Select an active approval workflow.");
    const { openTime, closeTime } = normalizeOperatingHours(values, existing);
    let photoKey = values.photoKey ?? existing?.photoKey ?? "";
    if (values.photoData) photoKey = (await uploadResourcePhoto(values.photoData)).key;
    const resource = {
      ...(existing || {}),
      id: existing?.id || nextId("R", this.data.resources),
      assetTag,
      photoKey,
      name: String(values.name).trim(),
      type,
      office: this.officeScope,
      location: String(values.location).trim(),
      serialNumber: String(values.serialNumber || "").trim(),
      tags: normalizeResourceTags(values.tags),
      capacity: validPositiveNumber(values.capacity || 1, "Capacity"),
      status: values.status || "Available",
      requiresPayment: Boolean(values.requiresPayment),
      fee: values.requiresPayment ? validPositiveNumber(values.fee || 0, "Fee", 0) : 0,
      paymentDeadlineHours: values.requiresPayment && String(values.paymentDeadlineHours ?? "").trim()
        ? requirePaymentDeadlineHours(values.paymentDeadlineHours, "Payment window")
        : null,
      driver: values.type === "Vehicle" ? (values.driver || "Without Driver") : "Not applicable",
      openTime,
      closeTime,
      blockedDates: normalizeBlockedDates(existing ? existing.blockedDates : values.blockedDates).filter((item) => item.date >= todayIso()),
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

  async blockResourceDate(id, date, reason = "") {
    this.requireRole("officeAdmin");
    const resource = this.data.resources.find((item) => item.id === id);
    if (!resource) throw new Error("Resource not found.");
    this.requireOfficeRecord(resource);
    const cleanDate = String(date || "").trim();
    if (!cleanDate || cleanDate < todayIso()) throw new Error("Choose a valid upcoming date to block.");
    if ((resource.blockedDates || []).some((item) => item.date === cleanDate)) {
      throw new Error("That date is already blocked.");
    }
    const previousData = this.snapshot();
    resource.blockedDates = normalizeBlockedDates([...(resource.blockedDates || []), { date: cleanDate, reason }]);
    this.addActivity("Resource date blocked", this.currentUser.name, `${resource.name}: ${cleanDate}${reason ? ` (${reason})` : ""}`);
    await this.save(() => awsApi.updateResource(id, { blockedDates: resource.blockedDates }), previousData);
  },

  async unblockResourceDate(id, date) {
    this.requireRole("officeAdmin");
    const resource = this.data.resources.find((item) => item.id === id);
    if (!resource) throw new Error("Resource not found.");
    this.requireOfficeRecord(resource);
    const previousData = this.snapshot();
    resource.blockedDates = (resource.blockedDates || []).filter((item) => item.date !== date);
    this.addActivity("Resource date unblocked", this.currentUser.name, `${resource.name}: ${date}`);
    await this.save(() => awsApi.updateResource(id, { blockedDates: resource.blockedDates }), previousData);
  },

  resourceReservationsOnDate(resourceId, date) {
    return this.data.reservations.filter((item) =>
      item.resourceId === resourceId && item.date === date && BLOCKING_RESERVATION_STATUSES.includes(item.status)
    );
  },

  async archiveResource(id) {
    this.requireRole("officeAdmin", "superAdmin");
    const resource = this.data.resources.find((item) => item.id === id);
    if (this.session.activeRole === "officeAdmin") this.requireOfficeRecord(resource);
    const hasOpenReservations = this.data.reservations.some((item) =>
      item.resourceId === id && !["Rejected", "Cancelled", "Completed", "Expired", "No Show"].includes(item.status)
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
    const type = "Equipment";
    const resource = {
      id,
      assetTag: generateAssetTag(this.data.resources, this.officeScope, type),
      name: `Sample Resource ${this.data.resources.length + 1}`,
      type,
      office: this.currentUser.office.replace(" Office", ""),
      location: "Office Inventory",
      capacity: 1,
      status: "Available",
      serialNumber: "",
      tags: ["Sample", "Equipment"],
      requiresPayment: false,
      driver: "Not applicable"
    };
    this.data.resources.push(resource);
    this.addActivity("Resource created", this.currentUser.name, id);
    await this.save(() => awsApi.createResource(resource), previousData);
  }
};
