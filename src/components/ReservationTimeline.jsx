import { reservationTimeline } from "../domain/reservations/timeline.js";
import { displayTimestamp } from "../shared/utils.js";

export default function ReservationTimeline({ store, reservation }) {
  const events = reservationTimeline(reservation, store.data.payments, store.data.activity);
  return <section className="detail-section"><h3>Reservation timeline</h3>
    {events.length ? <ol className="reservation-timeline">{events.map((event, index) => <li key={event.id || index}><strong>{event.title}</strong><p>{displayTimestamp(event.at)}{event.actor ? ` · ${event.actor}` : ""}</p>{event.details && <p>{event.details}</p>}</li>)}</ol> : <p className="detail-note">No recorded history for this reservation yet.</p>}
  </section>;
}
