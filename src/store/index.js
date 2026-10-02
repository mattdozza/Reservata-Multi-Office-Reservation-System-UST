import { ROLE_IDS, USERS } from "../config.js";
import {
  loadDatabase,
  loadSession,
  logoutLocalAccount,
  restoreLocalAccount,
  saveDatabase,
  saveSession
} from "../services/api.js";
import { awsApi, awsBackendConfigured, hasSsoAccessToken, setSsoAccessToken } from "../services/awsApi.js";
import { DEFAULT_DATA } from "../data/defaultData.js";
import { clone, nextId, nowLabel } from "../shared/utils.js";
import { hydrateLegacyReservation } from "../domain/workflows.js";
import { adminMethods } from "./admin.js";
import { notificationMethods } from "./notifications.js";
import { paymentMethods } from "./payments.js";
import { reservationMethods } from "./reservations.js";
import { resourceMethods } from "./resources.js";
import { DEFAULT_PAYMENT_INSTRUCTIONS, DEFAULT_PAYMENT_STEPS, normalizeAssetTag, normalizePaymentDeadlineHours, normalizePaymentInstructions, normalizePaymentSteps, normalizeResourceTags, uniqueNotifications } from "./shared.js";
import { visitorMethods } from "./visitors.js";

export class ReservataStore {
  constructor() {
    this.data = clone(DEFAULT_DATA);
    this.session = loadSession();
    this.apiAvailable = false;
    this.backendMode = "local";
    this.cloudUser = null;
    this.localUser = null;
    this.pendingTempPassword = null;
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

  setData(data) {
    this.data = { ...clone(DEFAULT_DATA), ...data };
    this.data.systemSettings = this.data.systemSettings.length
      ? this.data.systemSettings.map((item, index) => ({
        ...item,
        id: item.id || (index === 0 ? "SYSTEM" : nextId("SET")),
        paymentDeadlineHours: normalizePaymentDeadlineHours(item.paymentDeadlineHours),
        paymentInstructions: normalizePaymentInstructions(item.paymentInstructions) || DEFAULT_PAYMENT_INSTRUCTIONS,
        paymentSteps: normalizePaymentSteps(item.paymentSteps)
      }))
      : [{ id: "SYSTEM", paymentDeadlineHours: normalizePaymentDeadlineHours(), paymentInstructions: DEFAULT_PAYMENT_INSTRUCTIONS, paymentSteps: DEFAULT_PAYMENT_STEPS }];
    this.data.resources = this.data.resources.map((item) => ({
      ...item,
      assetTag: normalizeAssetTag(item.assetTag || item.id),
      serialNumber: String(item.serialNumber || "").trim(),
      tags: normalizeResourceTags(item.tags || [item.type, item.office]),
      workflowTemplateId: item.workflowTemplateId || "WF-BASIC"
    }));
    this.data.reservations = this.data.reservations.map(hydrateLegacyReservation);
    this.data.notifications = uniqueNotifications(this.data.notifications, this.data.offices);
    this.applyReservationLifecycle?.();
  }

  get settings() {
    if (!this.data.systemSettings.length) {
      this.data.systemSettings.push({ id: "SYSTEM", paymentDeadlineHours: normalizePaymentDeadlineHours(), paymentInstructions: DEFAULT_PAYMENT_INSTRUCTIONS, paymentSteps: DEFAULT_PAYMENT_STEPS });
    }
    const settings = this.data.systemSettings[0];
    settings.paymentDeadlineHours = normalizePaymentDeadlineHours(settings.paymentDeadlineHours);
    settings.paymentInstructions = normalizePaymentInstructions(settings.paymentInstructions) || DEFAULT_PAYMENT_INSTRUCTIONS;
    settings.paymentSteps = normalizePaymentSteps(settings.paymentSteps);
    return settings;
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
        email: this.cloudUser.email,
        requesterType: this.cloudUser.requesterType || ""
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
        email: this.localUser.email,
        requesterType: this.localUser.requesterType || ""
      };
    }
    return USERS[this.session.activeRole] || USERS.requester;
  }

  get officeScope() {
    if (this.session.activeRole === "superAdmin") return null;
    if (this.session.activeRole === "osgAdmin") return "OSG";
    return this.currentUser.office.replace(" Office", "");
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

  addActivity(action, actor, target, details = "", reservationId = "") {
    this.data.activity.unshift({
      id: nextId("ACT"),
      action,
      actor,
      target,
      details,
      ...(reservationId ? { reservationId } : {}),
      time: nowLabel()
    });
  }
}

function applyStoreMethods(target, ...sources) {
  for (const source of sources) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
  }
}

applyStoreMethods(
  ReservataStore.prototype,
  reservationMethods,
  resourceMethods,
  paymentMethods,
  adminMethods,
  visitorMethods,
  notificationMethods
);
