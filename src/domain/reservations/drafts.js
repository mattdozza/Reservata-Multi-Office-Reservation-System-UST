export const reservationDraftKey = (email) => `reservata.reservationDraft.v1:${String(email).trim().toLowerCase()}`;

export function readReservationDraft(key) {
  try {
    const draft = JSON.parse(localStorage.getItem(key));
    if (!draft || typeof draft !== "object" || !draft.slot || typeof draft.slot !== "object") return null;
    return {
      resourceId: String(draft.resourceId || ""),
      purpose: String(draft.purpose || ""),
      slot: Object.fromEntries(["date", "start", "end", "quantity"].map((field) => [field, String(draft.slot[field] || "")])),
      requirements: draft.requirements && typeof draft.requirements === "object" ? draft.requirements : {}
    };
  } catch { return null; }
}
