export function reservationTimeline(reservation, payments = [], activity = []) {
  const events = activity.filter((item) => item.reservationId === reservation.id || (!item.reservationId && (item.target === reservation.id || item.details === reservation.id)))
    .map((item) => ({ id: item.id, title: item.action, at: item.time || item.createdAt, actor: item.actor, details: item.details === reservation.id ? "" : item.details }));
  const add = (id, title, at, actor, details = "") => {
    if (!at || events.some((event) => event.title === title && event.at === at)) return;
    events.push({ id, title, at, actor, details });
  };
  add("submitted", "Reservation submitted", reservation.submittedAt || reservation.createdAt, reservation.requester);
  for (const step of reservation.approvalSteps || []) {
    add(step.id, `${step.name}: ${step.status}`, step.decidedAt, step.decidedBy || step.office, step.reason);
  }
  for (const payment of payments.filter((item) => item.reservationId === reservation.id || item.id === reservation.paymentId)) {
    add(`${payment.id}-created`, "Payment requested", payment.createdAt, payment.office, payment.paymentDeadlineAt ? `Receipt deadline: ${new Date(payment.paymentDeadlineAt).toLocaleString()}` : "");
    add(`${payment.id}-upload`, "Receipt uploaded", payment.uploadedAt, reservation.requester, payment.receipt);
    add(`${payment.id}-verified`, "Payment verified", payment.verifiedAt, payment.verifiedBy || payment.office);
  }
  for (const document of reservation.supportingDocuments || []) add(document.id || document.name, "Supporting document uploaded", document.uploadedAt, reservation.requester, document.name);
  for (const [field, title, reason] of [["cancelledAt", "Reservation cancelled", "cancellationReason"], ["expiredAt", "Reservation expired", "expiryReason"], ["rescheduledAt", "Reservation rescheduled", ""], ["completedAt", "Reservation completed", ""], ["noShowAt", "No show recorded", "noShowReason"]]) {
    add(field, title, reservation[field], reservation.cancelledBy || "", reservation[reason]);
  }
  return events.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
}
