import { loadResourceAvailability } from "../services/api.js";
import { awsApi } from "../services/awsApi.js";
import { compareDateTime, nextId, nowLabel, tomorrowIso } from "../shared/utils.js";
import { buildApprovalSteps, decideApprovalStep, pendingApprovalSteps } from "../domain/workflows.js";
import {
  BLOCKING_RESERVATION_STATUSES,
  BUSINESS_DAY_END,
  BUSINESS_DAY_START,
  DEFAULT_SLOT_MINUTES,
  RESOLVED_RESERVATION_STATUSES,
  ACTIVE_PAYMENT_STATUSES,
  CLOSED_PAYMENT_STATUSES,
  DEFAULT_PAYMENT_DEADLINE_HOURS,
  addDaysIso,
  cleanText,
  effectivePaymentDeadlineHours,
  fromMinutes,
  normalizePaymentDeadlineHours,
  requireReservationLeadDate,
  requireText,
  selectedDuration,
  validPositiveNumber
} from "./shared.js";

const REVIEW_STATUSES = ["Under Owner Review", "Under Additional Review", "Approved"];
const REQUESTER_MUTABLE_STATUSES = ["Under Owner Review", "Under Additional Review", "For Payment", "Confirmed"];
const ADMIN_OVERRIDE_STATUSES = ["Cancelled", "Expired"];

function nowIso() {
  return new Date().toISOString();
}

function dateTimeMs(date, time = "00:00") {
  const value = new Date(`${date}T${time}`).getTime();
  return Number.isFinite(value) ? value : null;
}

function reservationStartMs(reservation) {
  return dateTimeMs(reservation?.date, reservation?.start || "00:00");
}

function reservationEndMs(reservation) {
  return dateTimeMs(reservation?.date, reservation?.end || reservation?.start || "00:00");
}

function plusHoursIso(value, hours) {
  const base = new Date(value || nowIso()).getTime();
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

function earlierIso(left, right) {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function paymentDeadlineFor(reservation, payment, createdAt = nowIso(), deadlineHours = DEFAULT_PAYMENT_DEADLINE_HOURS) {
  const rollingDeadline = plusHoursIso(payment?.createdAt || payment?.submittedAt || createdAt, deadlineHours);
  const scheduleDeadline = reservation?.date && reservation?.start ? new Date(`${reservation.date}T${reservation.start}`).toISOString() : "";
  return earlierIso(rollingDeadline, scheduleDeadline);
}

function deadlinePassed(deadline, nowMs = Date.now()) {
  const value = new Date(deadline || "").getTime();
  return Number.isFinite(value) && value < nowMs;
}

function releaseOpenPayment(payment, status, reason) {
  if (!payment || CLOSED_PAYMENT_STATUSES.includes(payment.status)) return;
  payment.status = status;
  payment.rejectionReason = reason;
}

function resetRouteSteps(steps = []) {
  const firstSequence = Math.min(...steps.map((step) => Number(step.sequence || 1)));
  return steps.map((step) => ({
    ...step,
    status: Number(step.sequence || 1) === firstSequence ? "Pending" : "Waiting",
    decidedBy: "",
    decidedAt: "",
    reason: ""
  }));
}

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
    if (!reservation?.date || !reservation?.end || RESOLVED_RESERVATION_STATUSES.includes(reservation.status) || ["Confirmed", "In Use"].includes(reservation.status)) return false;
    const endMs = reservationEndMs(reservation);
    return endMs !== null && endMs < Date.now();
  },

  applyReservationLifecycle() {
    let changed = 0;
    const currentMs = Date.now();
    for (const reservation of this.data.reservations) {
      const payment = this.data.payments.find((item) => item.id === reservation.paymentId || item.reservationId === reservation.id);
      if (payment && !payment.paymentDeadlineAt && payment.status === "Awaiting Receipt") {
        const resource = this.data.resources.find((item) => item.id === reservation.resourceId);
        payment.paymentDeadlineHours = normalizePaymentDeadlineHours(
          payment.paymentDeadlineHours,
          effectivePaymentDeadlineHours(resource, this.settings)
        );
        payment.paymentDeadlineAt = paymentDeadlineFor(reservation, payment, nowIso(), payment.paymentDeadlineHours);
        changed += 1;
      }
      const endMs = reservationEndMs(reservation);
      if (["Confirmed", "In Use"].includes(reservation.status) && endMs !== null && endMs < currentMs) {
        reservation.status = "Completed";
        reservation.completedAt = nowLabel();
        this.addNotification(reservation.requester, `${reservation.resourceName} was completed after its scheduled use.`, "Reservation");
        this.addActivity("Reservation completed", "System", reservation.resourceName, reservation.id, reservation.id);
        changed += 1;
        continue;
      }
      const paymentExpired = reservation.status === "For Payment" && payment?.status === "Awaiting Receipt" && deadlinePassed(payment.paymentDeadlineAt, currentMs);
      if (!paymentExpired && !this.isReservationOverdue(reservation)) {
        this.sendReservationReminders(reservation, payment, currentMs);
        continue;
      }
      reservation.status = "Expired";
      reservation.expiredAt = nowLabel();
      reservation.expiryReason = paymentExpired
        ? "Payment deadline passed before final confirmation."
        : "Scheduled end time passed before final confirmation.";
      reservation.approvalSteps = (reservation.approvalSteps || []).map((step) =>
        ["Pending", "Waiting"].includes(step.status) ? { ...step, status: "Skipped" } : step
      );
      if (payment && ACTIVE_PAYMENT_STATUSES.includes(payment.status)) releaseOpenPayment(payment, "Expired", "Reservation expired before final confirmation.");
      this.addNotification(
        reservation.requester,
        `${reservation.resourceName} expired because ${paymentExpired ? "the payment deadline passed" : "the scheduled time passed before final confirmation"}.`,
        "Reservation"
      );
      this.addNotification(
        reservation.office,
        `${reservation.resourceName}: ${reservation.requester}'s request expired before final confirmation.`,
        "Reservation"
      );
      this.addActivity("Reservation expired", "System", reservation.resourceName, reservation.id, reservation.id);
      changed += 1;
    }
    return changed;
  },

  expireOverdueReservations() {
    return this.applyReservationLifecycle();
  },

  sendReservationReminders(reservation, payment, currentMs = Date.now()) {
    if (reservation.status === "For Payment" && payment?.status === "Awaiting Receipt" && !payment.paymentReminderSentAt) {
      payment.paymentReminderSentAt = nowLabel();
      this.addNotification(reservation.requester, `${reservation.resourceName} is awaiting receipt upload before ${payment.paymentDeadlineAt || "the payment deadline"}.`, "Payment");
      return true;
    }
    if (REVIEW_STATUSES.includes(reservation.status) && !reservation.reviewReminderSentAt) {
      const submitted = new Date(reservation.submittedAt || reservation.createdAt || "").getTime();
      if (Number.isFinite(submitted) && currentMs - submitted > 24 * 60 * 60 * 1000) {
        reservation.reviewReminderSentAt = nowLabel();
        this.addNotification(reservation.office, `${reservation.resourceName} has been waiting for review for more than 24 hours.`, "Approval");
        return true;
      }
    }
    if (reservation.status === "Confirmed" && !reservation.upcomingReminderSentAt) {
      const start = reservationStartMs(reservation);
      if (start && start > currentMs && start - currentMs <= 24 * 60 * 60 * 1000) {
        reservation.upcomingReminderSentAt = nowLabel();
        this.addNotification(reservation.requester, `${reservation.resourceName} is scheduled within the next 24 hours.`, "Reservation");
        return true;
      }
    }
    return false;
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
    if (this.currentUser.requesterType === "Student" && resource.type !== "Equipment") {
      throw new Error("Student accounts may only reserve Equipment resources.");
    }
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
      resourceAssetTag: resource.assetTag,
      office: resource.office,
      type: resource.type,
      date,
      start,
      end,
      quantity,
      purpose,
      driverChoice: resource.type === "Vehicle" ? (values.driverChoice || "Without Driver") : "Not applicable",
      ...requestDetails,
      status: "Under Owner Review",
      submittedAt: nowLabel(),
      requiresPayment: resource.requiresPayment,
      workflowTemplateId: template?.id || "WF-BASIC",
      workflowName: template?.name || "Basic Resource Approval",
      rescheduleCount: 0,
      approvalSteps: buildApprovalSteps(template, resource, requestDetails, id)
    };

    this.data.reservations.unshift(reservation);
    this.addNotification(this.currentUser.name, `${resource.name} request was submitted and routed to ${resource.office}.`, "Reservation");
    this.addNotification(resource.office, `${resource.name}: new reservation request from ${this.currentUser.name} needs review.`, "Reservation");
    this.addActivity("Reservation submitted", this.currentUser.name, resource.name, `${date} ${start}-${end}`, reservation.id);
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
      const paymentDeadlineHours = effectivePaymentDeadlineHours(resource, this.settings);
      const createdAt = nowIso();
      reservation.paymentId = paymentId;
      this.data.payments.unshift({
        id: paymentId,
        reservationId: reservation.id,
        requester: reservation.requester,
        office: reservation.office,
        amount: resource?.fee || 0,
        receipt: "Awaiting upload",
        status: "Awaiting Receipt",
        createdAt,
        paymentDeadlineHours,
        paymentDeadlineAt: paymentDeadlineFor(reservation, null, createdAt, paymentDeadlineHours)
      });
    }
    this.addNotification(
      reservation.requester,
      `${reservation.resourceName}: ${step.name} was approved by ${this.currentUser.name}. Current status: ${reservation.status}${reservation.status === "For Payment" ? " - upload your receipt to continue." : "."}`,
      "Approval"
    );
    this.addActivity("Approval step approved", this.currentUser.name, `${reservation.resourceName}: ${step.name}`, reservation.id, reservation.id);
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
    this.addActivity("Approval step rejected", this.currentUser.name, `${reservation.resourceName}: ${step.name}`, cleanReason, reservation.id);
    await this.save(() => awsApi.decideReservation(id, step.id, false, cleanReason), previousData);
  },

  async cancelReservation(id, reason = "Cancelled by requester") {
    this.requireRole("requester");
    const reservation = this.data.reservations.find((item) => item.id === id);
    if (!reservation || reservation.requester !== this.currentUser.name) throw new Error("This reservation does not belong to your account.");
    if (!REQUESTER_MUTABLE_STATUSES.includes(reservation.status)) throw new Error("Only active upcoming reservations can be cancelled.");
    if (reservationStartMs(reservation) <= Date.now()) throw new Error("Reservations cannot be cancelled after the scheduled start time.");
    const cleanReason = requireText(reason, "Cancellation reason", 8);
    const previousData = this.snapshot();
    reservation.status = "Cancelled";
    reservation.cancelledAt = nowLabel();
    reservation.cancelledBy = this.currentUser.name;
    reservation.cancellationReason = cleanReason;
    reservation.approvalSteps = (reservation.approvalSteps || []).map((step) =>
      ["Pending", "Waiting"].includes(step.status) ? { ...step, status: "Skipped" } : step
    );
    releaseOpenPayment(this.data.payments.find((item) => item.id === reservation.paymentId || item.reservationId === reservation.id), "Cancelled", cleanReason);
    this.addNotification(reservation.office, `${reservation.resourceName}: ${reservation.requester} cancelled the reservation. Reason: ${cleanReason}`, "Reservation");
    this.addActivity("Reservation cancelled", this.currentUser.name, reservation.resourceName, cleanReason, reservation.id);
    await this.save(() => awsApi.cancelReservation(id, cleanReason), previousData);
  },

  async rescheduleReservation(id, values) {
    this.requireRole("requester");
    const reservation = this.data.reservations.find((item) => item.id === id);
    if (!reservation || reservation.requester !== this.currentUser.name) throw new Error("This reservation does not belong to your account.");
    if (!REQUESTER_MUTABLE_STATUSES.includes(reservation.status)) throw new Error("Only active upcoming reservations can be rescheduled.");
    if (reservationStartMs(reservation) <= Date.now()) throw new Error("Reservations cannot be rescheduled after the scheduled start time.");
    const date = requireReservationLeadDate(values.date);
    const start = cleanText(values.start);
    const end = cleanText(values.end);
    if (!start || !end) throw new Error("Start and end time are required.");
    if (start >= end) throw new Error("End time must be later than start time.");
    if (this.hasConflict(reservation.resourceId, date, start, end, reservation.id)) {
      throw new Error("That resource already has an overlapping reservation request.");
    }
    const previousData = this.snapshot();
    const previousSchedule = `${reservation.date} ${reservation.start}-${reservation.end}`;
    reservation.date = date;
    reservation.start = start;
    reservation.end = end;
    reservation.status = "Under Owner Review";
    reservation.rescheduleCount = Number(reservation.rescheduleCount || 0) + 1;
    reservation.rescheduledAt = nowLabel();
    reservation.approvalSteps = resetRouteSteps(reservation.approvalSteps);
    releaseOpenPayment(this.data.payments.find((item) => item.id === reservation.paymentId || item.reservationId === reservation.id), "Cancelled", "Reservation was rescheduled and sent back for approval.");
    reservation.paymentId = "";
    this.addNotification(reservation.office, `${reservation.resourceName}: ${reservation.requester} requested a reschedule from ${previousSchedule} to ${date} ${start}-${end}.`, "Reservation");
    this.addActivity("Reservation rescheduled", this.currentUser.name, reservation.resourceName, `${previousSchedule} -> ${date} ${start}-${end}`, reservation.id);
    await this.save(() => awsApi.rescheduleReservation(id, { date, start, end }), previousData);
  },

  async updateReservationLifecycleStatus(id, status, reason = "") {
    this.requireRole("officeAdmin", "superAdmin");
    const reservation = this.data.reservations.find((item) => item.id === id);
    if (!reservation) return;
    if (this.session.activeRole === "officeAdmin") this.requireOfficeRecord(reservation);
    const cleanReason = ["No Show", ...ADMIN_OVERRIDE_STATUSES].includes(status) ? requireText(reason, "Reason", 8) : cleanText(reason);
    const previousData = this.snapshot();
    if (status === "In Use") {
      if (reservation.status !== "Confirmed") throw new Error("Only confirmed reservations can be marked in use.");
      reservation.status = "In Use";
      reservation.startedAt = nowLabel();
    } else if (status === "Completed") {
      if (!["Confirmed", "In Use"].includes(reservation.status)) throw new Error("Only confirmed or in-use reservations can be completed.");
      reservation.status = "Completed";
      reservation.completedAt = nowLabel();
    } else if (status === "No Show") {
      if (reservation.status !== "Confirmed") throw new Error("Only confirmed reservations can be marked no-show.");
      if (reservationStartMs(reservation) > Date.now()) throw new Error("No-show can only be recorded after the scheduled start time.");
      reservation.status = "No Show";
      reservation.noShowAt = nowLabel();
      reservation.noShowReason = cleanReason;
    } else if (ADMIN_OVERRIDE_STATUSES.includes(status)) {
      if (RESOLVED_RESERVATION_STATUSES.includes(reservation.status)) throw new Error("This reservation is already closed.");
      reservation.status = status;
      reservation.overrideAt = nowLabel();
      reservation.overrideBy = this.currentUser.name;
      reservation.overrideReason = cleanReason;
      reservation.approvalSteps = (reservation.approvalSteps || []).map((step) =>
        ["Pending", "Waiting"].includes(step.status) ? { ...step, status: "Skipped" } : step
      );
      releaseOpenPayment(this.data.payments.find((item) => item.id === reservation.paymentId || item.reservationId === reservation.id), status, cleanReason);
    } else {
      throw new Error("Unsupported reservation status update.");
    }
    this.addNotification(reservation.requester, `${reservation.resourceName} status changed to ${status}${cleanReason ? `. Reason: ${cleanReason}` : "."}`, "Reservation");
    this.addActivity(`Reservation marked ${status}`, this.currentUser.name, reservation.resourceName, cleanReason, reservation.id);
    await this.save(() => awsApi.updateReservationStatus(id, status, cleanReason), previousData);
  },

  reservationDriver(reservationId) {
    return this.data.reservationDrivers.find((item) => item.reservationId === reservationId && item.status === "Assigned") || null;
  },

  availableDriversForOffice(office) {
    return this.data.drivers.filter((item) => item.office === office && item.status === "Available");
  },

  async assignDriver(reservationId, driverId) {
    this.requireRole("officeAdmin", "superAdmin");
    const reservation = this.data.reservations.find((item) => item.id === reservationId);
    if (!reservation) return;
    if (this.session.activeRole === "officeAdmin") this.requireOfficeRecord(reservation);
    const resource = this.data.resources.find((item) => item.id === reservation.resourceId);
    if (!resource || resource.type !== "Vehicle" || resource.driver !== "With Driver") {
      throw new Error("This reservation does not require a driver.");
    }
    const driver = this.data.drivers.find((item) => item.id === driverId);
    if (!driver) throw new Error("Driver not found.");
    if (driver.status !== "Available") throw new Error("This driver is not available.");
    const previousData = this.snapshot();
    this.data.reservationDrivers = this.data.reservationDrivers.filter((item) => !(item.reservationId === reservationId && item.status === "Assigned"));
    this.data.reservationDrivers.unshift({
      id: `RD-${Date.now()}`,
      reservationId,
      driverId: driver.id,
      driverName: driver.name,
      vehicleResourceId: resource.id,
      office: reservation.office,
      status: "Assigned",
      assignedAt: nowLabel(),
      assignedBy: this.currentUser.name
    });
    this.addActivity("Driver assigned", this.currentUser.name, `${reservation.resourceName}: ${driver.name}`, "", reservationId);
    await this.save(() => awsApi.assignDriver(reservationId, driverId), previousData);
  },

  async unassignDriver(reservationId) {
    this.requireRole("officeAdmin", "superAdmin");
    const reservation = this.data.reservations.find((item) => item.id === reservationId);
    if (!reservation) return;
    if (this.session.activeRole === "officeAdmin") this.requireOfficeRecord(reservation);
    const previousData = this.snapshot();
    const assignment = this.data.reservationDrivers.find((item) => item.reservationId === reservationId && item.status === "Assigned");
    if (assignment) {
      assignment.status = "Unassigned";
      assignment.unassignedAt = nowLabel();
      assignment.unassignedBy = this.currentUser.name;
      this.addActivity("Driver unassigned", this.currentUser.name, `${reservation.resourceName}: ${assignment.driverName}`, "", reservationId);
    }
    await this.save(() => awsApi.unassignDriver(reservationId), previousData);
  }
};
