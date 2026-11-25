"use client";

import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput } from "@fullcalendar/core";
import { useEffect, useMemo, useRef } from "react";
import type { CalEvent, Change } from "@/lib/types";
import { fmtWhen, minutes } from "@/lib/format";

// On weekends the demo data rolls to next week, so open there too.
function initialDate(): Date {
  const d = new Date();
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}

interface Props {
  events: CalEvent[];
  changes: Change[]; // only the changes currently included in the plan
  focusDate: string | null; // scroll the calendar to this date when it changes
  onRange: (start: string, end: string) => void;
}

interface ExtProps {
  change?: Change | null;
  ghost?: boolean;
  trim?: boolean;
}

export default function WeekCalendar({ events, changes, focusDate, onRange }: Props) {
  const ref = useRef<FullCalendar>(null);

  // Real events + ghost events for the proposed plan.
  //   create  -> dashed ghost at the new slot
  //   move    -> original faded with "moving to…", dashed ghost at the new slot
  //   shorten -> dashed ghost for the kept part, hatched ghost for the trimmed tail
  //   decline -> original struck through
  const fcEvents = useMemo(() => {
    const byEvent = new Map(changes.filter((c) => c.eventId).map((c) => [c.eventId!, c]));
    const out: EventInput[] = [];

    for (const e of events) {
      const c = byEvent.get(e.id);
      if (c?.type === "shorten") continue; // replaced by ghosts below
      const cls = [`kind-${e.kind ?? "meeting"}`];
      if (c?.type === "decline") cls.push("orig-decline");
      if (c?.type === "move") cls.push("orig-move");
      out.push({
        id: e.id, title: e.title, start: e.start, end: e.end, classNames: cls, url: e.meetLink,
        extendedProps: { change: c ?? null } satisfies ExtProps,
      });
    }

    for (const c of changes) {
      if (!c.to) continue;
      out.push({
        id: `ghost:${c.id}`,
        title: c.title ?? c.eventTitle ?? "",
        start: c.to.start,
        end: c.to.end,
        classNames: ["ghost", `ghost-${c.type}`, ...(c.warning ? ["ghost-warn"] : [])],
        extendedProps: { ghost: true, change: c } satisfies ExtProps,
      });
      if (c.type === "shorten" && c.from) {
        out.push({
          id: `trim:${c.id}`, title: "", start: c.to.end, end: c.from.end,
          classNames: ["ghost", "ghost-trim"],
          extendedProps: { ghost: true, trim: true, change: c } satisfies ExtProps,
        });
      }
    }
    return out;
  }, [events, changes]);

  // Jump to the week that holds the plan if it is not on screen.
  useEffect(() => {
    if (!focusDate) return;
    const api = ref.current?.getApi();
    if (!api) return;
    const d = new Date(focusDate);
    if (d < api.view.activeStart || d >= api.view.activeEnd) api.gotoDate(d);
  }, [focusDate]);

  return (
    <FullCalendar
      ref={ref}
      plugins={[timeGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      initialDate={initialDate()}
      weekends={false}
      allDaySlot={false}
      nowIndicator
      slotMinTime="08:00:00"
      slotMaxTime="19:00:00"
      slotDuration="00:30:00"
      expandRows
      height="100%"
      headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
      events={fcEvents}
      eventClick={(info) => {
        if (info.event.url) {
          info.jsEvent.preventDefault();
          window.open(info.event.url, "_blank", "noopener");
        }
      }}
      datesSet={(arg) => onRange(arg.start.toISOString(), arg.end.toISOString())}
      eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
      eventContent={(arg) => {
        const ep = arg.event.extendedProps as ExtProps;
        const c = ep.change;
        if (ep.trim) return <div className="ev"><span className="ev-badge">− {c && c.from && c.to ? minutes({ start: c.to.end, end: c.from.end }) : ""} min</span></div>;
        if (ep.ghost && c) {
          const label = c.type === "create" ? "New" : c.type === "move" ? "Moved" : "Shorter";
          return (
            <div className="ev">
              <span className="ev-badge">{label}</span> <span className="ev-title">{arg.event.title}</span>
              <div className="ev-time">{arg.timeText}</div>
            </div>
          );
        }
        if (c?.type === "move" && c.to) {
          return (
            <div className="ev">
              <span className="ev-title">{arg.event.title}</span>
              <div className="ev-time">↗ moving to {fmtWhen(c.to.start)}</div>
            </div>
          );
        }
        if (c?.type === "decline") {
          return (
            <div className="ev">
              <span className="ev-title">{arg.event.title}</span>
              <div className="ev-time">Decline</div>
            </div>
          );
        }
        return (
          <div className="ev">
            <span className="ev-time">{arg.timeText}</span> <span className="ev-title">{arg.event.title}</span>
          </div>
        );
      }}
    />
  );
}
