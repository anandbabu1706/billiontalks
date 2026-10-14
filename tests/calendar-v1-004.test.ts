import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import app from "../src/index";
import { calendarPage } from "../src/calendar/ui";
import {
  addCalendarDays,
  dateKeyInTimeZone,
  formatMeetingTime,
  monthGridDates,
  weekDates,
} from "../src/calendar/time";

function emptyAccountDatabase() {
  const statement = {
    bind() { return statement; },
    async first<T>() { return null as T | null; },
    async run() { return { meta: { changes: 0 } }; },
  };
  return { prepare: () => statement, batch: async () => [] };
}

const calendarMeetings = [
  {
    id: "btm_calendar_001",
    title: "International planning",
    agenda: "Review the cross-region launch.",
    startsAt: "2026-10-14T05:30:00.000Z",
    timeZone: "Asia/Kolkata",
    durationMinutes: 60,
    guestAccess: "HOST_APPROVAL",
    status: "SCHEDULED",
    revision: 1,
  },
  {
    id: "btm_calendar_002",
    title: "Cancelled planning",
    agenda: "",
    startsAt: "2026-10-14T06:00:00.000Z",
    timeZone: "Asia/Kolkata",
    durationMinutes: 30,
    guestAccess: "OPEN",
    status: "CANCELLED",
    revision: 2,
  },
];

const openDoms: JSDOM[] = [];
let startRequest: { url: string; init?: RequestInit } | undefined;

afterEach(() => {
  openDoms.splice(0).forEach((dom) => dom.window.close());
});

async function openCalendar(): Promise<JSDOM> {
  startRequest = undefined;
  const dom = new JSDOM(calendarPage(), {
    runScripts: "dangerously",
    url: "https://calendar.example/calendar",
    beforeParse(window) {
      Object.defineProperty(window, "fetch", {
        value: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/start")) {
            startRequest = { url, init };
            return { ok: false, status: 409, json: async () => ({ ok: false, error: "Refresh to continue." }) };
          }
          const payload = url === "/api/accounts/me"
            ? { ok: true, data: { account: { fullName: "Calendar Owner", email: "owner@example.test" } } }
            : { ok: true, data: calendarMeetings };
          return { ok: true, status: 200, json: async () => payload };
        },
      });
    },
  });
  openDoms.push(dom);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (dom.window.document.getElementById("calendarContent")?.hasAttribute("hidden") === false) return dom;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Calendar did not finish loading.");
}

describe("BT-V1-004 calendar and time zones", () => {
  it("uses IANA local dates for month and week boundaries, including DST changes", () => {
    expect(dateKeyInTimeZone("2026-10-14T05:30:00.000Z", "America/Los_Angeles")).toBe("2026-10-13");
    expect(dateKeyInTimeZone("2026-03-08T06:59:00.000Z", "America/New_York")).toBe("2026-03-08");
    expect(dateKeyInTimeZone("2026-03-08T07:01:00.000Z", "America/New_York")).toBe("2026-03-08");
    expect(formatMeetingTime("2026-03-08T06:30:00.000Z", "America/New_York")).toMatch(/EST|GMT-5/);
    expect(formatMeetingTime("2026-03-08T07:30:00.000Z", "America/New_York")).toMatch(/EDT|GMT-4/);
    expect(addCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(weekDates("2026-10-14")).toEqual([
      "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17",
    ]);
    expect(monthGridDates("2026-10-14")).toHaveLength(42);
    expect(monthGridDates("2026-10-14")[0]).toBe("2026-09-27");
  });

  it("renders authorized schedule records across month, week, and day navigation", async () => {
    const dom = await openCalendar();
    const { document, MouseEvent, Event } = dom.window;
    const click = (selector: string) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`Missing calendar control ${selector}.`);
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };

    expect(document.title).toBe("Calendar · BillionTalks");
    expect(document.querySelector('[aria-current="page"][href="/calendar"]')).not.toBeNull();
    expect(document.getElementById("monthView")?.querySelectorAll("[data-date]")).toHaveLength(42);
    const zoneSelect = document.getElementById("timeZoneSelect") as HTMLSelectElement;
    zoneSelect.value = "America/Los_Angeles";
    zoneSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const selectedDate = document.querySelector<HTMLButtonElement>('#monthView [data-date="2026-10-13"]');
    expect(selectedDate?.textContent).toContain("International planning");
    expect(selectedDate?.textContent).toContain("Cancelled planning");
    selectedDate?.click();
    expect(document.getElementById("selectedDay")?.textContent).toMatch(/Tuesday, (October 13|13 October) 2026/);
    expect(document.getElementById("selectedDay")?.textContent).toContain("scheduled in Asia/Kolkata");
    expect(document.querySelector('#selectedDay a[href="/schedule?meeting=btm_calendar_001"]')).not.toBeNull();
    const startButton = document.querySelector<HTMLButtonElement>('#selectedDay button[data-action="start-scheduled"][data-id="btm_calendar_001"][data-revision="1"]');
    expect(startButton?.textContent).toBe("Start meeting");
    expect(document.querySelector('#selectedDay button[data-id="btm_calendar_002"]')).toBeNull();
    startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let attempt = 0; attempt < 20 && !startRequest; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    for (let attempt = 0; attempt < 20 && document.getElementById("calendarError")?.textContent !== "Refresh to continue."; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(startRequest?.url).toBe("/api/schedules/btm_calendar_001/start");
    expect(JSON.parse(String(startRequest?.init?.body))).toEqual({ revision: 1 });
    expect(document.getElementById("calendarError")?.textContent).toBe("Refresh to continue.");
    expect(startButton?.disabled).toBe(false);

    click('[data-view="week"]');
    expect(document.getElementById("weekView")?.hidden).toBe(false);
    expect(document.getElementById("weekView")?.querySelectorAll("[data-date]")).toHaveLength(7);
    const previousLabel = document.getElementById("periodLabel")?.textContent;
    click("#nextPeriod");
    expect(document.getElementById("periodLabel")?.textContent).not.toBe(previousLabel);
    click('[data-view="day"]');
    expect(document.getElementById("dayView")?.hidden).toBe(false);
    expect(document.querySelectorAll("#dayView .event-card")).toHaveLength(0);
    click("#todayButton");
    expect(document.getElementById("periodLabel")?.textContent).not.toBe("");
    expect(dom.window.sessionStorage.getItem("bt-calendar-time-zone")).toBe("America/Los_Angeles");
  });

  it("serves the branded calendar and protects schedule data with account authorization", async () => {
    const pageResponse = await app.fetch(new Request("http://localhost/calendar"));
    const html = await pageResponse.text();
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("billiontalks-logo.png");
    expect(html).toContain("linear-gradient(155deg, #071d49 0%, #0b3d88 58%, #176fd2 100%)");
    expect(html).toContain("sessionStorage");
    expect(html).toContain("api/schedules");
    expect(html).not.toContain("btm_calendar_001");

    const schedulesResponse = await app.fetch(new Request("http://localhost/api/schedules"), {
      ACCOUNT_DB: emptyAccountDatabase(),
    });
    expect(schedulesResponse.status).toBe(401);
    await expect(schedulesResponse.json()).resolves.toMatchObject({ ok: false });
  });
});
