import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  eventsByDate,
  eventsForDate,
  monthCells,
  MONTH_LABELS,
  REQUESTER_CALENDAR_LEGEND,
  requesterCalendarEvents,
  shiftMonth,
  WEEKDAY_LABELS
} from "../../domain/reservations/requesterCalendar.js";
import { formatDate, todayIso } from "../../shared/utils.js";

const MAX_CELL_PILLS = 3;

function eventDetail(event) {
  return [event.resourceName, event.time, event.status].filter(Boolean).join(" · ");
}

function reservationCount(events) {
  return new Set(events.map((event) => event.reservationId)).size;
}

export function RequesterCalendarView({ store }) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState("");
  const [year, monthNumber] = month.split("-").map(Number);
  const events = requesterCalendarEvents(store.myReservations());
  const eventIndex = eventsByDate(events);
  const cells = monthCells(month);
  const selectedEvents = selectedDate ? eventsForDate(eventIndex, selectedDate) : [];
  const selectedReservations = reservationCount(selectedEvents);
  const baseYear = Number(todayIso().slice(0, 4));
  const years = [...new Set([baseYear - 1, baseYear, baseYear + 1, baseYear + 2, year])].sort((left, right) => left - right);

  function openMonth(value) {
    if (!value) return;
    setMonth(value);
    setSelectedDate("");
  }

  function openMonthPart(part, value) {
    const nextMonth = part === "month" ? String(value).padStart(2, "0") : String(monthNumber).padStart(2, "0");
    const nextYear = part === "year" ? value : year;
    openMonth(`${nextYear}-${nextMonth}`);
  }

  return (
    <div className="grid calendar-layout requester-calendar">
      <article className="card requester-calendar-surface">
        <div className="calendar-nav">
          <button className="icon-button calendar-nav-button" onClick={() => openMonth(shiftMonth(month, -1))} aria-label="Previous month" type="button">
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <div className="calendar-nav-selects">
            <select className="select calendar-nav-select" value={String(monthNumber)} onChange={(event) => openMonthPart("month", event.target.value)} aria-label="Calendar month">
              {MONTH_LABELS.map((label, index) => <option value={String(index + 1)} key={label}>{label}</option>)}
            </select>
            <select className="select calendar-nav-select" value={String(year)} onChange={(event) => openMonthPart("year", event.target.value)} aria-label="Calendar year">
              {years.map((item) => <option value={String(item)} key={item}>{item}</option>)}
            </select>
          </div>
          <button className="icon-button calendar-nav-button" onClick={() => openMonth(shiftMonth(month, 1))} aria-label="Next month" type="button">
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="calendar">
          {WEEKDAY_LABELS.map((day) => <div className="calendar-head" key={day}>{day}</div>)}
          {cells.map((cell) => {
            if (!cell.inMonth) {
              return <div className="calendar-day muted" key={cell.key}><strong>{cell.day}</strong></div>;
            }
            const dayEvents = eventsForDate(eventIndex, cell.date);
            return (
              <button
                className={`calendar-day calendar-button ${cell.date === selectedDate ? "selected" : ""}`}
                onClick={() => setSelectedDate(cell.date)}
                type="button"
                aria-label={`${formatDate(cell.date)} reservations`}
                key={cell.key}
              >
                <strong>{cell.day}</strong>
                {dayEvents.slice(0, MAX_CELL_PILLS).map((entry) => (
                  <span className={`event-pill calendar-pill ${entry.tone}`} key={entry.id}>{entry.resourceName}</span>
                ))}
                {dayEvents.length > MAX_CELL_PILLS && <small>{dayEvents.length - MAX_CELL_PILLS} more</small>}
              </button>
            );
          })}
        </div>
      </article>

      <article className="card requester-calendar-surface requester-calendar-side">
        <h2 className="calendar-side-title">Legend</h2>
        <ul className="requester-legend">
          {REQUESTER_CALENDAR_LEGEND.map((item) => (
            <li key={item.label}>
              <span className={`legend-swatch ${item.className}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
        <div className="calendar-side-divider" />
        <h2 className="calendar-side-title">Selected Day</h2>
        {!selectedDate ? (
          <p className="calendar-side-hint">Click a date to view details</p>
        ) : (
          <>
            <p className="calendar-side-summary">
              {formatDate(selectedDate)} · {selectedEvents.length} event{selectedEvents.length === 1 ? "" : "s"} · {selectedReservations} reservation{selectedReservations === 1 ? "" : "s"}
            </p>
            {!!selectedEvents.length && (
              <div className="calendar-event-rows">
                {selectedEvents.map((entry) => (
                  <div className="calendar-event-row" key={entry.id}>
                    <span className={`legend-swatch ${entry.tone}`} aria-hidden="true" />
                    <div>
                      <strong>{entry.label}</strong>
                      <small>{eventDetail(entry)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!selectedEvents.length && <p className="calendar-side-hint">No reservations on this date.</p>}
          </>
        )}
      </article>
    </div>
  );
}
