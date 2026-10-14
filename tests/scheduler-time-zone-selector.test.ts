import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { schedulerPreviewPage } from "../src/scheduler/ui";

const existingMeeting = {
  id: "btm_existing_timezone",
  title: "Existing time-zone meeting",
  agenda: "",
  localDate: "2026-11-10",
  localTime: "10:30",
  startsAt: "2026-11-10T05:00:00.000Z",
  timeZone: "Asia/Kolkata",
  durationMinutes: 60,
  guestAccess: "HOST_APPROVAL",
  status: "SCHEDULED",
  revision: 2,
  shareUrl: "https://meet.example/?meeting=btm_existing_timezone",
};

const openDoms: JSDOM[] = [];

afterEach(() => {
  openDoms.splice(0).forEach((dom) => dom.window.close());
});

async function openScheduler(
  preferredTimezone = "Asia/Kolkata",
  timezoneExplicit = true,
  initialMeeting = existingMeeting,
) {
  let submitted: Record<string, unknown> | null = null;
  let persistedMeeting = { ...initialMeeting };
  const dom = new JSDOM(schedulerPreviewPage(), {
    runScripts: "dangerously",
    url: "https://meet.example/schedule",
    beforeParse(window) {
      const nativeResolvedOptions = window.Intl.DateTimeFormat.prototype.resolvedOptions;
      Object.defineProperty(window.Intl.DateTimeFormat.prototype, "resolvedOptions", {
        value: function (this: Intl.DateTimeFormat) {
          return { ...nativeResolvedOptions.call(this), timeZone: "America/Los_Angeles" };
        },
      });
      Object.defineProperty(window, "fetch", {
        value: async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = String(input);
          let data: unknown;
          if (path === "/api/accounts/me") {
            data = { account: { fullName: "Scheduler Owner", email: "owner@example.test" } };
          } else if (path === "/api/preferences") {
            data = {
              preferences: {
                timeZone: preferredTimezone,
                timeZoneExplicit: timezoneExplicit,
                defaultDurationMinutes: 60,
                defaultGuestAccess: "HOST_APPROVAL",
              },
            };
          } else if (path === "/api/schedules") {
            data = [persistedMeeting];
          } else if (path === "/api/schedules/" + initialMeeting.id && init?.method === "PUT") {
            submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
            persistedMeeting = { ...persistedMeeting, ...submitted };
            data = persistedMeeting;
          } else if (path === "/api/schedules/" + initialMeeting.id) {
            data = persistedMeeting;
          } else {
            data = {};
          }
          return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
        },
      });
    },
  });
  openDoms.push(dom);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (dom.window.document.querySelector("#scheduleList [data-action='edit']")) return { dom, getSubmitted: () => submitted };
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Scheduler did not finish loading.");
}

describe("BT-V1-003 scheduler time-zone selector", () => {
  it("uses the detected device zone for new meetings when the stored time zone is only the default", async () => {
    const { dom } = await openScheduler("UTC", false);
    expect((dom.window.document.getElementById("timezone") as HTMLSelectElement).value).toBe("America/Los_Angeles");
  });

  it("preserves an explicitly selected UTC preference", async () => {
    const { dom } = await openScheduler("UTC", true);
    expect((dom.window.document.getElementById("timezone") as HTMLSelectElement).value).toBe("UTC");
  });

  it("shows readable India and UTC labels and searches by country and IANA identifier", async () => {
    const { dom } = await openScheduler();
    const { document, Event } = dom.window;
    const search = document.getElementById("timezoneSearch") as HTMLInputElement;
    const selector = document.getElementById("timezone") as HTMLSelectElement;

    expect(selector.value).toBe("Asia/Kolkata");
    expect(selector.type).toBe("hidden");
    expect(document.getElementById("timezoneSearch")?.getAttribute("role")).toBe("combobox");
    search.focus();
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.dataset.timeZone === "Asia/Kolkata")?.textContent)
      .toContain("UTC+05:30");
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.dataset.timeZone === "Asia/Kolkata")?.textContent)
      .toContain("India Standard Time (IST) — India (Chennai / Kolkata / Mumbai)");

    for (const query of ["India", "IST", "Chennai", "Mumbai", "Kolkata", "Calcutta"]) {
      search.value = query;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].some((option) => option.dataset.timeZone === "Asia/Kolkata"), query).toBe(true);
    }

    search.value = "utc";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const utc = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.dataset.timeZone === "UTC");
    expect(utc?.textContent).toContain("UTC+00:00");
    expect(utc?.textContent).toContain("Coordinated Universal Time");
  });

  it("keeps the chosen zone synchronized through searching, summary, save, and reopening", async () => {
    const utcMeeting = {
      ...existingMeeting,
      timeZone: "UTC",
      startsAt: "2026-11-10T10:30:00.000Z",
    };
    const { dom, getSubmitted } = await openScheduler("UTC", true, utcMeeting);
    const { document, Event, MouseEvent } = dom.window;
    document.querySelector<HTMLButtonElement>("[data-action='edit']")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const search = document.getElementById("timezoneSearch") as HTMLInputElement;
    const selector = document.getElementById("timezone") as HTMLSelectElement;

    search.focus();
    search.value = "Ind";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const indiaOption = document.querySelector<HTMLElement>('[data-time-zone="Asia/Kolkata"]');
    expect(indiaOption).toBeDefined();
    indiaOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(selector.value).toBe("Asia/Kolkata");
    expect(document.getElementById("summaryTimezone")?.textContent)
    .toBe("(UTC+05:30) India Standard Time (IST) — India (Chennai / Kolkata / Mumbai)");

    const form = document.getElementById("schedulerForm");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSubmitted()).toMatchObject({ timeZone: "Asia/Kolkata", date: "2026-11-10", time: "10:30" });

    document.querySelector<HTMLButtonElement>("[data-action='edit']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selector.value).toBe("Asia/Kolkata");
    expect(document.getElementById("summaryTimezone")?.textContent)
    .toBe("(UTC+05:30) India Standard Time (IST) — India (Chennai / Kolkata / Mumbai)");
  });

  it("supports combobox keyboard selection, Escape, and outside-click dismissal", async () => {
    const { dom } = await openScheduler("UTC", true);
    const { document, Event, MouseEvent, KeyboardEvent } = dom.window;
    const search = document.getElementById("timezoneSearch") as HTMLInputElement;
    const selector = document.getElementById("timezone") as HTMLInputElement;
    const listbox = document.getElementById("timezoneOptions") as HTMLDivElement;

    search.focus();
    search.value = "Chennai";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(search.getAttribute("aria-activedescendant")).toBe("timezone-option-Asia-Kolkata");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(selector.value).toBe("Asia/Kolkata");
    expect(search.getAttribute("aria-expanded")).toBe("false");

    search.focus();
    search.value = "Mumbai";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(listbox.hidden).toBe(true);
    expect(selector.value).toBe("Asia/Kolkata");

    search.focus();
    search.value = "Sri Lanka";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(listbox.hidden).toBe(true);
    expect(selector.value).toBe("Asia/Kolkata");
  });

  it("dismisses the native time picker only after a committed valid time change", async () => {
    const { dom } = await openScheduler();
    const { document, Event } = dom.window;
    const time = document.getElementById("time") as HTMLInputElement;
    const blur = vi.spyOn(time, "blur");

    time.focus();
    time.value = "09:30";
    time.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(time);

    time.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(blur).toHaveBeenCalledOnce();
  });

  it("canonicalizes the legacy Calcutta identifier without changing the wall-clock time", async () => {
    const legacyMeeting = { ...existingMeeting, timeZone: "Asia/Calcutta" };
    const { dom, getSubmitted } = await openScheduler("Asia/Kolkata", true, legacyMeeting);
    const { document, Event } = dom.window;
    document.querySelector<HTMLButtonElement>("[data-action='edit']")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((document.getElementById("timezone") as HTMLSelectElement).value).toBe("Asia/Kolkata");
    expect((document.getElementById("date") as HTMLInputElement).value).toBe("2026-11-10");
    expect((document.getElementById("time") as HTMLInputElement).value).toBe("10:30");
    document.getElementById("schedulerForm")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSubmitted()).toMatchObject({ timeZone: "Asia/Kolkata", date: "2026-11-10", time: "10:30" });
  });

  it("labels Sri Lanka separately from India", async () => {
    const { dom } = await openScheduler();
    const { document, Event } = dom.window;
    const search = document.getElementById("timezoneSearch") as HTMLInputElement;
    const selector = document.getElementById("timezone") as HTMLSelectElement;

    search.focus();
    search.value = "Sri Lanka";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const sriLanka = document.querySelector<HTMLElement>('[data-time-zone="Asia/Colombo"]');
    expect(sriLanka?.textContent).toContain("Sri Lanka Standard Time (SLST) — Colombo, Sri Lanka");
    expect(sriLanka?.dataset.timeZone).not.toBe("Asia/Kolkata");
  });

  it("calculates United States daylight-saving offsets for the selected meeting date", async () => {
    const { dom } = await openScheduler();
    const { document, Event } = dom.window;
    const search = document.getElementById("timezoneSearch") as HTMLInputElement;
    const selector = document.getElementById("timezone") as HTMLSelectElement;
    const date = document.getElementById("date") as HTMLInputElement;

    search.focus();
    search.value = "America/New_York";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLElement>('[data-time-zone="America/New_York"]')?.dispatchEvent(new Event("click", { bubbles: true }));
    date.value = "2026-06-01";
    date.dispatchEvent(new Event("change", { bubbles: true }));
    search.value = "New York";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>('[data-time-zone="America/New_York"]')?.textContent)
      .toContain("(UTC-04:00) Eastern Daylight Time");

    date.value = "2026-11-01";
    date.dispatchEvent(new Event("change", { bubbles: true }));
    search.value = "New York";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>('[data-time-zone="America/New_York"]')?.textContent)
      .toContain("(UTC-05:00) Eastern Standard Time");
  });

  it("retains the stored IANA time zone and local meeting details when editing", async () => {
    const { dom, getSubmitted } = await openScheduler();
    const { document, Event } = dom.window;
    document.querySelector<HTMLButtonElement>("[data-action='edit']")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selector = document.getElementById("timezone") as HTMLSelectElement;
    expect(selector.value).toBe("Asia/Kolkata");
    expect((document.getElementById("date") as HTMLInputElement).value).toBe("2026-11-10");
    document.getElementById("schedulerForm")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSubmitted()).toMatchObject({
      timeZone: "Asia/Kolkata",
      date: "2026-11-10",
      time: "10:30",
    });
  });
});
