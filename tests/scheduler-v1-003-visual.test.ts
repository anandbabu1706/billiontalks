import { describe, expect, it } from "vitest";

import app from "../src/index";
import { dashboardPage } from "../src/dashboard/ui";
import { schedulerPreviewPage } from "../src/scheduler/ui";

describe("BT-V1-003 scheduler visual preview", () => {
  it("preserves the approved BillionTalks visual system while enabling the scheduler workflow", () => {
    const html = schedulerPreviewPage();

    expect(html).toContain("Schedule a meeting");
    expect(html).toContain("BT-V1-003 · Meeting Scheduler");
    expect(html).toContain("Private workspace");
    expect(html).toContain("billiontalks-logo.png");
    expect(html).toContain("linear-gradient(155deg, #071d49 0%, #0b3d88 58%, #176fd2 100%)");
    expect(html).toContain("linear-gradient(135deg, #176fd2, #318ff0)");
    expect(html).toContain("Meeting details");
    expect(html).toContain("Time zone");
    expect(html).toContain("Host approval");
    expect(html).toContain("Generated after scheduling");
    expect(html).toContain("id=\"submitScheduleButton\" type=\"submit\">Schedule meeting");
    expect(html).toContain("api('/api/schedules'");
    expect(html).toContain("data-action=\"start\"");
    expect(html).toContain("@media (max-width: 820px)");
    expect(html).toContain("@media (max-width: 580px)");
    expect(html).not.toContain("/api/calendar");
    expect(html).not.toContain("Google Calendar");
  });

  it("links the existing purple dashboard action to the functional scheduler without changing its hierarchy", () => {
    const html = dashboardPage();

    expect(html).toContain("class=\"action-card schedule-card\"");
    expect(html).toContain("class=\"disabled-action\" href=\"/schedule\">Schedule a meeting");
    expect(html).toContain("Schedule Meeting");
    expect(html).toContain("#7352d1");
    expect(html).toContain("api('/api/schedules?upcoming=1')");
  });

  it("serves the scheduler without embedding meeting or account data", async () => {
    const response = await app.fetch(new Request("http://localhost/schedule"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("Your scheduled meetings");
    expect(html).toContain("without opening a live room");
    expect(html).not.toContain("owner-review preview does not save meetings");
    expect(html).not.toContain("btm_");
    expect(html).not.toContain("@billiontalks.com");
  });
});
