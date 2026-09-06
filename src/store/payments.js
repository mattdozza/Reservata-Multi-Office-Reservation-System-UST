import { awsApi } from "../awsApi.js";
import { nextId, nowLabel } from "../utils.js";
import { MAX_RECEIPT_PREVIEW_BYTES, RESOLVED_RESERVATION_STATUSES, requireText } from "./shared.js";

export const paymentMethods = {
  get officePayments() {
    if (!this.officeScope) return this.data.payments;
    return this.data.payments.filter((payment) => {
      if (payment.office) return payment.office === this.officeScope;
      const reservation = this.data.reservations.find((item) => item.id === payment.reservationId);
      return reservation?.office === this.officeScope;
    });
  },

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
    if (reservation.status !== "For Payment") {
      throw new Error("Receipts can only be uploaded while the reservation is awaiting payment.");
    }
    const previousData = this.snapshot();
    const payment = this.data.payments.find((item) => item.id === reservation?.paymentId);
    if (!payment || payment.status !== "Awaiting Receipt") {
      throw new Error("This payment is no longer awaiting a receipt.");
    }
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
  },

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
    if (RESOLVED_RESERVATION_STATUSES.includes(reservation.status)) {
      throw new Error("Supporting documents can only be uploaded while a reservation is active.");
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
  },

  async verifyPayment(id, verified, reason = "") {
    this.requireRole("officeAdmin");
    const payment = this.data.payments.find((item) => item.id === id);
    if (!payment) return;
    const reservation = this.data.reservations.find((item) => item.id === payment.reservationId);
    this.requireOfficeRecord(reservation);
    if (reservation.status !== "For Payment" || payment.status !== "Pending Verification") {
      throw new Error("Only pending payment verification records can be decided.");
    }
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
};
