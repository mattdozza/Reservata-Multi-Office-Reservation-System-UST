import { markLocalNotificationsRead, saveDatabase } from "../services/api.js";
import { awsApi } from "../services/awsApi.js";

export const notificationMethods = {
  get visibleNotifications() {
    return this.data.notifications.filter((notification) => this.canSeeNotification(notification));
  },

  canSeeNotification(notification) {
    if (this.session.activeRole === "superAdmin") return true;
    if (this.session.activeRole === "requester") return notification.user === this.currentUser.name;
    return notification.user === this.currentUser.name || notification.office === this.officeScope || notification.user === this.officeScope;
  },

  get visibleActivity() {
    if (this.session.activeRole !== "officeAdmin") return this.data.activity;
    const officeTargets = new Set([
      ...this.officeReservations.map((reservation) => reservation.resourceName),
      ...this.officeResources.map((resource) => resource.name),
      ...this.officePayments.map((payment) => payment.reservationId)
    ]);
    return this.data.activity.filter((item) => officeTargets.has(item.target) || item.actor === this.currentUser.name);
  },

  async markNotificationsRead() {
    this.requireRole("requester", "officeAdmin", "superAdmin", "osgAdmin");
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
  },

  async markNotificationRead(id) {
    this.requireRole("requester", "officeAdmin", "superAdmin", "osgAdmin");
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
};
