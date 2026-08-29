import { ROLE_IDS, USERS } from "./config.js";
import {
  loadDatabase,
  loadResourceAvailability,
  loadSession,
  loginLocalAccount,
  logoutLocalAccount,
  markLocalNotificationsRead,
  resetDatabase,
  restoreLocalAccount,
  saveDatabase,
  saveSession
} from "./api.js";
import { awsApi, awsBackendConfigured, hasSsoAccessToken, setSsoAccessToken } from "./awsApi.js";
import { DEFAULT_DATA } from "./defaultData.js";
import { clone, compareDateTime, nextId, nowLabel, todayIso, tomorrowIso } from "./utils.js";
import { buildApprovalSteps, decideApprovalStep, hydrateLegacyReservation, pendingApprovalSteps, REQUIREMENT_OPTIONS } from "./workflows.js";

const BLOCKING_RESERVATION_STATUSES = ["Under Owner Review", "Under Additional Review", "Approved", "Confirmed", "For Payment"];
const RESOLVED_RESERVATION_STATUSES = ["Confirmed", "Rejected", "Cancelled", "Completed"];
const MAX_RECEIPT_PREVIEW_BYTES = 700_000;
const BUSINESS_DAY_START = 8 * 60;
const BUSINESS_DAY_END = 17 * 60;
const DEFAULT_SLOT_MINUTES = 60;

function cleanText(value) {
  return String(value || "").trim();
}

function requireText(value, label, minimum = 1) {
  const text = cleanText(value);
  if (text.length < minimum) {
    throw new Error(minimum > 1 ? `${label} must be at least ${minimum} characters.` : `${label} is required.`);
  }
  return text;
}

function requireFutureDate(value, label) {
  const date = cleanText(value);
  if (!date) throw new Error(`${label} is required.`);
  if (date < todayIso()) throw new Error(`${label} cannot be in the past.`);
  return date;
}

function requireReservationLeadDate(value) {
  const date = requireFutureDate(value, "Reservation date");
  if (date < tomorrowIso()) throw new Error("Reservations must be submitted at least one day before the time of use.");
  return date;
}

function validPositiveNumber(value, label, minimum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) throw new Error(`${label} must be at least ${minimum}.`);
  return number;
}

function toMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

function fromMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function selectedDuration(start, end) {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return DEFAULT_SLOT_MINUTES;
  return Math.min(endMinutes - startMinutes, 12 * 60);
}

function addDaysIso(date, days) {
  const value = date || tomorrowIso();
  const next = new Date(`${value}T00:00:00`);
  next.setDate(next.getDate() + days);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 10);
}

function isUstSsoEmail(email) {
  return /^[^\s@]+@ust\.edu\.ph$/i.test(email);
}

function defaultRequirementOptions() {
  return REQUIREMENT_OPTIONS.map((option) => ({ ...option, status: "Active", locked: true }));
}

function notificationWithOffice(notification, offices) {
  if (notification.office) return notification;
  const message = String(notification.message || "");
  const office = offices.find((item) =>
    message.includes(item.name) && /(routed to|needs review|verification|uploaded a receipt)/i.test(message)
  );
  return office ? { ...notification, office: office.name } : notification;
}

export class ReservataStore {
  constructor() {
    this.data = clone(DEFAULT_DATA);
    this.session = loadSession();
    this.apiAvailable = false;
    this.backendMode = "local";
    this.cloudUser = null;
    this.localUser = null;
  }

  async init() {
    if (awsBackendConfigured) {
      this.backendMode = "aws";
      if (!hasSsoAccessToken()) {
        this.session.activeRole = null;
        this.session.activeView = "dashboard";
        saveSession(this.session);
        return;
      }
      const result = await awsApi.bootstrap();
      this.setData(result.data);
      this.cloudUser = result.user;
      this.apiAvailable = true;
      const role = ROLE_IDS[result.user.role];
      if (!role) throw new Error("The authenticated account has an unsupported RESERVATA role.");
      this.session.activeRole = role;
      this.session.activeView = USERS[role].home;
      saveSession(this.session);
      return;
    }
    this.localUser = await restoreLocalAccount();
    if (!this.localUser) {
      this.session.activeRole = null;
      this.session.activeView = "dashboard";
      saveSession(this.session);
      return;
    }
    this.applyAuthenticatedUser(this.localUser);
    const result = await loadDatabase();
    this.setData(result.data);
    this.apiAvailable = result.apiAvailable;
  }

  applyAuthenticatedUser(user) {
    const role = ROLE_IDS[user.role];
    if (!role) throw new Error("The authenticated account has an unsupported RESERVATA role.");
    this.session.activeRole = role;
    this.session.activeView = USERS[role].home;
    saveSession(this.session);
  }

  async login(email, password) {
    if (this.backendMode === "aws") throw new Error("Use University SSO to sign in.");
    this.localUser = await loginLocalAccount(email, password);
    this.applyAuthenticatedUser(this.localUser);
    const result = await loadDatabase();
    this.setData(result.data);
    this.apiAvailable = result.apiAvailable;
  }

  setData(data) {
    this.data = { ...clone(DEFAULT_DATA), ...data };
    this.data.systemSettings = this.data.systemSettings.length
      ? this.data.systemSettings.map((item, index) => ({
        ...item,
        id: item.id || (index === 0 ? "SYSTEM" : nextId("SET")),
        requirementOptions: item.requirementOptions?.length ? item.requirementOptions : defaultRequirementOptions()
      }))
      : [{ id: "SYSTEM", requirementOptions: defaultRequirementOptions() }];
    this.data.resources = this.data.resources.map((item) => ({ ...item, workflowTemplateId: item.workflowTemplateId || "WF-BASIC" }));
    this.data.reservations = this.data.reservations.map(hydrateLegacyReservation);
    this.data.notifications = this.data.notifications.map((item) => notificationWithOffice(item, this.data.offices));
  }

  get settings() {
    if (!this.data.systemSettings.length) {
      this.data.systemSettings.push({ id: "SYSTEM", requirementOptions: defaultRequirementOptions() });
    }
    const settings = this.data.systemSettings[0];
    if (!settings.requirementOptions?.length) settings.requirementOptions = defaultRequirementOptions();
    return settings;
  }

  get allRequirementOptions() {
    return this.settings.requirementOptions;
  }

  get requirementOptions() {
    return this.allRequirementOptions.filter((item) => item.status !== "Archived");
  }

  get currentUser() {
    if (this.backendMode === "aws" && this.cloudUser) {
      const role = ROLE_IDS[this.cloudUser.role];
      return {
        ...USERS[role],
        name: this.cloudUser.name,
        initials: this.cloudUser.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
        roleLabel: this.cloudUser.role,
        office: this.cloudUser.office,
        email: this.cloudUser.email
      };
    }
    if (this.backendMode === "local" && this.localUser) {
      const role = ROLE_IDS[this.localUser.role];
      return {
        ...USERS[role],
        name: this.localUser.name,
        initials: this.localUser.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
        roleLabel: this.localUser.role,
        office: this.localUser.office,
        email: this.localUser.email
      };
    }
    return USERS[this.session.activeRole] || USERS.requester;
  }

  get officeScope() {
    if (this.session.activeRole === "superAdmin") return null;
    if (this.session.activeRole === "osgAdmin") return "OSG";
    return this.currentUser.office.replace(" Office", "");
  }

  get officeReservations() {
    if (!this.officeScope) return this.data.reservations;
    return this.data.reservations.filter((reservation) =>
      reservation.office === this.officeScope || reservation.approvalSteps?.some((step) => step.office === this.officeScope)
    );
  }

  get actionableReservations() {
    if (!["officeAdmin", "osgAdmin"].includes(this.session.activeRole)) return [];
    return this.data.reservations.filter((reservation) => pendingApprovalSteps(reservation, this.officeScope).length > 0);
  }

  get actionableApprovalCount() {
    return this.actionableReservations.reduce(
      (total, reservation) => total + pendingApprovalSteps(reservation, this.officeScope).length,
      0
    );
  }

  get officeResources() {
    if (!this.officeScope) return this.data.resources;
    return this.data.resources.filter((resource) => resource.office === this.officeScope);
  }

  get officePayments() {
    if (!this.officeScope) return this.data.payments;
    return this.data.payments.filter((payment) => {
      if (payment.office) return payment.office === this.officeScope;
      const reservation = this.data.reservations.find((item) => item.id === payment.reservationId);
      return reservation?.office === this.officeScope;
    });
  }

  get visibleNotifications() {
    return this.data.notifications.filter((notification) => this.canSeeNotification(notification));
  }

  canSeeNotification(notification) {
    if (this.session.activeRole === "superAdmin") return true;
    if (["requester", "osgRequester"].includes(this.session.activeRole)) return notification.user === this.currentUser.name;
    return notification.user === this.currentUser.name || notification.office === this.officeScope || notification.user === this.officeScope;
  }

  get visibleActivity() {
    if (this.session.activeRole !== "officeAdmin") return this.data.activity;
    const officeTargets = new Set([
      ...this.officeReservations.map((reservation) => reservation.resourceName),
      ...this.officeResources.map((resource) => resource.name),
      ...this.officePayments.map((payment) => payment.reservationId)
    ]);
    return this.data.activity.filter((item) => officeTargets.has(item.target) || item.actor === this.currentUser.name);
  }

  setView(view) {
    this.session.activeView = view;
    saveSession(this.session);
  }

  async logout() {
    if (this.backendMode === "aws") {
      setSsoAccessToken(null);
      this.cloudUser = null;
    } else {
      await logoutLocalAccount();
      this.localUser = null;
    }
    this.session.activeRole = null;
    this.session.activeView = "dashboard";
    saveSession(this.session);
  }

  async reset() {
    this.requireRole("superAdmin");
    if (this.backendMode === "aws") throw new Error("Cloud data cannot be reset from the demonstration control.");
    this.setData(await resetDatabase(this.apiAvailable));
    await this.save();
  }

  async save(cloudOperation, previousData) {
    if (this.backendMode === "aws") {
      try {
        await cloudOperation();
        const result = await awsApi.bootstrap();
        this.setData(result.data);
        this.cloudUser = result.user;
      } catch (error) {
        if (previousData) this.data = previousData;
        throw error;
      }
      return;
    }
    try {
      this.apiAvailable = await saveDatabase(this.data, this.apiAvailable);
    } catch (error) {
      if (previousData) this.setData(previousData);
      throw error;
    }
  }

  snapshot() {
    return clone(this.data);
  }

  requireRole(...roles) {
    if (!roles.includes(this.session.activeRole)) {
      throw new Error("Your role is not permitted to perform this action.");
    }
  }

  requireOfficeRecord(record) {
    if (!record || record.office !== this.officeScope) {
      throw new Error("Only the office assigned to this request can approve or verify this record.");
    }
  }

  addNotification(user, message, type = "Info") {
    const office = this.data.offices.find((item) => item.name === user);
    this.data.notifications.unshift({
      id: nextId("N"),
      user,
      ...(office ? { office: office.name } : {}),
      message,
      type,
      unread: true,
      time: nowLabel()
    });
  }

  addActivity(action, actor, target, details = "") {
    this.data.activity.unshift({
      id: nextId("ACT"),
      action,
      actor,
      target,
      details,
      time: nowLabel()
    });
  }

  myReservations() {
    return this.data.reservations.filter((reservation) => reservation.requester === this.currentUser.name);
  }

  isReservationOverdue(reservation) {
    if (!reservation?.date || !reservation?.end || RESOLVED_RESERVATION_STATUSES.includes(reservation.status)) return false;
    return new Date(`${reservation.date}T${reservation.end}`).getTime() < Date.now();
  }

  get overdueReservations() {
    const source = this.session.activeRole === "requester" ? this.myReservations() : this.officeReservations;
    return source.filter((reservation) => this.isReservationOverdue(reservation));
  }

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
  }

  hasConflict(resourceId, date, start, end, excludeId = "") {
    return this.resourceConflicts(resourceId, date, start, end, excludeId).length > 0;
  }

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
  }

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
  }

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
  }

  async fetchResourceAvailability(resourceId, date, start, end) {
    if (this.backendMode === "aws") {
      return awsApi.resourceAvailability(resourceId, date, start, end);
    }
    if (this.apiAvailable) {
      return loadResourceAvailability(resourceId, date, start, end);
    }
    return this.resourceAvailability(resourceId, date, start, end);
  }

  upcomingReservations(resourceId, limit = 5) {
    return this.data.reservations
      .filter((reservation) => reservation.resourceId === resourceId && BLOCKING_RESERVATION_STATUSES.includes(reservation.status))
      .sort((left, right) => compareDateTime(left.date, left.start, right.date, right.start))
      .slice(0, limit);
  }

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
  }

  approvalStep(reservation, stepId) {
    const step = stepId
      ? reservation.approvalSteps?.find((item) => item.id === stepId)
      : pendingApprovalSteps(reservation, this.officeScope)[0];
    if (!step || step.office !== this.officeScope || step.status !== "Pending") {
      throw new Error("No active approval step is assigned to your office.");
    }
    return step;
  }

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
  }

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

  async uploadReceipt(id, file) {
    this.requireRole("requester");
    if (!file) throw new Error("Select a receipt file first.");
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      throw new Error("Receipt must be a JPG, PNG, or PDF file.");
    }
    if (file.size > MAX_RECEIPT_PREVIEW_BYTES && file.previewData) {
      throw new Error("Receipt preview must be under 700 KB for the local demo.");
    }
    const reservation = this.data.reservations.find((item) => item.id === id);
    if (!reservation || reservation.requester !== this.currentUser.name) {
      throw new Error("This reservation does not belong to your account.");
    }
    const previousData = this.snapshot();
    const payment = this.data.payments.find((item) => item.id === reservation?.paymentId);
    if (payment) {
      payment.receipt = file?.name || `uploaded-${reservation.id}.jpg`;
      payment.receiptType = file?.type || "";
      payment.receiptPreview = file?.previewData || "";
      payment.rejectionReason = "";
      payment.status = "Pending Verification";
    }
    this.addNotification(reservation.office, `${reservation.resourceName}: ${reservation.requester} uploaded a receipt for verification.`, "Payment");
    this.addActivity("Payment receipt uploaded", this.currentUser.name, reservation?.resourceName || id, payment?.receipt || "");
    await this.save(() => awsApi.uploadReceipt(payment?.id, file), previousData);
  }

  async uploadSupportingDocument(id, file) {
    this.requireRole("requester");
    if (!file) throw new Error("Select a supporting document first.");
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      throw new Error("Supporting documents must be JPG, PNG, or PDF files.");
    }
    if (file.size > MAX_RECEIPT_PREVIEW_BYTES && file.previewData) {
      throw new Error("Document preview must be under 700 KB for the local demo.");
    }
    const reservation = this.data.reservations.find((item) => item.id === id);
    if (!reservation || reservation.requester !== this.currentUser.name) {
      throw new Error("This reservation does not belong to your account.");
    }
    const previousData = this.snapshot();
    const document = {
      id: nextId("DOC"),
      name: file.name || `supporting-document-${reservation.id}.pdf`,
      type: file.type || "",
      size: file.size || 0,
      previewData: file.previewData || "",
      uploadedAt: nowLabel(),
      status: "Submitted"
    };
    reservation.supportingDocuments = [document, ...(reservation.supportingDocuments || [])];
    this.addNotification(reservation.office, `${reservation.resourceName}: ${reservation.requester} uploaded a supporting document.`, "Reservation");
    this.addActivity("Supporting document uploaded", this.currentUser.name, reservation.resourceName, document.name);
    await this.save(() => awsApi.uploadSupportingDocument(reservation.id, file), previousData);
  }

  async verifyPayment(id, verified, reason = "") {
    this.requireRole("officeAdmin");
    const payment = this.data.payments.find((item) => item.id === id);
    if (!payment) return;
    const reservation = this.data.reservations.find((item) => item.id === payment.reservationId);
    this.requireOfficeRecord(reservation);
    const cleanReason = verified ? "" : requireText(reason, "Receipt rejection reason", 8);
    const previousData = this.snapshot();
    payment.status = verified ? "Verified" : "Rejected";
    payment.rejectionReason = cleanReason;
    if (reservation) reservation.status = verified ? "Confirmed" : "Rejected";
    if (reservation) {
      reservation.rejectionReason = cleanReason;
      this.addNotification(
        reservation.requester,
        verified ? `${reservation.resourceName}: payment verified by ${this.currentUser.name}. The reservation is confirmed.` : `${reservation.resourceName}: payment receipt was rejected by ${this.currentUser.name}. Reason: ${cleanReason}`,
        "Payment"
      );
    }
    this.addActivity(verified ? "Payment verified" : "Payment rejected", this.currentUser.name, payment.reservationId, cleanReason || payment.receipt);
    await this.save(() => awsApi.verifyPayment(id, verified, cleanReason), previousData);
  }

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
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  async saveWorkflow(template, id = "") {
    this.requireRole("superAdmin");
    const name = String(template.name || "").trim();
    const steps = (template.steps || []).map((step, index) => ({
      id: step.id || `STEP-${index + 1}`,
      name: String(step.name || "").trim(),
      office: step.office,
      sequence: Number(step.sequence || 1),
      condition: step.condition || "always"
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
  }

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
    await this.save(() => Promise.resolve(), previousData);
  }

  async archiveRequirementOption(id) {
    this.requireRole("superAdmin");
    const option = this.allRequirementOptions.find((item) => item.id === id);
    if (!option) throw new Error("Requirement not found.");
    const previousData = this.snapshot();
    option.status = "Archived";
    this.addActivity("Requirement archived", this.currentUser.name, option.label);
    await this.save(() => Promise.resolve(), previousData);
  }

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
  }

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
    if (this.data.people.some((item) => item.email.toLowerCase() === email)) throw new Error("That SSO email already has a RESERVATA account.");
    if (office !== "All Offices" && !this.data.offices.some((item) => item.name === office && item.status === "Active")) {
      throw new Error("Assign the user to an active office.");
    }
    const previousData = this.snapshot();
    const person = { name, email, office, role, status };
    this.data.people.push(person);
    this.addActivity("User account created", this.currentUser.name, person.name);
    await this.save(() => awsApi.createUser(person), previousData);
  }

  async updateUserRole(email, role) {
    this.requireRole("superAdmin");
    if (email === this.currentUser.email) throw new Error("You cannot change your own role while signed in.");
    const person = this.data.people.find((item) => item.email === email);
    if (!person) return;
    if (!ROLE_IDS[role]) throw new Error("Unsupported role.");
    const previousData = this.snapshot();
    person.role = role;
    this.addActivity("User role updated", this.currentUser.name, person.name);
    await this.save(() => awsApi.updateUserRole(email, person.role), previousData);
  }

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

  async submitVisitor(values) {
    this.requireRole("osgRequester");
    const visitorName = requireText(values.visitor, "Visitor / group name", 3);
    const organization = requireText(values.organization, "Organization", 2);
    const visitDate = requireFutureDate(values.visitDate, "Visit date");
    const visitTime = cleanText(values.visitTime);
    if (!visitTime) throw new Error("Arrival time is required.");
    const guests = validPositiveNumber(values.guests, "Guest count");
    const cars = Number(values.cars || 0);
    if (!Number.isFinite(cars) || cars < 0) throw new Error("Vehicle count cannot be negative.");
    if (cars > 0 && !cleanText(values.plate)) throw new Error("Plate numbers are required when visitor parking is requested.");
    const purpose = requireText(values.visitorPurpose, "Purpose", 10);
    const previousData = this.snapshot();
    const visitor = {
      id: nextId("VIS", this.data.visitors),
      requester: this.currentUser.name,
      visitor: visitorName,
      organization,
      purpose,
      date: visitDate,
      time: visitTime,
      guests,
      cars,
      plate: cleanText(values.plate),
      parking: "",
      status: "Pending"
    };
    this.data.visitors.unshift(visitor);
    this.addNotification(this.currentUser.name, `${visitor.visitor}: visitor access request submitted to OSG for review.`, "Visitor");
    this.addActivity("Visitor request submitted", this.currentUser.name, visitor.visitor, `${visitDate} ${visitTime}`);
    await this.save(() => awsApi.createVisitor({
      visitor: visitorName,
      organization,
      purpose,
      date: visitDate,
      time: visitTime,
      guests,
      cars,
      plate: cleanText(values.plate)
    }), previousData);
  }

  async approveVisitor(id, approved, reason = "") {
    this.requireRole("osgAdmin");
    const visitor = this.data.visitors.find((item) => item.id === id);
    if (!visitor) return;
    const cleanReason = approved ? "" : requireText(reason, "Decline reason", 8);
    const previousData = this.snapshot();
    visitor.status = approved ? "Approved" : "Rejected";
    visitor.rejectionReason = cleanReason;
    if (approved && !visitor.parking && Number(visitor.cars) > 0) visitor.parking = this.nextOpenBay();
    this.addNotification(
      visitor.requester,
      approved ? `${visitor.visitor}: visitor access approved${visitor.parking ? ` with parking bay ${visitor.parking}` : ""}.` : `${visitor.visitor}: visitor access request declined by OSG. Reason: ${cleanReason}`,
      "Visitor"
    );
    this.addActivity(approved ? "Visitor request approved" : "Visitor request declined", this.currentUser.name, visitor.visitor, cleanReason || visitor.parking);
    await this.save(() => awsApi.decideVisitor(id, approved, cleanReason), previousData);
  }

  async checkInVisitor(id) {
    this.requireRole("osgAdmin");
    const visitor = this.data.visitors.find((item) => item.id === id);
    if (!visitor) return;
    const previousData = this.snapshot();
    visitor.status = "Arrived";
    this.addActivity("Visitor arrival recorded", this.currentUser.name, visitor.visitor);
    this.addNotification(visitor.requester, `${visitor.visitor}: arrival has been recorded by OSG.`, "Visitor");
    await this.save(() => awsApi.checkInVisitor(id), previousData);
  }

  async allocateBay(bay) {
    this.requireRole("osgAdmin");
    const visitor = this.data.visitors.find((item) => item.status === "Approved" && !item.parking);
    if (!visitor) throw new Error("No approved visitor is waiting for a parking bay.");
    const previousData = this.snapshot();
    visitor.parking = bay;
    this.addActivity("Parking allocated", this.currentUser.name, `${visitor.visitor}: ${bay}`);
    this.addNotification(visitor.requester, `${visitor.visitor}: parking bay ${bay} has been assigned.`, "Visitor");
    await this.save(() => awsApi.allocateParking(visitor.id, bay), previousData);
  }

  async markNotificationsRead() {
    this.requireRole("requester", "officeAdmin", "superAdmin", "osgAdmin", "osgRequester");
    const previousData = this.snapshot();
    this.visibleNotifications.forEach((notification) => {
      notification.unread = false;
    });
    if (this.backendMode === "aws") {
      await this.save(() => awsApi.markNotificationsRead(), previousData);
      return;
    }
    try {
      if (this.apiAvailable) this.setData(await markLocalNotificationsRead());
      else this.apiAvailable = await saveDatabase(this.data, this.apiAvailable);
    } catch (error) {
      this.data = previousData;
      throw error;
    }
  }

  async markNotificationRead(id) {
    this.requireRole("requester", "officeAdmin", "superAdmin", "osgAdmin", "osgRequester");
    const notification = this.visibleNotifications.find((item) => item.id === id);
    if (!notification || !notification.unread) return;
    const previousData = this.snapshot();
    notification.unread = false;
    if (this.backendMode === "aws") {
      await this.save(() => awsApi.markNotificationRead(id), previousData);
      return;
    }
    try {
      if (this.apiAvailable) this.setData(await markLocalNotificationsRead(id));
      else this.apiAvailable = await saveDatabase(this.data, this.apiAvailable);
    } catch (error) {
      this.data = previousData;
      throw error;
    }
  }

  nextOpenBay() {
    for (let index = 0; index < 20; index += 1) {
      const bay = `${String.fromCharCode(65 + Math.floor(index / 5))}${(index % 5) + 1}`;
      if (!this.data.visitors.some((visitor) => String(visitor.parking || "").includes(bay))) return bay;
    }
    return "";
  }
}
