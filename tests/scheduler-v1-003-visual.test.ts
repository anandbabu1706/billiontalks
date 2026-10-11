import { describe, expect, it } from "vitest";

import app from "../src/index";
import { dashboardPage } from "../src/dashboard/ui";
import { schedulerPreviewPage } from "../src/scheduler/ui";

describe("BT-V1-003 scheduler visual preview", () => {
  it("renders the approved BillionTalks visual system without enabling scheduler persistence", () => {
    const html = schedulerPreviewPage();

    expect(html).toContain("Schedule a meeting");
    expect(html).toContain("BT-V1-003 · Meeting Scheduler");
    expect(html).toContain("Visual preview");
    expect(html).toContain("billiontalks-logo.png");
    expect(html).toContain("linear-gradient(155deg, #071d49 0%, #0b3d88 58%, #176fd2 100%)");
    expect(html).toContain("linear-gradient(135deg, #176fd2, #318ff0)");
    expect(html).toContain("Meeting details");
    expect(html).toContain("Time zone");
    expect(html).toContain("Host approval");
    expect(html).toContain("Generated after scheduling");
    expect(html).toContain("Schedule meeting</button>");
    expect(html).toContain("disabled>Schedule meeting");
    expect(html).not.toContain("/api/schedules");
    expect(html).not.toContain("/api/calendar");
    expect(html).not.toContain("Google Calendar");
  });

  it("links the existing purple dashboard action to the scheduler preview without changing its hierarchy", () => {
    const html = dashboardPage();

    expect(html).toContain("class=\"action-card schedule-card\"");
    expect(html).toContain("class=\"disabled-action\" href=\"/schedule\"");
    expect(html).toContain("Schedule Meeting");
    expect(html).toContain("#7352d1");
  });

  it("serves the visual preview without embedding meeting or account data", async () => {
    const response = await app.fetch(new Request("http://localhost/schedule"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("This owner-review preview does not save meetings");
    expect(html).not.toContain("btm_");
    expect(html).not.toContain("@billiontalks.com");
  });
});
