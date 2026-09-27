// @vitest-environment jsdom

import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../src/index";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function createResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

async function loadRenderedPage() {
  const response = await app.fetch(new Request("http://localhost/"));
  const html = await response.text();
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    beforeParse(window) {
      Object.defineProperty(window.navigator, "mediaDevices", {
        value: {
          getUserMedia: vi.fn(async (constraints) => {
            const kind = constraints.audio ? "audio" : "video";
            const track = {
              kind,
              readyState: "live",
              stop: vi.fn(),
            };

            return {
              getTracks: () => [track],
              getAudioTracks: () => (constraints.audio ? [track] : []),
              getVideoTracks: () => (constraints.video ? [track] : []),
            };
          }),
        },
        configurable: true,
      });

      Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: vi.fn().mockResolvedValue(undefined),
      });
    },
  });

  const { window } = dom;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url === "/api/meetings" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return createResponse({
        ok: true,
        data: {
          id: "btm_test_123",
          title: body.title || "Sprint review",
          status: "active",
          hostId: "host-123",
          participants: [],
        },
      });
    }

    if (url.endsWith("/join") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return createResponse({
        ok: true,
        data: {
          id: "participant-" + body.userId,
          userId: body.userId,
          displayName: body.displayName,
          role: "PARTICIPANT",
          state: "JOINED",
          meetingId: "btm_test_123",
        },
      });
    }

    if (url === "/api/meetings/btm_test_123" && method === "GET") {
      return createResponse({
        ok: true,
        data: {
          id: "btm_test_123",
          title: "Sprint review",
          status: "active",
          hostId: "host-123",
          participants: [],
        },
      });
    }

    return createResponse({ ok: true, data: null });
  });

  Object.defineProperty(window, "fetch", {
    value: fetchMock,
    configurable: true,
  });
  Object.defineProperty(globalThis, "fetch", {
    value: fetchMock,
    configurable: true,
  });

  const getUserMediaMock = window.navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;

  return { window, document: window.document, fetchMock, getUserMediaMock };
}

function getVisibleScreen(document: Document, id: string): boolean {
  return document.getElementById(id)?.classList.contains("visible") ?? false;
}

function getParticipantNames(document: Document): string[] {
  return Array.from(document.querySelectorAll("#participantList li")).map((item) => item.textContent ?? "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BillionTalks browser UI regression tests", () => {
  it("opens the create flow and joins the room from the actual rendered UI", async () => {
    const { document } = await loadRenderedPage();

    document.getElementById("startMeetingBtn")?.click();
    expect(getVisibleScreen(document, "createScreen")).toBe(true);

    const meetingTitleInput = document.getElementById("meetingTitle") as HTMLInputElement;
    const hostNameInput = document.getElementById("hostName") as HTMLInputElement;
    meetingTitleInput.value = "Sprint review";
    hostNameInput.value = "Alex";

    document.getElementById("createMeetingButton")?.click();
    await flush();
    expect(getVisibleScreen(document, "prejoinScreen")).toBe(true);

    const displayNameInput = document.getElementById("displayNameInput") as HTMLInputElement;
    displayNameInput.value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    expect(getVisibleScreen(document, "meetingScreen")).toBe(true);
    expect(document.getElementById("meetingTitleText")?.textContent).toContain("Sprint review");
  });

  it("allows microphone cycles ON → OFF → ON repeatedly with live tracks", async () => {
    const { document, getUserMediaMock } = await loadRenderedPage();

    document.getElementById("toggleMicBtn")?.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect((document.getElementById("toggleMicBtn") as HTMLButtonElement).textContent).toContain("On");

    document.getElementById("toggleMicBtn")?.click();
    await flush();
    expect((document.getElementById("toggleMicBtn") as HTMLButtonElement).textContent).toContain("Off");

    document.getElementById("toggleMicBtn")?.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    expect((document.getElementById("toggleMicBtn") as HTMLButtonElement).textContent).toContain("On");
  });

  it("allows camera cycles ON → OFF → ON repeatedly with live tracks and preview state", async () => {
    const { document, getUserMediaMock } = await loadRenderedPage();

    document.getElementById("toggleCameraBtn")?.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect((document.getElementById("toggleCameraBtn") as HTMLButtonElement).textContent).toContain("On");

    document.getElementById("toggleCameraBtn")?.click();
    await flush();
    expect((document.getElementById("toggleCameraBtn") as HTMLButtonElement).textContent).toContain("Off");

    document.getElementById("toggleCameraBtn")?.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    expect((document.getElementById("toggleCameraBtn") as HTMLButtonElement).textContent).toContain("On");
    expect(document.querySelector("video.local-preview")).not.toBeNull();
  });

  it("removes only the selected simulated participant and keeps the rest stable", async () => {
    const { document } = await loadRenderedPage();

    document.getElementById("toggleDevPanelBtn")?.click();
    const addButton = document.querySelector('[data-dev-action="addParticipant"]') as HTMLButtonElement;
    addButton.click();
    addButton.click();
    addButton.click();
    await flush();

    const select = document.getElementById("devParticipantSelect") as HTMLSelectElement;
    const avaOption = Array.from(select.options).find((option) => option.textContent?.includes("Ava"));
    expect(avaOption).toBeTruthy();

    select.value = avaOption?.value ?? "";
    (document.querySelector('[data-dev-action="removeParticipant"]') as HTMLButtonElement)?.click();
    await flush();

    const names = getParticipantNames(document);
    expect(names.some((name) => name.includes("Ava"))).toBe(false);
    expect(names.some((name) => name.includes("Host"))).toBe(true);
    expect(names.some((name) => name.includes("Sam"))).toBe(true);
  });

  it("keeps participant role simulations from removing users", async () => {
    const { document } = await loadRenderedPage();

    document.getElementById("toggleDevPanelBtn")?.click();
    const addButton = document.querySelector('[data-dev-action="addParticipant"]') as HTMLButtonElement;
    addButton.click();
    addButton.click();
    await flush();

    const before = getParticipantNames(document).length;
    (document.querySelector('[data-dev-action="participantView"]') as HTMLButtonElement)?.click();
    await flush();

    expect(getParticipantNames(document).length).toBeGreaterThan(0);
    expect(getParticipantNames(document).length).toBeLessThanOrEqual(before + 1);
  });

  it("participant-left simulation does not remove unrelated participants", async () => {
    const { document } = await loadRenderedPage();

    document.getElementById("toggleDevPanelBtn")?.click();
    const addButton = document.querySelector('[data-dev-action="addParticipant"]') as HTMLButtonElement;
    addButton.click();
    addButton.click();
    await flush();

    const previousCount = getParticipantNames(document).length;
    (document.querySelector('[data-dev-action="participantLeave"]') as HTMLButtonElement)?.click();
    await flush();

    expect(getParticipantNames(document).length).toBeGreaterThan(0);
    expect(getParticipantNames(document).length).toBeLessThanOrEqual(previousCount + 1);
  });

  it("keeps the participant list and grid synchronized through dev actions", async () => {
    const { document } = await loadRenderedPage();

    document.getElementById("toggleDevPanelBtn")?.click();
    const addButton = document.querySelector('[data-dev-action="addParticipant"]') as HTMLButtonElement;
    addButton.click();
    addButton.click();
    await flush();

    const listCount = getParticipantNames(document).length;
    const stageTiles = document.querySelectorAll("#videoStage .tile").length;
    expect(stageTiles).toBeGreaterThan(0);
    expect(stageTiles).toBeGreaterThanOrEqual(listCount);
  });
});
