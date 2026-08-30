import { loadResourceAvailability } from "../api.js";
import { awsApi } from "../awsApi.js";
import { compareDateTime, nextId, nowLabel, tomorrowIso } from "../utils.js";
import { buildApprovalSteps, decideApprovalStep, pendingApprovalSteps } from "../workflows.js";
import {
  BLOCKING_RESERVATION_STATUSES,
  BUSINESS_DAY_END,
  BUSINESS_DAY_START,
  DEFAULT_SLOT_MINUTES,
  RESOLVED_RESERVATION_STATUSES,
  addDaysIso,
  cleanText,
  fromMinutes,
  requireReservationLeadDate,
  requireText,
  selectedDuration,
  validPositiveNumber
} from "./shared.js";

export const reservationMethods = {
  get officeReservations() {
    if (!this.officeScope) return this.data.reservations;
    return this.data.reservations.filter((reservation) =>
      reservation.office === this.officeScope || reservation.approvalSteps?.some((step) => step.office === this.officeScope)
    );
  },

  get actionableReservations() {
    if (!["officeAdmin", "osgAdmin"].includes(this.session.activeRole)) return [];
    return this.data.reservations.filter((reservation) => pendingApprovalSteps(reservation, this.officeScope).length > 0);
  },

  get actionableApprovalCount() {
    return this.actionableReservations.reduce(
      (total, reservation) => total + pendingApprovalSteps(reservation, this.officeScope).length,
      0
    );
  },

  myReservations() {
    return this.data.reservations.filter((reservation) => reservation.requester === this.currentUser.name);
  },

  isReservationOverdue(reservation) {
    if (!reservation?.date || !reservation?.end || RESOLVED_RESERVATION_STATUSES.includes(reservation.status)) return false;
    return new Date(`${reservation.date}T${reservation.end}`).getTime() < Date.now();
  },

  get overdueReservations() {
    const source = this.session.activeRole === "requester" ? this.myReservations() : this.officeReservations;
    return source.filter((reservation) => this.isReservationOverdue(reservation));
  },

  resourceConflicts(resourceId, date, start, end, excludeId = "") {
    if (!resourceId || !date || !start || !end || start >= end) return [];
    return this.data.reservations.filter((reservation) => {
      const blockingStatus = BLOCKING_RESERVATION_STATUSES.includes(reservation.status);
      return reservation.id !== excludeId
        && reservation.resourceId === resourceId
        && reservation.date === date
        && blockingStatus
        && start < reservation.end
        && end > reservation.start;
    });
  },

  hasConflict(resourceId, date, start, end, excludeId = "") {
    return this.resourceConflicts(resourceId, date, start, end, excludeId).length > 0;
  },

  resourceAvailability(resourceId, date, start, end) {
    const resource = this.data.resources.find((item) => item.id === resourceId);
    const emptySlots = { slots: [], alternatives: [] };
    if (!resource) return { status: "unavailable", message: "Select a resource first.", conflicts: [], ...emptySlots };
    if (resource.status !== "Available") return { status: "unavailable", message: `${resource.name} is currently ${resource.status}.`, conflicts: [], ...emptySlots };
    if (!date || !start || !end) return { status: "pending", message: "Choose a date, start time, and end time to check availability.", conflicts: [], ...emptySlots };
    if (date < tomorrowIso()) return {
      status: "unavailable",
      message: "Reservations must be made at least one day before the time of use.",
      conflicts: [],
      slots: this.reservationSlotOptions(resourceId, tomorrowIso(), start, end),
      alternatives: this.availableAlternatives(resourceId, tomorrowIso(), start, end)
    };
    if (start >= end) return {
      status: "unavailable",
      message: "End time must be later than start time.",
      conflicts: [],
      slots: this.reservationSlotOptions(resourceId, date, start, end),
      alternatives: []
    };
    const conflicts = this.resourceConflicts(resourceId, date, start, end);
    if (conflicts.length) return {
      status: "conflict",
      message: `${resource.name} has an overlapping request in that slot.`,
      conflicts,
      slots: this.reservationSlotOptions(resourceId, date, start, end),
      alternatives: this.availableAlternatives(resourceId, date, start, end)
    };
    return {
      status: "available",
      message: `${resource.name} is available for the selected slot.`,
      conflicts: [],
      slots: this.reservationSlotOptions(resourceId, date, start, end),
      alternatives: this.availableAlternatives(resourceId, date, start, end)
    };
  },

  reservationSlotOptions(resourceId, date, start, end) {
    const resource = this.data.resources.find((item) => item.id === resourceId);
    if (!resource || !date) return [];
    const duration = selectedDuration(start, end);
    const step = duration >= DEFAULT_SLOT_MINUTES ? DEFAULT_SLOT_MINUTES : 30;
    const unavailableDay = resource.status !== "Available" || date < tomorrowIso();
    const options = [];
    for (let minute = BUSINESS_DAY_START; minute + duration <= BUSINESS_DAY_END; minute += step) {
      const optionStart = fromMinutes(minute);
      const optionEnd = fromMinutes(minute + duration);
      const conflicts = unavailableDay ? [] : this.resourceConflicts(resourceId, date, optionStart, optionEnd);
      options.push({
        date,
        start: optionStart,
        end: optionEnd,
        status: unavailableDay || conflicts.length ? "unavailable" : "available",
        conflicts
      });
    }
    return options;
  },

  availableAlternatives(resourceId, date, start, end, limit = 6) {
    const startDate = date && date >= tomorrowIso() ? date : tomorrowIso();
    const alternatives = [];
    for (let day = 0; day < 10 && alternatives.length < limit; day += 1) {
      const candidateDate = addDaysIso(startDate, day);
      const daily = this.reservationSlotOptions(resourceId, candidateDate, start, end)
        .filter((slot) => slot.status === "available");
      alternatives.push(...daily.slice(0, limit - alternatives.length));
    }
    return alternatives;
  },

  async fetchResourceAvailability(resourceId, date, start, end) {
    if (this.backendMode === "aws") {
      return awsApi.resourceAvailability(resourceId, date, start, end);
    }
    if (this.apiAvailable) {
      return loadResourceAvailability(resourceId, date, start, end);
    }
    return this.resourceAvailability(resourceId, date, start, end);
  },

  upcomingReservations(resourceId, limit = 5) {
    return this.data.reservations
      .filter((reservation) => reservation.resourceId === resourceId && BLOCKING_RESERVATION_STATUSES.includes(reservation.status))
      .sort((left, right) => compareDateTime(left.date, left.start, right.date, right.start))
      .slice(0, limit);
  },

  async submitReservation(values) {
    this.requireRole("requester");
    const resource = this.data.resources.find((item) => item.id === values.resourceId);
    if (!resource) throw new Error("Selected resource was not found.");
    if (resource.status !== "Available") throw new Error("Only available resources can be reserved.");
    const date = requireReservationLeadDate(values.date);
    const start = cleanText(values.start);
    const end = cleanText(values.end);
    if (!start || !end) throw new Error("Start and end time are required.");
    if (values.start >= values.end) throw new Error("End time must be later than start time.");
    const quantity = validPositiveNumber(values.quantity || 1, "Quantity / attendees");
    if (quantity > Number(resource.capacity || 1)) throw new Error(`Quantity cannot exceed ${resource.name}'s capacity of ${resource.capacity}.`);
    const purpose = requireText(values.purpose, "Purpose", 10);
    if (this.hasConflict(resource.id, date, start, end)) {
      throw new Error("That resource already has a confirmed overlapping reservation.");
    }
    const previousData = this.snapshot();

    const id = nextId("REQ-2026");
    const template = this.data.approvalTemplates.find((item) => item.id === resource.workflowTemplateId && item.status === "Active")
      || this.data.approvalTemplates.find((item) => item.resourceType === resource.type && item.status === "Active")
      || this.data.approvalTemplates.find((item) => item.id === "WF-BASIC");
    const requestDetails = Object.fromEntries(this.allRequirementOptions.map((option) => [option.id, Boolean(values[option.id])]));
    const reservation = {
      id,
      requester: this.currentUser.name,
      resourceId: resource.id,
      resourceName: resource.name,
      office: resource.office,
      type: resource.type,
      date,
      start,
      end,
      quantity,
      purpose,
      ...requestDetails,
      status: "Under Owner Review",
      submittedAt: nowLabel(),
      requiresPayment: resource.requiresPayment,
      workflowTemplateId: template?.id || "WF-BASIC",
      workflowName: template?.name || "Basic Resource Approval",
      approvalSteps: buildApprovalSteps(template, resource, requestDetails, id)
    };

    this.data.reservations.unshift(reservation);
    this.addNotification(this.currentUser.name, `${resource.name} request was submitted and routed to ${resource.office}.`, "Reservation");
    this.addNotification(resource.office, `${resource.name}: new reservation request from ${this.currentUser.name} needs review.`, "Reservation");
    this.addActivity("Reservation submitted", this.currentUser.name, resource.name, `${date} ${start}-${end}`);
    await this.save(() => awsApi.createReservation(values), previousData);
  },

  approvalStep(reservation, stepId) {
    const step = stepId
      ? reservation.approvalSteps?.find((item) => item.id === stepId)
      : pendingApprovalSteps(reservation, this.officeScope)[0];
    if (!step || step.office !== this.officeScope || step.status !== "Pending") {
      throw new Error("No active approval step is assigned to your office.");
    }
    return step;
  },

  async approveReservation(id, stepId) {
    this.requireRole("officeAdmin", "osgAdmin");
    const reservation = this.data.reservations.find((item) => item.id === id);
    if (!reservation) return;
    const step = this.approvalStep(reservation, stepId);
    const previousData = this.snapshot();

    decideApprovalStep(reservation, step.id, true, this.currentUser.name, nowLabel());
    if (reservation.status === "For Payment" && !reservation.paymentId) {
      const resource = this.data.resources.find((item) => item.id === reservation.resourceId);
      const paymentId = nextId("PAY", this.data.payments);
      reservation.paymentId = paymentId;
      this.data.payments.unshift({
        id: paymentId,
        reservationId: reservation.id,
        requester: reservation.requester,
        office: reservation.office,
        amount: resource?.fee || 0,
        receipt: "Awaiting upload",
        status: "Awaiting Receipt"
      });
    }
    this.addNotification(
      reservation.requester,
      `${reservation.resourceName}: ${step.name} was approved by ${this.currentUser.name}. Current status: ${reservation.status}${reservation.status === "For Payment" ? " - upload your receipt to continue." : "."}`,
      "Approval"
    );
    this.addActivity("Approval step approved", this.currentUser.name, `${reservation.resourceName}: ${step.name}`, reservation.id);
    await this.save(() => awsApi.decideReservation(id, step.id, true), previousData);
  },

  async rejectReservation(id, stepId, reason = "") {
    this.requireRole("officeAdmin", "osgAdmin");
    const reservation = this.data.reservations.find((item) => item.id === id);
    if (!reservation) return;
    const step = this.approvalStep(reservation, stepId);
    const cleanReason = requireText(reason, "Rejection reason", 8);
    const previousData = this.snapshot();
    decideApprovalStep(reservation, step.id, false, this.currentUser.name, nowLabel());
    step.reason = cleanReason;
    reservation.rejectionReason = cleanReason;
    this.addNotification(
      reservation.requester,
      `${reservation.resourceName}: ${step.name} was rejected by ${this.currentUser.name}. Reason: ${cleanReason}`,
      "Approval"
    );
    this.addActivity("Approval step rejected", this.currentUser.name, `${reservation.resourceName}: ${step.name}`, cleanReason);
    await this.save(() => awsApi.decideReservation(id, step.id, false, cleanReason), previousData);
  }
};
