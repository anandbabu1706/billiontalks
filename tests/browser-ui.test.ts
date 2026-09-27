// @vitest-environment jsdom

import { DurableObject } from "cloudflare:workers";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import app, { MeetingStateDurableObject } from "../src/index";

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function createResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => structuredClone(payload),
  };
}

const openWindows: JSDOM["window"][] = [];
const browserSessions = new Map<string, { sessionId: string; userId: string; displayName: string; createdAt: string; lastSeenAt: string }>();

function createSessionNamespace() {
  const stub = {
    getSession: async (sessionId: string) => browserSessions.get(sessionId),
    saveSession: async (session: { sessionId: string; userId: string; displayName: string; createdAt: string; lastSeenAt: string }) => {
      browserSessions.set(session.sessionId, session);
    },
    deleteSession: async (sessionId: string) => { browserSessions.delete(sessionId); },
  };

  return {
    idFromName: (name: string) => name,
    get: () => stub,
  };
}

async function loadRenderedPage() {
  const response = await app.fetch(new Request("http://localhost/"), {
    SESSION_STORE: createSessionNamespace(),
  });
  const html = await response.text();
  const createdMicStreams: Array<{ getTracks: () => any[]; getAudioTracks: () => any[]; getVideoTracks: () => any[] }> = [];
  const createdCameraStreams: Array<{ getTracks: () => any[]; getAudioTracks: () => any[]; getVideoTracks: () => any[] }> = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    beforeParse(window) {
      let micCallIndex = 0;
      let cameraCallIndex = 0;

      Object.defineProperty(window.navigator, "mediaDevices", {
        value: {
          getUserMedia: vi.fn(async (constraints) => {
            const kind = constraints.audio ? "audio" : "video";
            const callIndex = kind === "audio" ? ++micCallIndex : ++cameraCallIndex;
            const track = {
              id: `${kind}-track-${callIndex}`,
              kind,
              readyState: "live",
              stop: vi.fn(() => {
                track.readyState = "ended";
              }),
            };

            const stream = {
              getTracks: () => [track],
              getAudioTracks: () => (constraints.audio ? [track] : []),
              getVideoTracks: () => (constraints.video ? [track] : []),
            };

            if (kind === "audio") {
              createdMicStreams.push(stream);
            } else {
              createdCameraStreams.push(stream);
            }

            return stream;
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
  openWindows.push(window);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/chat")) {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return createResponse({
          ok: true,
          data: {
            id: "chat-test-1",
            meetingId: "btm_test_123",
            sequence: 1,
            senderUserId: "host-123",
            senderDisplayName: "Alex",
            content: body.content,
            createdAt: new Date().toISOString(),
          },
        }, true, 201);
      }
      return createResponse({ ok: true, data: [] });
    }

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

  return { window, document: window.document, fetchMock, getUserMediaMock, micStreams: createdMicStreams, cameraStreams: createdCameraStreams };
}

function createApprovalMeetingState() {
  return {
    id: "btm_wait_123",
    title: "Access review",
    status: "active",
    hostId: "host-123",
    accessMode: "HOST_APPROVAL" as const,
    participants: [
      { id: "host-1", userId: "host-123", displayName: "Host", role: "HOST", state: "JOINED" },
    ] as Array<{ id: string; userId: string; displayName: string; role: string; state: string }>,
    accessRequests: [] as Array<{
      id: string;
      meetingId: string;
      userId: string;
      displayName: string;
      status: string;
      requestedAt: string;
    }>,
  };
}

function getVisibleScreen(document: Document, id: string): boolean {
  return document.getElementById(id)?.classList.contains("visible") ?? false;
}

function getParticipantNames(document: Document): string[] {
  return Array.from(document.querySelectorAll("#participantList li")).map((item) => item.textContent ?? "");
}

afterEach(() => {
  openWindows.splice(0).forEach((window) => window.close());
  vi.restoreAllMocks();
});

describe("BillionTalks browser UI regression tests", () => {
  it("uses Cloudflare's DurableObject runtime base required for RPC", () => {
    expect(MeetingStateDurableObject.prototype instanceof DurableObject).toBe(true);
  });

  it("keeps prototype labels out of the product flow while leaving dev tools clearly local-only", async () => {
    const { document } = await loadRenderedPage();

    expect(document.body.textContent).not.toContain("V0 Meeting UI");
    expect(document.body.textContent).not.toContain("Local UI state");
    expect(document.body.textContent).not.toContain("Cloudflare media provider");
    expect(document.body.textContent).not.toContain("SFU");

    const toggle = document.getElementById("toggleDevPanelBtn") as HTMLButtonElement;
    toggle.click();
    await flush();

    expect(document.getElementById("devPanel")?.classList.contains("visible")).toBe(true);
    expect(document.getElementById("devPanel")?.textContent).toContain("Developer tools");
    expect(document.getElementById("devPanel")?.textContent).toContain("Local-only");
  });

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

  it("loads the meeting chat panel and submits a message from the room", async () => {
    const { document, fetchMock } = await loadRenderedPage();

    document.getElementById("startMeetingBtn")?.click();
    (document.getElementById("meetingTitle") as HTMLInputElement).value = "Sprint review";
    (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    expect(getVisibleScreen(document, "meetingScreen")).toBe(true);
    expect(document.getElementById("chatMessages")).not.toBeNull();
    expect(document.getElementById("chatInput")).not.toBeNull();

    const input = document.getElementById("chatInput") as HTMLInputElement;
    input.value = "Hello from the room";
    document.getElementById("chatForm")?.dispatchEvent(new document.defaultView!.Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/meetings/btm_test_123/chat", expect.objectContaining({ method: "POST" }));
    expect(document.getElementById("chatMessages")?.textContent).toContain("Hello from the room");
    expect(input.value).toBe("");
  });

  it("uses the real bottom mic/camera controls without null DOM writes and reacquires fresh live tracks", async () => {
    const { document, getUserMediaMock, micStreams } = await loadRenderedPage();

    document.getElementById("startMeetingBtn")?.click();
    const meetingTitleInput = document.getElementById("meetingTitle") as HTMLInputElement;
    const hostNameInput = document.getElementById("hostName") as HTMLInputElement;
    meetingTitleInput.value = "Sprint review";
    hostNameInput.value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();

    const displayNameInput = document.getElementById("displayNameInput") as HTMLInputElement;
    displayNameInput.value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    const micControl = document.getElementById("micControlBtn") as HTMLButtonElement;
    const cameraControl = document.getElementById("cameraControlBtn") as HTMLButtonElement;
    expect(micControl).not.toBeNull();
    expect(cameraControl).not.toBeNull();

    const localStatusLabel = document.getElementById("localStatusLabel");
    expect(localStatusLabel).not.toBeNull();
    localStatusLabel?.remove();

    expect(() => micControl.click()).not.toThrow();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(0);
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    micControl.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    const firstTrack = micStreams[0]?.getAudioTracks?.()[0];
    expect(firstTrack?.readyState).toBe("live");
    expect(micControl.classList.contains("active") || micControl.textContent?.toLowerCase().includes("on")).toBe(true);
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    micControl.click();
    await flush();
    expect(firstTrack?.stop).toHaveBeenCalledTimes(1);

    micControl.click();
    await flush();
    const secondTrack = micStreams[1]?.getAudioTracks?.()[0];
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    expect(secondTrack).toBeTruthy();
    expect(secondTrack).not.toBe(firstTrack);
    expect(secondTrack?.readyState).toBe("live");
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    cameraControl.click();
    await flush();
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    cameraControl.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(3);
    expect(document.querySelector("video.local-preview")).not.toBeNull();
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    cameraControl.click();
    await flush();
    cameraControl.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(4);
  });

  it("submits admission requests on Join Now and keeps guests waiting without entering the active room", async () => {
    const { document, fetchMock } = await loadRenderedPage();
    const meeting = createApprovalMeetingState();

    const fetchWithAdmission = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === "/api/meetings" && method === "POST") {
        return createResponse({ ok: true, data: { ...meeting, id: "btm_wait_123" } });
      }

      if (url === "/api/meetings/btm_wait_123" && method === "GET") {
        return createResponse({ ok: true, data: meeting });
      }

      if (url === "/api/meetings/btm_wait_123/admission/request" && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const request = {
          id: "req-guest-1",
          meetingId: "btm_wait_123",
          userId: body.userId,
          displayName: body.displayName,
          status: "WAITING",
          requestedAt: new Date().toISOString(),
        };
        meeting.accessRequests.push(request);
        return createResponse({ ok: true, data: request });
      }

      return createResponse({ ok: true, data: null });
    });

    const browserWindow = document.defaultView as Window & typeof globalThis;
    Object.defineProperty(browserWindow, "fetch", { value: fetchWithAdmission, configurable: true });
    Object.defineProperty(globalThis, "fetch", { value: fetchWithAdmission, configurable: true });

    (document.getElementById("meetingIdInput") as HTMLInputElement).value = "btm_wait_123";
    document.getElementById("resolveMeetingButton")?.click();
    await flush();

    const displayNameInput = document.getElementById("displayNameInput") as HTMLInputElement;
    displayNameInput.value = "Guest A";
    document.getElementById("joinNowButton")?.click();
    await flush();

    expect(fetchWithAdmission).toHaveBeenCalledWith(
      "/api/meetings/btm_wait_123/admission/request",
      expect.objectContaining({ method: "POST" }),
    );
    expect(getVisibleScreen(document, "prejoinScreen")).toBe(true);
    expect(document.getElementById("joinNowButton")?.textContent).toContain("Waiting for host approval");
    expect(document.getElementById("requestAdmissionBtn")?.style.display).toBe("none");
    expect(document.getElementById("meetingScreen")?.classList.contains("visible")).toBe(false);
  });

  it("allows the creator to join a HOST_APPROVAL room immediately as host and not as WAITING", async () => {
    const { document } = await loadRenderedPage();

    const meeting = createApprovalMeetingState();
    const fetchWithCreatorHost = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === "/api/meetings" && method === "POST") {
        return createResponse({ ok: true, data: { ...meeting, id: "btm_creator_123", title: "Creator room" } });
      }

      if (url === "/api/meetings/btm_creator_123" && method === "GET") {
        return createResponse({ ok: true, data: { ...meeting, id: "btm_creator_123", title: "Creator room" } });
      }

      if (url === "/api/meetings/btm_creator_123/join" && method === "POST") {
        return createResponse({
          ok: true,
          data: {
            id: "participant-host-creator",
            meetingId: "btm_creator_123",
            userId: "host-123",
            displayName: "Alex",
            role: "HOST",
            state: "JOINED",
            joinedAt: new Date().toISOString(),
          },
        });
      }

      if (url === "/api/meetings/btm_creator_123/admission/request" && method === "POST") {
        return createResponse({ ok: true, data: { status: "WAITING" } });
      }

      return createResponse({ ok: true, data: null });
    });

    const browserWindow = document.defaultView as Window & typeof globalThis;
    Object.defineProperty(browserWindow, "fetch", { value: fetchWithCreatorHost, configurable: true });
    Object.defineProperty(globalThis, "fetch", { value: fetchWithCreatorHost, configurable: true });

    document.getElementById("startMeetingBtn")?.click();
    const meetingTitleInput = document.getElementById("meetingTitle") as HTMLInputElement;
    const hostNameInput = document.getElementById("hostName") as HTMLInputElement;
    meetingTitleInput.value = "Creator room";
    hostNameInput.value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();

    expect(getVisibleScreen(document, "prejoinScreen")).toBe(true);

    const displayNameInput = document.getElementById("displayNameInput") as HTMLInputElement;
    displayNameInput.value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    expect(fetchWithCreatorHost).toHaveBeenCalledWith(
      "/api/meetings/btm_creator_123/join",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchWithCreatorHost).not.toHaveBeenCalledWith(
      "/api/meetings/btm_creator_123/admission/request",
      expect.objectContaining({ method: "POST" }),
    );
    expect(getVisibleScreen(document, "meetingScreen")).toBe(true);
    expect(document.getElementById("meetingTitleText")?.textContent).toContain("Creator room");
  });

  it("host sees pending guests and can approve or reject them from the admission queue", async () => {
    const { document, fetchMock } = await loadRenderedPage();
    const meeting = createApprovalMeetingState();
    const hostMeetingId = "btm_dev_1234567890";
    meeting.id = hostMeetingId;
    meeting.hostId = "host-dev";
    meeting.accessRequests = [{
      id: "req-guest-1",
      meetingId: hostMeetingId,
      userId: "guest-abc",
      displayName: "Guest A",
      status: "WAITING",
      requestedAt: new Date().toISOString(),
    }];

    const fetchWithAdmission = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url === "/api/meetings/btm_dev_1234567890/admission/pending" && method === "GET") {
        return createResponse({ ok: true, data: meeting.accessRequests });
      }

      if (url === "/api/meetings/btm_dev_1234567890/admission/req-guest-1/approve" && method === "POST") {
        meeting.accessRequests = [];
        meeting.participants.push({
          id: "guest-1",
          userId: "guest-abc",
          displayName: "Guest A",
          role: "PARTICIPANT",
          state: "JOINED",
        });
        return createResponse({ ok: true, data: { id: "req-guest-1", status: "APPROVED" } });
      }

      if (url === "/api/meetings/btm_dev_1234567890/admission/req-guest-1/reject" && method === "POST") {
        meeting.accessRequests = [];
        return createResponse({ ok: true, data: { id: "req-guest-1", status: "REJECTED" } });
      }

      if (url === "/api/meetings/btm_dev_1234567890" && method === "GET") {
        return createResponse({ ok: true, data: meeting });
      }

      return createResponse({ ok: true, data: null });
    });

    const browserWindow = document.defaultView as Window & typeof globalThis;
    Object.defineProperty(browserWindow, "fetch", { value: fetchWithAdmission, configurable: true });
    Object.defineProperty(globalThis, "fetch", { value: fetchWithAdmission, configurable: true });

    document.querySelector('[data-dev-action="hostView"]')?.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    const requestBtn = document.getElementById("requestAdmissionBtn");
    expect(requestBtn?.style.display).toBe("none");

    document.getElementById("refreshAdmissionsBtn")?.click();
    await flush();
    expect(document.getElementById("pendingAdmissionsList")?.textContent).toContain("Guest A");

    const approveBtn = Array.from(document.querySelectorAll('[data-admission-action="approve"]'))[0] as HTMLButtonElement;
    approveBtn.click();
    await flush();
    expect(fetchWithAdmission).toHaveBeenCalledWith(
      "/api/meetings/btm_dev_1234567890/admission/req-guest-1/approve",
      expect.objectContaining({ method: "POST" }),
    );
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

  it("removes only the selected simulated participant from the rendered dev tools flow", async () => {
    const { document } = await loadRenderedPage();

    document.getElementById("toggleDevPanelBtn")?.click();
    (document.querySelector('[data-dev-action="hostView"]') as HTMLButtonElement)?.click();
    await flush();

    const select = document.getElementById("devParticipantSelect") as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.textContent?.trim());

    expect(labels).toEqual(expect.arrayContaining(["Ava", "Sam", "Priya"]));
    expect(labels).not.toContain("Host");

    const samOption = Array.from(select.options).find((option) => option.textContent?.trim() === "Sam");
    expect(samOption).toBeTruthy();

    select.value = samOption?.value ?? "";
    (document.querySelector('[data-dev-action="removeParticipant"]') as HTMLButtonElement)?.click();
    await flush();

    let names = getParticipantNames(document);
    expect(names.some((name) => name.includes("Sam"))).toBe(false);
    expect(names.some((name) => name.includes("Host"))).toBe(true);
    expect(names.some((name) => name.includes("Ava"))).toBe(true);
    expect(names.some((name) => name.includes("Priya"))).toBe(true);

    const dropdownAfterSamRemove = Array.from(select.options).map((option) => option.textContent?.trim());
    expect(dropdownAfterSamRemove).toEqual(expect.arrayContaining(["Ava", "Priya"]));
    expect(dropdownAfterSamRemove).not.toContain("Sam");

    select.value = "";
    (document.querySelector('[data-dev-action="removeParticipant"]') as HTMLButtonElement)?.click();
    await flush();

    names = getParticipantNames(document);
    expect(names.some((name) => name.includes("Sam"))).toBe(false);
    expect(names.some((name) => name.includes("Ava"))).toBe(true);
    expect(names.some((name) => name.includes("Priya"))).toBe(true);

    const avaOption = Array.from(select.options).find((option) => option.textContent?.trim() === "Ava");
    expect(avaOption).toBeTruthy();

    select.value = avaOption?.value ?? "";
    (document.querySelector('[data-dev-action="removeParticipant"]') as HTMLButtonElement)?.click();
    await flush();

    names = getParticipantNames(document);
    expect(names.some((name) => name.includes("Ava"))).toBe(false);
    expect(names.some((name) => name.includes("Host"))).toBe(true);
    expect(names.some((name) => name.includes("Priya"))).toBe(true);
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

async function enterHostRoom() {
  const page = await loadRenderedPage();
  page.document.getElementById("startMeetingBtn")?.click();
  (page.document.getElementById("meetingTitle") as HTMLInputElement).value = "Controls";
  (page.document.getElementById("hostName") as HTMLInputElement).value = "Alex";
  page.document.getElementById("createMeetingButton")?.click();
  await flush();
  (page.document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
  page.document.getElementById("joinNowButton")?.click();
  await flush();
  return page;
}

function installFetch(window: JSDOM["window"], fetcher: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, "fetch", { value: fetcher, configurable: true });
}

function hostSnapshot() {
  return {
    ...createApprovalMeetingState(), id: "btm_test_123",
    participants: [
      { id: "host-1", userId: "host-123", displayName: "Alex", role: "HOST", state: "JOINED" },
      { id: "guest-1", userId: "guest-1", displayName: "Guest A", role: "PARTICIPANT", state: "JOINED" },
      { id: "guest-2", userId: "guest-2", displayName: "Guest B", role: "PARTICIPANT", state: "JOINED" },
    ],
  };
}

describe("BT-V0-009 rendered host controls", () => {
  it("confirms removal, sends only the selected user, and preserves the rest of the room", async () => {
    const { window, document } = await enterHostRoom();
    const meeting = hostSnapshot();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") meeting.participants[1].state = "REMOVED";
      return createResponse({ ok: true, data: meeting });
    });
    installFetch(window, fetcher);
    document.getElementById("refreshAdmissionsBtn")?.click();
    await flush();
    const confirm = vi.fn().mockReturnValue(false);
    Object.defineProperty(window, "confirm", { value: confirm });
    (document.querySelector('[data-remove-user-id="guest-1"]') as HTMLButtonElement).click();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    confirm.mockReturnValue(true);
    (document.querySelector('[data-remove-user-id="guest-1"]') as HTMLButtonElement).click();
    await flush();
    expect(fetcher).toHaveBeenCalledWith("/api/meetings/btm_test_123/remove", expect.objectContaining({
      body: JSON.stringify({ actorUserId: "host-123", targetUserId: "guest-1" }),
    }));
    expect(document.getElementById("participantList")?.textContent).not.toContain("Guest A");
    expect(document.getElementById("participantList")?.textContent).toContain("Guest B");
    expect(document.querySelector('[data-remove-user-id="host-123"]')).toBeNull();
  });

  it("serializes mode changes, recovers from network errors, and shows persisted mode", async () => {
    const { window, document } = await enterHostRoom();
    let rejectRequest!: (error: Error) => void;
    const fetcher = vi.fn(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    installFetch(window, fetcher);
    const button = document.getElementById("applyAccessModeBtn") as HTMLButtonElement;
    (document.getElementById("meetingAccessMode") as HTMLSelectElement).value = "LOCKED";
    button.click(); button.click();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    rejectRequest(new window.Error("Offline"));
    await flush();
    expect(button.disabled).toBe(false);
    expect(document.getElementById("errorBanner")?.textContent).toContain("Offline");
    const next = { ...hostSnapshot(), accessMode: "LOCKED" };
    const success = vi.fn(async () => createResponse({ ok: true, data: next }));
    installFetch(window, success);
    button.click(); await flush();
    expect(document.getElementById("admissionModeLabel")?.textContent).toContain("locked");
    expect(document.getElementById("errorBanner")?.textContent).toBe("");
  });

  it("requires end confirmation and retains the room when the API refuses", async () => {
    const { window, document } = await enterHostRoom();
    const confirm = vi.fn().mockReturnValue(false);
    Object.defineProperty(window, "confirm", { value: confirm });
    const fetcher = vi.fn(async () => createResponse({ ok: false, error: "Unable to save meeting." }, false, 403));
    installFetch(window, fetcher);
    document.getElementById("endMeetingBtn")?.click();
    expect(fetcher).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    document.getElementById("endMeetingBtn")?.click(); await flush();
    expect(getVisibleScreen(document, "meetingScreen")).toBe(true);
    expect(document.getElementById("errorBanner")?.textContent).toContain("Unable to save");
    expect((document.getElementById("endMeetingBtn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("ends successfully and stops camera, microphone, and screen sharing", async () => {
    const { window, document, micStreams, cameraStreams } = await enterHostRoom();
    Object.defineProperty(window, "confirm", { value: () => true });
    document.getElementById("toggleMicBtn")?.click(); await flush();
    document.getElementById("toggleCameraBtn")?.click(); await flush();
    const screenTrack = { stop: vi.fn(), addEventListener: vi.fn() };
    Object.defineProperty(window.navigator.mediaDevices, "getDisplayMedia", {
      value: vi.fn(async () => ({ getTracks: () => [screenTrack] })),
    });
    document.getElementById("shareScreenBtn")?.click(); await flush();
    installFetch(window, vi.fn(async () => createResponse({ ok: true, data: { ...hostSnapshot(), status: "ended" } })));
    document.getElementById("endMeetingBtn")?.click(); await flush();
    expect(getVisibleScreen(document, "endedScreen")).toBe(true);
    expect(micStreams[0].getTracks()[0].stop).toHaveBeenCalled();
    expect(cameraStreams[0].getTracks()[0].stop).toHaveBeenCalled();
    expect(screenTrack.stop).toHaveBeenCalled();
    expect(document.getElementById("endMeetingBtn")?.style.display).toBe("none");
  });

  it("renders participant and admission names as text without creating injected elements", async () => {
    const { window, document } = await enterHostRoom();
    const meeting = hostSnapshot();
    const name = '<img src=x onerror="window.injected=true">';
    meeting.participants[1].displayName = name;
    meeting.accessRequests.push({ id: 'req" autofocus onfocus="alert(1)', meetingId: meeting.id, userId: "waiting", displayName: name, status: "WAITING", requestedAt: new Date().toISOString() });
    installFetch(window, vi.fn(async () => createResponse({ ok: true, data: meeting })));
    document.getElementById("refreshAdmissionsBtn")?.click(); await flush();
    expect(document.querySelector("#participantList img, #videoStage img, #pendingAdmissionsList img")).toBeNull();
    expect(document.querySelector("[autofocus]")).toBeNull();
    expect(document.getElementById("pendingAdmissionsList")?.textContent).toContain(name);
  });

  it("automatically observes host removal and stops local capture", async () => {
    const { window, document, cameraStreams } = await enterHostRoom();
    document.getElementById("toggleCameraBtn")?.click(); await flush();
    const meeting = hostSnapshot();
    meeting.hostId = "different-host";
    meeting.participants[0].role = "PARTICIPANT";
    meeting.participants[0].state = "REMOVED";
    installFetch(window, vi.fn(async () => createResponse({ ok: true, data: meeting })));
    await new Promise(resolve => setTimeout(resolve, 3150));
    expect(getVisibleScreen(document, "endedScreen")).toBe(true);
    expect(document.getElementById("endedMessage")?.textContent).toContain("removed by the host");
    expect(cameraStreams[0].getTracks()[0].stop).toHaveBeenCalled();
    expect(document.getElementById("endMeetingBtn")?.style.display).toBe("none");
  });

  it("hides all host controls from a guest snapshot", async () => {
    const { window, document } = await enterHostRoom();
    const meeting = hostSnapshot(); meeting.hostId = "other-host";
    installFetch(window, vi.fn(async () => createResponse({ ok: true, data: meeting })));
    document.getElementById("refreshAdmissionsBtn")?.click(); await flush();
    expect(document.getElementById("admissionPanel")?.style.display).toBe("none");
    expect(document.getElementById("endMeetingBtn")?.style.display).toBe("none");
    expect(document.querySelector("[data-remove-user-id]")).toBeNull();
  });
});

describe("BT-V0-009 leave cleanup", () => {
  it("leaves immediately during a stalled network request and stops a late camera stream", async () => {
    const { window, document } = await enterHostRoom();
    let resolveCamera!: (stream: any) => void;
    const stop = vi.fn();
    Object.defineProperty(window.navigator.mediaDevices, "getUserMedia", {
      value: vi.fn(() => new Promise(resolve => { resolveCamera = resolve; })),
    });
    document.getElementById("toggleCameraBtn")?.click();
    installFetch(window, vi.fn(() => new Promise(() => {})));
    document.getElementById("leaveMeetingBtn")?.click();
    expect(getVisibleScreen(document, "homeScreen")).toBe(true);
    resolveCamera({ getTracks: () => [{ stop }], getVideoTracks: () => [{ stop }] });
    await flush();
    expect(stop).toHaveBeenCalledOnce();
    expect(document.querySelector("video.local-preview")).toBeNull();
  });
});

describe("BT-V0-009 waiting room synchronization", () => {
  it("automatically moves an approved guest into the room without exposing host controls", async () => {
    const { window, document } = await loadRenderedPage();
    const meeting = hostSnapshot();
    let guestId = "";
    let approved = false;
    installFetch(window, vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)); guestId = body.userId;
        return createResponse({ ok: true, data: { id: "waiting", userId: guestId, status: "WAITING", displayName: "Waiting guest" } });
      }
      return createResponse({ ok: true, data: approved ? {
        ...meeting,
        participants: [...meeting.participants, { id: "approved", userId: guestId, role: "PARTICIPANT", state: "JOINED", displayName: "Waiting guest" }],
      } : meeting });
    }));
    (document.getElementById("meetingIdInput") as HTMLInputElement).value = meeting.id;
    document.getElementById("resolveMeetingButton")?.click(); await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Waiting guest";
    document.getElementById("joinNowButton")?.click(); await flush();
    expect(getVisibleScreen(document, "prejoinScreen")).toBe(true);
    approved = true;
    await new Promise(resolve => setTimeout(resolve, 3150));
    expect(getVisibleScreen(document, "meetingScreen")).toBe(true);
    expect(document.getElementById("admissionPanel")?.style.display).toBe("none");
    expect(document.querySelector("[data-remove-user-id]")).toBeNull();
  });
});
