import { VISITOR_CAPABLE_REQUESTER_TYPES } from "../config.js";
import { awsApi } from "../services/awsApi.js";
import { nextId } from "../shared/utils.js";
import { cleanText, requireFutureDate, requireText, validPositiveNumber } from "./shared.js";

export const visitorMethods = {
  async submitVisitor(values) {
    this.requireRole("requester");
    if (!VISITOR_CAPABLE_REQUESTER_TYPES.includes(this.currentUser.requesterType)) {
      throw new Error("Only Faculty, Staff, or Student Org Rep accounts can submit visitor requests.");
    }
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
  },

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
  },

  async checkInVisitor(id) {
    this.requireRole("osgAdmin");
    const visitor = this.data.visitors.find((item) => item.id === id);
    if (!visitor) return;
    const previousData = this.snapshot();
    visitor.status = "Arrived";
    this.addActivity("Visitor arrival recorded", this.currentUser.name, visitor.visitor);
    this.addNotification(visitor.requester, `${visitor.visitor}: arrival has been recorded by OSG.`, "Visitor");
    await this.save(() => awsApi.checkInVisitor(id), previousData);
  },

  async allocateBay(bay) {
    this.requireRole("osgAdmin");
    const visitor = this.data.visitors.find((item) => item.status === "Approved" && !item.parking);
    if (!visitor) throw new Error("No approved visitor is waiting for a parking bay.");
    const previousData = this.snapshot();
    visitor.parking = bay;
    this.addActivity("Parking allocated", this.currentUser.name, `${visitor.visitor}: ${bay}`);
    this.addNotification(visitor.requester, `${visitor.visitor}: parking bay ${bay} has been assigned.`, "Visitor");
    await this.save(() => awsApi.allocateParking(visitor.id, bay), previousData);
  },

  nextOpenBay() {
    for (let index = 0; index < 20; index += 1) {
      const bay = `${String.fromCharCode(65 + Math.floor(index / 5))}${(index % 5) + 1}`;
      if (!this.data.visitors.some((visitor) => String(visitor.parking || "").includes(bay))) return bay;
    }
    return "";
  }
};
