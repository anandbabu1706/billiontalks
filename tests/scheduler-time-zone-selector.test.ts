import { afterEach, describe, expect, it } from "vitest";
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

async function openScheduler(preferredTimezone: string | null = "Asia/Kolkata") {
  let submitted: Record<string, unknown> | null = null;
  const dom = new JSDOM(schedulerPreviewPage(), {
    runScripts: "dangerously",
    url: "https://meet.example/schedule",
    beforeParse(window) {
      Object.defineProperty(window, "fetch", {
        value: async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = String(input);
          let data: unknown;
          if (path === "/api/accounts/me") {
            data = { account: { fullName: "Scheduler Owner", email: "owner@example.test" } };
          } else if (path === "/api/preferences") {
            data = {
              preferences: preferredTimezone
                ? { timeZone: preferredTimezone, defaultDurationMinutes: 60, defaultGuestAccess: "HOST_APPROVAL" }
                : null,
            };
          } else if (path === "/api/schedules") {
            data = [existingMeeting];
          } else if (path === "/api/schedules/" + existingMeeting.id && init?.method === "PUT") {
            submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
            data = existingMeeting;
          } else if (path === "/api/schedules/" + existingMeeting.id) {
            data = existingMeeting;
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
  it("detects the device time zone for new meetings when no saved preference is available", async () => {
    const { dom } = await openScheduler(null);
    const detectedTimezone = dom.window.Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect((dom.window.document.getElementById("timezone") as HTMLSelectElement).value).toBe(detectedTimezone);
  });

  it("shows readable India and UTC labels and searches by country and IANA identifier", async () => {
    const { dom } = await openScheduler();
    const { document, Event } = dom.window;
    const search = document.getElementById("timezoneSearch") as HTMLInputElement;
    const selector = document.getElementById("timezone") as HTMLSelectElement;

    expect(selector.value).toBe("Asia/Kolkata");
    expect([...selector.options].find((option) => option.value === "Asia/Kolkata")?.textContent)
      .toContain("UTC+05:30");
    expect([...selector.options].find((option) => option.value === "Asia/Kolkata")?.textContent)
      .toContain("India Standard Time — Kolkata, India");

    search.value = "india";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...selector.options].some((option) => option.value === "Asia/Kolkata")).toBe(true);

    search.value = "utc";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const utc = [...selector.options].find((option) => option.value === "UTC");
    expect(utc?.textContent).toContain("UTC+00:00");
    expect(utc?.textContent).toContain("Coordinated Universal Time");
  });

  it("calculates United States daylight-saving offsets for the selected meeting date", async () => {
    const { dom } = await openScheduler();
    const { document, Event } = dom.window;
    const search = document.getElementById("timezoneSearch") as HTMLInputElement;
    const selector = document.getElementById("timezone") as HTMLSelectElement;
    const date = document.getElementById("date") as HTMLInputElement;

    search.value = "America/New_York";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    selector.value = "America/New_York";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    date.value = "2026-06-01";
    date.dispatchEvent(new Event("change", { bubbles: true }));
    expect([...selector.options].find((option) => option.value === "America/New_York")?.textContent)
      .toContain("(UTC-04:00) Eastern Daylight Time");

    date.value = "2026-11-01";
    date.dispatchEvent(new Event("change", { bubbles: true }));
    expect([...selector.options].find((option) => option.value === "America/New_York")?.textContent)
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
