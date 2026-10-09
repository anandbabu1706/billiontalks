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

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static initialRemoteTrackKind: "audio" | "video" = "video";
  static negotiationViolations: string[] = [];
  static subscriberIceTimeouts = 0;
  static subscriberTimeoutSdp = "browser-answer-sdp";
  public connectionState = "new";
  public iceConnectionState = "new";
  public iceGatheringState = "complete";
  public signalingState = "stable";
  public localDescription: any = null;
  public remoteDescription: any = null;
  public onconnectionstatechange: (() => void) | null = null;
  public oniceconnectionstatechange: (() => void) | null = null;
  public ontrack: ((event: any) => void) | null = null;
  private transceivers: any[] = [];

  constructor() { FakePeerConnection.instances.push(this); }

  addTransceiver(track: any, init: { direction: string }) {
    const transceiver = {
      mid: String(this.transceivers.length),
      direction: init.direction,
      sender: { track, replaceTrack: vi.fn(async () => undefined) },
      stop: vi.fn(),
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers() { return this.transceivers; }
  async createOffer() {
    if (this.signalingState !== "stable") FakePeerConnection.negotiationViolations.push(`createOffer while ${this.signalingState}`);
    return { type: "offer", sdp: "browser-offer-sdp" };
  }
  async createAnswer() {
    if (this.ontrack && FakePeerConnection.subscriberIceTimeouts > 0) {
      FakePeerConnection.subscriberIceTimeouts -= 1;
      this.iceGatheringState = "gathering";
      return { type: "answer", sdp: FakePeerConnection.subscriberTimeoutSdp };
    }
    this.iceGatheringState = "complete";
    return { type: "answer", sdp: "browser-answer-sdp" };
  }
  emitTrack(mid: string, track: any) { this.ontrack?.({ transceiver: { mid }, track }); }
  setConnectionStates(connectionState: string, iceConnectionState: string) {
    this.connectionState = connectionState;
    this.iceConnectionState = iceConnectionState;
    this.onconnectionstatechange?.();
    this.oniceconnectionstatechange?.();
  }
  async setLocalDescription(description: any) {
    if (description.type === "rollback") { this.signalingState = "stable"; return; }
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description: any) {
    if (description.type === "offer" && this.signalingState !== "stable") FakePeerConnection.negotiationViolations.push(`remote offer while ${this.signalingState}`);
    this.remoteDescription = description;
    this.signalingState = "stable";
    this.setConnectionStates("connected", "connected");
    if (description.type === "offer" && this.ontrack && !/removal|screen/.test(String(description.sdp))) {
      this.emitTrack("remote-0", createFakeRemoteTrack("remote-initial-track", FakePeerConnection.initialRemoteTrackKind));
    }
  }
  addEventListener() {}
  removeEventListener() {}
  close() { this.setConnectionStates("closed", "closed"); }
}

class FakeMediaStream {
  private tracks: any[] = [];
  constructor(tracks: any[] = []) { this.tracks = [...tracks]; }
  addTrack(track: any) { this.tracks.push(track); }
  removeTrack(track: any) { this.tracks = this.tracks.filter((entry) => entry !== track); }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
}

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  public state = "inactive";
  private listeners = new Map<string, Array<(event: any) => void>>();

  constructor(_stream: unknown, _options?: unknown) {}
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  start() { this.state = "recording"; }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    const data = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/webm" });
    this.listeners.get("dataavailable")?.forEach((listener) => listener({ data }));
    this.listeners.get("stop")?.forEach((listener) => listener({}));
  }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
}

const openWindows: JSDOM["window"][] = [];
const browserSessions = new Map<string, { sessionId: string; userId: string; displayName: string; createdAt: string; lastSeenAt: string }>();

function createFakeRemoteTrack(id: string, kind: "audio" | "video") {
  const listeners = new Map<string, Array<() => void>>();
  const track: any = {
    id,
    kind,
    readyState: "live",
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    stop: vi.fn(() => {
      track.readyState = "ended";
      listeners.get("ended")?.forEach((listener) => listener());
    }),
  };
  return track;
}

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

async function loadRenderedPage(pageUrl = "http://localhost/", supportsScreenShare = true) {
  let nextSubscribePayload: unknown = null;
  let subscribePayloadUsed = false;
  const subscribeQueue: unknown[] = [];
  let nextSubscribeError: string | null = null;
  let registrationResponse = createResponse({
    ok: true,
    data: { account: { email: "jane@example.com" }, emailVerificationRequired: true },
  }, true, 201);
  let includeRemoteParticipant = false;
  let additionalRemoteParticipant: { id: string; userId: string; displayName: string; role: string; state: string } | null = null;
  const remoteParticipants = () => [
    ...(includeRemoteParticipant ? [{
      id: "remote-participant",
      userId: "remote-user",
      displayName: "Remote Guest",
      role: "PARTICIPANT",
      state: "JOINED",
    }] : []),
    ...(additionalRemoteParticipant ? [additionalRemoteParticipant] : []),
  ];
  const response = await app.fetch(new Request(pageUrl), {
    SESSION_STORE: createSessionNamespace(),
  });
  const html = await response.text();
  const createdMicStreams: Array<{ getTracks: () => any[]; getAudioTracks: () => any[]; getVideoTracks: () => any[] }> = [];
  const createdCameraStreams: Array<{ getTracks: () => any[]; getAudioTracks: () => any[]; getVideoTracks: () => any[] }> = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: pageUrl,
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
          ...(supportsScreenShare ? { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] })) } : {}),
        },
        configurable: true,
      });

      Object.defineProperty(window, "Blob", { value: Blob, configurable: true });
      Object.defineProperty(window, "MediaStream", { value: FakeMediaStream, configurable: true });
      Object.defineProperty(window, "MediaRecorder", { value: FakeMediaRecorder, configurable: true });
      Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value: () => ({
          fillRect() {},
          fillText() {},
          drawImage() {},
          set fillStyle(_value: string) {},
          set font(_value: string) {},
        }),
      });
      Object.defineProperty(window.HTMLCanvasElement.prototype, "captureStream", {
        configurable: true,
        value: () => new FakeMediaStream([{
          kind: "video",
          readyState: "live",
          stop() { this.readyState = "ended"; },
        }]),
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

    if (url.endsWith("/media/publish") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return createResponse({
        ok: true,
        data: {
          sessionDescription: { type: "answer", sdp: "sfu-publish-answer" },
          tracks: body.tracks,
        },
      });
    }

    if (url.endsWith("/media/subscribe") && method === "POST") {
      if (nextSubscribeError) {
        const error = nextSubscribeError;
        nextSubscribeError = null;
        return createResponse({ ok: false, error }, false, 502);
      }
      if (nextSubscribePayload && !subscribePayloadUsed) {
        subscribePayloadUsed = true;
        return createResponse(nextSubscribePayload);
      }
      if (subscribeQueue.length) return createResponse(subscribeQueue.shift());
      return createResponse({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [] } });
    }

    if (url.endsWith("/media/tracks/close") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return createResponse({ ok: true, data: { closed: body.trackNames ?? [], sessionDescription: body.sessionDescription ? { type: "answer", sdp: "sfu-close-answer" } : null } });
    }

    if (url.endsWith("/media/close") && method === "POST") {
      return createResponse({ ok: true, data: { closed: true } });
    }

    if (url === "/api/meetings/history" && method === "GET") {
      return createResponse({
        ok: true,
        data: [{
          meetingId: "btm_history_123",
          title: "Quarterly review",
          status: "ended",
          createdAt: "2026-09-27T10:00:00.000Z",
          endedAt: "2026-09-27T11:00:00.000Z",
          participantRole: "HOST",
          latestRecordingStatus: "STOPPED",
        }],
      });
    }

    if (url === "/api/accounts/register" && method === "POST") {
      return registrationResponse;
    }

    if (url.endsWith("/recording/start")) {
      return createResponse({
        ok: true,
        data: {
          meetingId: "btm_test_123",
          recordingId: "rec-test-1",
          status: "RECORDING",
          startedAt: new Date().toISOString(),
          initiatedByUserId: "host-123",
        },
      });
    }

    if (url.endsWith("/recording/stop")) {
      return createResponse({
        ok: true,
        data: {
          meetingId: "btm_test_123",
          recordingId: "rec-test-1",
          status: "STOPPED",
          stoppedAt: new Date().toISOString(),
          initiatedByUserId: "host-123",
        },
      });
    }

    if (url.endsWith("/recording")) {
      return createResponse({
        ok: true,
        data: [{ meetingId: "btm_test_123", status: "NOT_STARTED" }],
      });
    }

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
          participants: [
            { id: "host-123", userId: "host-123", displayName: "Alex", role: "HOST", state: "JOINED" },
            ...remoteParticipants(),
          ],
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
          role: body.userId === "host-123" ? "HOST" : "PARTICIPANT",
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
          participants: includeRemoteParticipant || additionalRemoteParticipant
            ? [{ id: "host-123", userId: "host-123", displayName: "Alex", role: "HOST", state: "JOINED" }, ...remoteParticipants()]
            : [],
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

  return {
    window,
    document: window.document,
    fetchMock,
    getUserMediaMock,
    micStreams: createdMicStreams,
    cameraStreams: createdCameraStreams,
    setNextSubscribePayload(payload: unknown) { nextSubscribePayload = payload; subscribePayloadUsed = false; },
    queueSubscribePayload(payload: unknown) { subscribeQueue.push(payload); },
    setNextSubscribeError(message: string) { nextSubscribeError = message; },
    setRegistrationResponse(payload: unknown, ok = true, status = 201) { registrationResponse = createResponse(payload, ok, status); },
    setIncludeRemoteParticipant() { includeRemoteParticipant = true; },
    setAdditionalRemoteParticipant(userId: string, displayName: string) {
      additionalRemoteParticipant = { id: "participant-" + userId, userId, displayName, role: "PARTICIPANT", state: "JOINED" };
    },
  };
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

function openRegistration(document: Document): void {
  document.getElementById("openRegistrationBtn")?.click();
  expect(getVisibleScreen(document, "registerScreen")).toBe(true);
}

function fillRegistrationForm(document: Document, overrides: Record<string, string | boolean> = {}): void {
  const values = {
    fullName: "Jane Doe",
    email: "jane@example.com",
    country: "US",
    mobileNumber: "+1 415 555 0100",
    password: "a long passphrase",
    confirmPassword: "a long passphrase",
    terms: true,
    marketingConsent: false,
    ...overrides,
  };
  (document.getElementById("registrationFullName") as HTMLInputElement).value = String(values.fullName);
  (document.getElementById("registrationEmail") as HTMLInputElement).value = String(values.email);
  (document.getElementById("registrationCountry") as HTMLSelectElement).value = String(values.country);
  (document.getElementById("registrationMobile") as HTMLInputElement).value = String(values.mobileNumber);
  (document.getElementById("registrationPassword") as HTMLInputElement).value = String(values.password);
  (document.getElementById("registrationConfirmPassword") as HTMLInputElement).value = String(values.confirmPassword);
  (document.getElementById("registrationTerms") as HTMLInputElement).checked = Boolean(values.terms);
  (document.getElementById("registrationMarketing") as HTMLInputElement).checked = Boolean(values.marketingConsent);
}

function registrationCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return url === "/api/accounts/register" && (init?.method ?? "GET").toUpperCase() === "POST";
  });
}

async function joinHostMeeting(document: Document, title: string): Promise<void> {
  document.getElementById("startMeetingBtn")?.click();
  (document.getElementById("meetingTitle") as HTMLInputElement).value = title;
  (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
  document.getElementById("createMeetingButton")?.click();
  await flush();
  (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
  document.getElementById("joinNowButton")?.click();
  await flush();
}

afterEach(() => {
  openWindows.splice(0).forEach((window) => window.close());
  FakePeerConnection.instances.length = 0;
  FakePeerConnection.negotiationViolations.length = 0;
  FakePeerConnection.subscriberIceTimeouts = 0;
  FakePeerConnection.subscriberTimeoutSdp = "browser-answer-sdp";
  FakePeerConnection.initialRemoteTrackKind = "video";
  vi.restoreAllMocks();
});

describe("BillionTalks browser UI regression tests", () => {
  it("renders the registration screen with all locked fields", async () => {
    const { document } = await loadRenderedPage();
    openRegistration(document);

    for (const id of [
      "registrationFullName",
      "registrationEmail",
      "registrationCountry",
      "registrationMobile",
      "registrationPassword",
      "registrationConfirmPassword",
      "registrationTerms",
      "registrationMarketing",
      "registrationSubmit",
    ]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(document.getElementById("registrationFullName")?.getAttribute("required")).toBe("");
    expect(document.getElementById("registrationTerms")?.getAttribute("required")).toBe("");
    expect(document.getElementById("registrationCountry")?.querySelectorAll("option").length).toBeGreaterThan(200);
    expect(document.body.textContent).toContain("Email verification is required after registration");
  });

  it("shows required-field, password, confirm-password, and Terms validation", async () => {
    const { document, fetchMock } = await loadRenderedPage();
    openRegistration(document);
    document.getElementById("registrationSubmit")?.click();
    await flush();

    expect(document.getElementById("registrationFullNameError")?.textContent).toContain("full name");
    expect(document.getElementById("registrationTermsError")?.textContent).toContain("Accept");
    expect(registrationCalls(fetchMock)).toHaveLength(0);

    fillRegistrationForm(document, { password: "short", confirmPassword: "different", terms: false });
    document.getElementById("registrationSubmit")?.click();
    await flush();
    expect(document.getElementById("registrationPasswordError")?.textContent).toContain("8 characters");
    expect(document.getElementById("registrationConfirmPasswordError")?.textContent).toContain("match");
    expect(document.getElementById("registrationTermsError")?.textContent).toContain("Accept");
    expect(registrationCalls(fetchMock)).toHaveLength(0);
  });

  it("submits the API contract and shows the verification-required success state", async () => {
    const { document, fetchMock } = await loadRenderedPage();
    openRegistration(document);
    fillRegistrationForm(document, { marketingConsent: true });
    document.getElementById("registrationSubmit")?.click();
    await flush();

    const calls = registrationCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [, init] = calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      fullName: "Jane Doe",
      email: "jane@example.com",
      country: "US",
      mobileNumber: "+1 415 555 0100",
      password: "a long passphrase",
      acceptedTerms: true,
      marketingConsent: true,
    });
    expect(document.getElementById("registrationFormPanel")?.hasAttribute("hidden")).toBe(true);
    expect(document.getElementById("registrationSuccessPanel")?.hasAttribute("hidden")).toBe(false);
    expect(document.body.textContent).toContain("Check your email to verify your account");
    expect(document.body.textContent).not.toContain("emailVerificationToken");
  });

  it("displays API errors safely and prevents duplicate submissions", async () => {
    const { document, fetchMock, setRegistrationResponse } = await loadRenderedPage();
    setRegistrationResponse({ ok: false, error: "An account with these details could not be registered." }, false, 409);
    openRegistration(document);
    fillRegistrationForm(document);
    const submit = document.getElementById("registrationSubmit") as HTMLButtonElement;
    submit.click();
    submit.click();
    await flush();

    expect(registrationCalls(fetchMock)).toHaveLength(1);
    expect(document.getElementById("registrationError")?.textContent).toContain("could not be registered");
    expect(document.getElementById("registrationSuccessPanel")?.hasAttribute("hidden")).toBe(true);
  });

  it("keeps the primary control present in the mobile layout", async () => {
    const { document } = await loadRenderedPage();
    openRegistration(document);
    expect(document.querySelector("style")?.textContent).toContain("@media (max-width: 720px)");
    expect(document.getElementById("registrationSubmit")?.textContent).toContain("Create account");
    expect(document.getElementById("registrationSubmit")?.getBoundingClientRect).toBeDefined();
  });

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

  it("shows expandable read-only meeting history details on Home", async () => {
    const { document } = await loadRenderedPage();
    document.getElementById("startMeetingBtn")?.click();
    document.getElementById("backToHomeFromCreate")?.click();
    await flush();

    const historyList = document.getElementById("meetingHistoryList");
    expect(historyList?.textContent).toContain("Quarterly review");
    const historyDetails = historyList?.querySelector("details");
    expect(historyDetails).not.toBeNull();
    historyDetails?.querySelector("summary")?.dispatchEvent(new document.defaultView!.MouseEvent("click", { bubbles: true }));

    expect(historyDetails?.textContent).toContain("btm_history_123");
    expect(historyDetails?.textContent).toContain("ended");
    expect(historyDetails?.textContent).toContain("HOST");
    expect(historyDetails?.textContent).toContain("STOPPED");
    expect(historyDetails?.querySelector("a, button")).toBeNull();
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

  it("opens a meeting invite URL into the existing prejoin flow", async () => {
    const { document, fetchMock } = await loadRenderedPage("http://localhost/?meeting=btm_test_123");
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/meetings/btm_test_123");
    expect(getVisibleScreen(document, "prejoinScreen")).toBe(true);
  });

  it("copies a shareable meeting URL from the room controls", async () => {
    const { document } = await loadRenderedPage();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(document.defaultView!.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    document.getElementById("startMeetingBtn")?.click();
    (document.getElementById("meetingTitle") as HTMLInputElement).value = "Invite room";
    (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();
    document.getElementById("copyMeetingIdBtn")?.click();
    await flush();

    expect(writeText).toHaveBeenCalledWith("http://localhost/?meeting=btm_test_123");
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

  it("shows recording lifecycle status and host start/stop controls in the meeting room", async () => {
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
    expect((document.getElementById("recordingControls") as HTMLElement).style.display).toBe("flex");
    expect(document.getElementById("recordingStatus")?.textContent).toContain("Not started");

    // The fake browser has no AudioContext, so recording only runs without live microphone audio.
    (document.getElementById("micControlBtn") as HTMLButtonElement).click();
    await flush();
    document.getElementById("startRecordingBtn")?.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/meetings/btm_test_123/recording/start", expect.objectContaining({ method: "POST" }));
    expect(document.getElementById("recordingStatus")?.textContent).toContain("Recording meeting media");

    document.getElementById("stopRecordingBtn")?.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/meetings/btm_test_123/recording/rec-test-1/parts/1",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "X-Recording-Final-Part": "true" }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/meetings/btm_test_123/recording/stop", expect.objectContaining({ method: "POST" }));
    expect(document.getElementById("recordingStatus")?.textContent).toContain("Recording saved to private storage");
  });

  it("publishes existing microphone and camera captures through SFU signaling and closes them when toggled off", async () => {
    const { window, document, fetchMock, getUserMediaMock } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });

    document.getElementById("startMeetingBtn")?.click();
    (document.getElementById("meetingTitle") as HTMLInputElement).value = "SFU media check";
    (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    const micControl = document.getElementById("micControlBtn") as HTMLButtonElement;
    // Mic and camera are ON at join and must publish without any toggling.
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    const publishBodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/publish") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(publishBodies.flatMap((body) => body.tracks.map((track: { trackName: string }) => track.trackName))).toEqual(expect.arrayContaining(["microphone", "camera"]));
    expect(publishBodies.every((body) => body.connectionId && body.sessionDescription && !("userId" in body))).toBe(true);
    const readyCalls = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/publish/ready") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(readyCalls.flatMap((body) => body.trackNames)).toEqual(expect.arrayContaining(["microphone", "camera"]));

    micControl.click();
    await flush();
    const closeBody = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/tracks/close") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body))).at(-1);
    expect(closeBody.trackNames).toContain("microphone");
  });

  it("publishes and stops screen share using the existing share control", async () => {
    const { window, document, fetchMock, getUserMediaMock, micStreams, cameraStreams } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    const screenTracks = [0, 1].map((index) => {
      const track: any = {
        id: "screen-share-track-" + index,
        kind: "video",
        readyState: "live",
        stop: vi.fn(() => { track.readyState = "ended"; }),
        addEventListener: vi.fn(),
      };
      return track;
    });
    let screenCaptureIndex = 0;
    Object.defineProperty(window.navigator.mediaDevices, "getDisplayMedia", {
      value: vi.fn(async () => {
        const track = screenTracks[screenCaptureIndex++];
        return { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
      }),
      configurable: true,
    });

    document.getElementById("startMeetingBtn")?.click();
    (document.getElementById("meetingTitle") as HTMLInputElement).value = "Screen share check";
    (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();
    const micControl = document.getElementById("micControlBtn") as HTMLButtonElement;
    expect(micControl).not.toBeNull();
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);

    document.getElementById("shareScreenBtn")?.click();
    await flush();
    const publishBody = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/publish") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body))).find((body) => body.tracks.some((track: { trackName: string }) => track.trackName === "screen-video"));
    expect(publishBody).toBeTruthy();
    const firstShareReady = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/publish/ready") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body))).find((body) => body.trackNames.includes("screen-video"));
    expect(firstShareReady).toBeTruthy();

    const initialPublisher = FakePeerConnection.instances.find((peer) => peer.getTransceivers().some((entry) => entry.sender.track === screenTracks[0]));
    expect(initialPublisher).toBeTruthy();
    initialPublisher!.setConnectionStates("failed", "failed");
    initialPublisher!.onconnectionstatechange?.();
    initialPublisher!.oniceconnectionstatechange?.();
    await flush();
    await flush();
    const recoveryCalls = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/recover") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(recoveryCalls).toEqual([expect.objectContaining({ direction: "publisher" })]);
    const recoveredPublisher = FakePeerConnection.instances.filter((peer) => peer.getTransceivers().some((entry) => entry.sender.track === screenTracks[0])).at(-1);
    expect(recoveredPublisher).not.toBe(initialPublisher);
    const recoveryPublish = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/publish") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)))
      .filter((body) => body.tracks.some((track: { trackName: string }) => track.trackName === "screen-video"))
      .at(-1);
    expect(recoveryPublish?.tracks.map((track: { trackName: string }) => track.trackName)).toEqual(expect.arrayContaining(["microphone", "camera", "screen-video"]));

    document.getElementById("shareScreenBtn")?.click();
    await flush();
    const closeBody = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/tracks/close") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body))).at(-1);
    expect(closeBody.trackNames).toEqual(["screen-video"]);
    expect(screenTracks[0].stop).toHaveBeenCalled();
    expect(micStreams[0]?.getAudioTracks()[0]?.readyState).toBe("live");
    expect(cameraStreams[0]?.getVideoTracks()[0]?.readyState).toBe("live");

    document.getElementById("shareScreenBtn")?.click();
    await flush();
    const sharePublishBodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/publish") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)))
      .filter((body) => body.tracks.some((track: { trackName: string }) => track.trackName === "screen-video"));
    expect(screenCaptureIndex).toBe(2);
    expect(sharePublishBodies).toHaveLength(3);
    expect(sharePublishBodies.every((body) => body.tracks.filter((track: { trackName: string }) => track.trackName === "screen-video").length === 1)).toBe(true);
    expect(sharePublishBodies[0].tracks.find((track: { trackName: string }) => track.trackName === "screen-video").mid)
      .not.toBe(sharePublishBodies[2].tracks.find((track: { trackName: string }) => track.trackName === "screen-video").mid);

    document.getElementById("shareScreenBtn")?.click();
    await flush();
    const finalCloseBody = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/tracks/close") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body))).at(-1);
    expect(finalCloseBody.trackNames).toEqual(["screen-video"]);
    expect(screenTracks[1].stop).toHaveBeenCalled();
    expect(micStreams[0]?.getAudioTracks()[0]?.readyState).toBe("live");
    expect(cameraStreams[0]?.getVideoTracks()[0]?.readyState).toBe("live");
  });

  async function setupPublisherWithMedia(shareCount: number) {
    const page = await loadRenderedPage();
    const { window, document } = page;
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    const screenTracks = Array.from({ length: shareCount }, (_unused, index) => {
      const track: any = {
        id: "lifecycle-screen-" + index,
        kind: "video",
        readyState: "live",
        stop: vi.fn(() => { track.readyState = "ended"; }),
        addEventListener: vi.fn(),
      };
      return track;
    });
    let captureIndex = 0;
    Object.defineProperty(window.navigator.mediaDevices, "getDisplayMedia", {
      value: vi.fn(async () => {
        const track = screenTracks[captureIndex++];
        return { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
      }),
      configurable: true,
    });
    await joinHostMeeting(document, "Share lifecycle");
    return { ...page, screenTracks };
  }

  function bodiesFor(fetchMock: ReturnType<typeof vi.fn>, suffix: string) {
    return fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith(suffix) && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
  }

  const publisherPeers = () => FakePeerConnection.instances.filter((peer) => !peer.ontrack && peer.getTransceivers().length);

  it("keeps one publisher PeerConnection with stable m-line order across repeated screen-share start/stop", async () => {
    const { document, fetchMock, screenTracks, micStreams, cameraStreams } = await setupPublisherWithMedia(3);
    const names = (body: any) => body.tracks.map((track: { trackName: string }) => track.trackName);
    expect(bodiesFor(fetchMock, "/media/publish").flatMap(names)).toEqual(["microphone", "camera"]);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      document.getElementById("shareScreenBtn")?.click();
      await flush();
      document.getElementById("shareScreenBtn")?.click();
      await flush();
    }

    const publishers = publisherPeers();
    expect(publishers).toHaveLength(1);
    const transceivers = publishers[0].getTransceivers();
    expect(transceivers.map((entry) => entry.sender.track.id)).toEqual([
      "audio-track-1", "video-track-1", "lifecycle-screen-0", "lifecycle-screen-1", "lifecycle-screen-2",
    ]);
    expect(transceivers.map((entry) => entry.mid)).toEqual(["0", "1", "2", "3", "4"]);
    expect(bodiesFor(fetchMock, "/media/publish").flatMap(names)).toEqual(["microphone", "camera", "screen-video", "screen-video", "screen-video"]);
    expect(transceivers.slice(0, 2).every((entry) => !entry.stop.mock.calls.length)).toBe(true);
    expect(transceivers.slice(2).every((entry) => entry.stop.mock.calls.length === 1)).toBe(true);

    const closes = bodiesFor(fetchMock, "/media/tracks/close");
    expect(closes.map((body) => body.trackNames)).toEqual([["screen-video"], ["screen-video"], ["screen-video"]]);
    expect(closes.every((body) => body.sessionDescription?.type === "offer")).toBe(true);
    expect(publishers[0].remoteDescription).toEqual({ type: "answer", sdp: "sfu-close-answer" });
    expect(publishers[0].signalingState).toBe("stable");
    expect(FakePeerConnection.negotiationViolations).toEqual([]);
    expect(bodiesFor(fetchMock, "/media/recover")).toHaveLength(0);
    screenTracks.forEach((track) => expect(track.stop).toHaveBeenCalled());
    expect(micStreams[0].getAudioTracks()[0].readyState).toBe("live");
    expect(cameraStreams[0].getVideoTracks()[0].readyState).toBe("live");
  });

  it("serializes overlapping share start/stop publisher negotiations", async () => {
    const { document } = await setupPublisherWithMedia(2);
    const share = document.getElementById("shareScreenBtn") as HTMLButtonElement;
    share.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    share.click();
    share.click();
    await flush();
    await flush();
    expect(FakePeerConnection.negotiationViolations).toEqual([]);
    expect(publisherPeers()).toHaveLength(1);
    expect(publisherPeers()[0].signalingState).toBe("stable");
  });

  it("recovers the publisher after a screen-share lifecycle without republishing the stopped share", async () => {
    const { document, fetchMock, screenTracks } = await setupPublisherWithMedia(2);
    const share = document.getElementById("shareScreenBtn") as HTMLButtonElement;
    share.click();
    await flush();
    share.click();
    await flush();

    const failed = publisherPeers()[0];
    failed.setConnectionStates("failed", "failed");
    await flush();
    await flush();
    expect(bodiesFor(fetchMock, "/media/recover")).toEqual([expect.objectContaining({ direction: "publisher" })]);
    const recoveryPublish = bodiesFor(fetchMock, "/media/publish").at(-1);
    expect(recoveryPublish.tracks.map((track: { trackName: string }) => track.trackName)).toEqual(["microphone", "camera"]);
    expect(recoveryPublish.tracks.map((track: { mid: string }) => track.mid)).toEqual(["0", "1"]);

    share.click();
    await flush();
    const recovered = publisherPeers().at(-1)!;
    expect(recovered).not.toBe(failed);
    expect(recovered.getTransceivers().map((entry) => entry.sender.track.id)).toEqual(["audio-track-1", "video-track-1", screenTracks[1].id]);
    expect(FakePeerConnection.negotiationViolations).toEqual([]);
  });

  it("keeps remote camera and microphone live while remote screen share starts, stops, and restarts as a distinct stream", async () => {
    const { window, document, fetchMock, setNextSubscribePayload, queueSubscribePayload, setIncludeRemoteParticipant } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    setIncludeRemoteParticipant();
    const remote = { publisherUserId: "remote-user", publisherDisplayName: "Remote Guest" };
    const camera = { ...remote, mid: "remote-0", trackName: "camera", publicationKey: "remote-camera" };
    const microphone = { ...remote, mid: "remote-1", trackName: "microphone", publicationKey: "remote-microphone" };
    const screen = { ...remote, mid: "remote-2", trackName: "screen-video", publicationKey: "remote-screen" };
    setNextSubscribePayload({ ok: true, data: { operationId: "op-1", sessionDescription: { type: "offer", sdp: "offer-initial" }, tracks: [camera, microphone] } });
    await joinHostMeeting(document, "Remote share");

    const subscriber = FakePeerConnection.instances.find((peer) => peer.ontrack)!;
    const microphoneTrack = createFakeRemoteTrack("remote-mic", "audio");
    subscriber.emitTrack("remote-1", microphoneTrack);
    const tile = () => document.querySelector('#videoStage .tile[data-user-id="remote-user"]')!;
    const cameraStream = (tile().querySelector("video.remote-media") as HTMLVideoElement).srcObject as unknown as FakeMediaStream;
    const cameraTrack = cameraStream.getVideoTracks()[0];
    expect(cameraStream.getAudioTracks()).toEqual([microphoneTrack]);
    expect(tile().querySelector("video.remote-screen-media")).toBeNull();

    queueSubscribePayload({ ok: true, data: { operationId: "op-a", sessionDescription: { type: "offer", sdp: "offer-screen-a" }, tracks: [screen] } });
    (document.getElementById("micControlBtn") as HTMLButtonElement).click();
    (document.getElementById("micControlBtn") as HTMLButtonElement).click();
    await flush();
    const firstScreen = createFakeRemoteTrack("remote-screen-a", "video");
    subscriber.emitTrack("remote-2", firstScreen);
    const screenElement = tile().querySelector("video.remote-screen-media") as HTMLVideoElement;
    expect((screenElement.srcObject as unknown as FakeMediaStream).getVideoTracks()).toEqual([firstScreen]);
    expect(cameraStream.getVideoTracks()).toEqual([cameraTrack]);

    queueSubscribePayload({ ok: true, data: { operationId: "op-remove", sessionDescription: { type: "offer", sdp: "offer-removal" }, tracks: [], removed: [screen] } });
    queueSubscribePayload({ ok: true, data: { operationId: "op-restart", sessionDescription: { type: "offer", sdp: "offer-screen-restart" }, tracks: [screen] } });
    (document.getElementById("cameraControlBtn") as HTMLButtonElement).click();
    (document.getElementById("cameraControlBtn") as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(firstScreen.stop).toHaveBeenCalled();
    const restartedScreen = createFakeRemoteTrack("remote-screen-restart", "video");
    subscriber.emitTrack("remote-2", restartedScreen);
    expect(cameraTrack.stop).not.toHaveBeenCalled();
    expect(microphoneTrack.stop).not.toHaveBeenCalled();
    expect(cameraStream.getTracks()).toEqual([cameraTrack, microphoneTrack]);
    expect(((tile().querySelector("video.remote-screen-media") as HTMLVideoElement).srcObject as unknown as FakeMediaStream).getVideoTracks()).toEqual([restartedScreen]);

    expect(bodiesFor(fetchMock, "/media/renegotiate").map((body) => body.operationId)).toEqual(["op-1", "op-a", "op-remove", "op-restart"]);
    expect(FakePeerConnection.instances.filter((peer) => peer.ontrack)).toHaveLength(1);
    expect(FakePeerConnection.negotiationViolations).toEqual([]);
  });

  it("disables screen share and explains capability when getDisplayMedia is unavailable", async () => {
    const { window, document, fetchMock } = await loadRenderedPage("http://localhost/", false);
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    expect(window.navigator.mediaDevices.getDisplayMedia).toBeUndefined();

    await joinHostMeeting(document, "Unsupported screen share");
    const shareButton = document.getElementById("shareScreenBtn") as HTMLButtonElement;
    const unavailableMessage = document.getElementById("screenShareUnavailableMessage");
    expect(shareButton.disabled).toBe(true);
    expect(unavailableMessage?.textContent).toBe("Screen sharing is not supported by this browser or device.");
    expect(unavailableMessage?.style.display).not.toBe("none");

    shareButton.click();
    await flush();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/publish") && init?.method === "POST" && String(init?.body).includes("screen-video"))).toHaveLength(0);
  });

  it("subscribes to a remote SFU video track and renders it in the matching participant tile", async () => {
    const { window, document, fetchMock, setNextSubscribePayload, setIncludeRemoteParticipant } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    Object.defineProperty(window, "MediaStream", { value: FakeMediaStream, configurable: true });
    setIncludeRemoteParticipant();
    setNextSubscribePayload({
      ok: true,
      data: {
        operationId: "remote-subscription-operation",
        sessionDescription: { type: "offer", sdp: "sfu-remote-offer" },
        tracks: [{ mid: "remote-0", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "camera" }],
      },
    });

    document.getElementById("startMeetingBtn")?.click();
    (document.getElementById("meetingTitle") as HTMLInputElement).value = "Remote track check";
    (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    const remoteTile = document.querySelector('#videoStage .tile[data-user-id="remote-user"]');
    const remoteVideo = remoteTile?.querySelector("video.remote-media") as HTMLVideoElement | null;
    expect(remoteVideo).not.toBeNull();
    expect((remoteVideo?.srcObject as unknown as FakeMediaStream).getVideoTracks()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/meetings/btm_test_123/media/renegotiate", expect.objectContaining({ method: "POST" }));
  });

  it("replaces remote camera, microphone, and screen-share tracks idempotently without affecting another participant", async () => {
    const { window, document, setNextSubscribePayload, setIncludeRemoteParticipant, setAdditionalRemoteParticipant } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    Object.defineProperty(window, "MediaStream", { value: FakeMediaStream, configurable: true });
    setIncludeRemoteParticipant();
    setAdditionalRemoteParticipant("other-user", "Other Guest");
    setNextSubscribePayload({
      ok: true,
      data: {
        operationId: "remote-replacement-operation",
        sessionDescription: { type: "offer", sdp: "sfu-remote-offer" },
        tracks: [
          { mid: "remote-0", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "camera", publicationKey: "remote-camera" },
          { mid: "remote-1", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "microphone", publicationKey: "remote-microphone" },
          { mid: "remote-2", publisherUserId: "other-user", publisherDisplayName: "Other Guest", trackName: "camera", publicationKey: "other-camera" },
          { mid: "remote-3", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "screen-video", publicationKey: "remote-screen" },
        ],
      },
    });

    document.getElementById("startMeetingBtn")?.click();
    (document.getElementById("meetingTitle") as HTMLInputElement).value = "Track replacement check";
    (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    const subscriber = FakePeerConnection.instances.find((peer) => peer.ontrack);
    expect(subscriber).toBeTruthy();
    const remoteTile = document.querySelector('#videoStage .tile[data-user-id="remote-user"]');
    const otherTile = document.querySelector('#videoStage .tile[data-user-id="other-user"]');
    const remoteVideo = remoteTile?.querySelector("video.remote-media") as HTMLVideoElement | null;
    const remoteStream = remoteVideo?.srcObject as unknown as FakeMediaStream;
    expect(remoteVideo).not.toBeNull();
    expect(remoteStream.getVideoTracks()).toHaveLength(1);

    const firstCamera = remoteStream.getVideoTracks()[0];
    const firstMicrophone = createFakeRemoteTrack("remote-mic-first", "audio");
    const firstScreenShare = createFakeRemoteTrack("remote-screen-first", "video");
    const unrelatedCamera = createFakeRemoteTrack("other-camera", "video");
    subscriber!.emitTrack("remote-1", firstMicrophone);
    subscriber!.emitTrack("remote-2", unrelatedCamera);
    subscriber!.emitTrack("remote-3", firstScreenShare);
    const nextCamera = createFakeRemoteTrack("remote-camera-next", "video");
    subscriber!.emitTrack("remote-0", nextCamera);
    const nextMicrophone = createFakeRemoteTrack("remote-mic-next", "audio");
    subscriber!.emitTrack("remote-1", nextMicrophone);
    const nextScreenShare = createFakeRemoteTrack("remote-screen-next", "video");
    subscriber!.emitTrack("remote-3", nextScreenShare);

    expect(firstCamera.stop).toHaveBeenCalledTimes(1);
    expect(firstMicrophone.stop).toHaveBeenCalledTimes(1);
    expect(firstScreenShare.stop).toHaveBeenCalledTimes(1);
    const screenStream = (remoteTile?.querySelector("video.remote-screen-media") as HTMLVideoElement).srcObject as unknown as FakeMediaStream;
    expect(remoteStream.getVideoTracks()).toEqual([nextCamera]);
    expect(screenStream.getVideoTracks()).toEqual([nextScreenShare]);
    expect(remoteStream.getAudioTracks()).toEqual([nextMicrophone]);
    expect(remoteStream.getTracks()).toHaveLength(2);
    expect(remoteTile?.querySelectorAll("video.remote-media")).toHaveLength(1);
    expect(remoteTile?.querySelectorAll("audio.remote-media")).toHaveLength(0);
    expect(otherTile?.querySelectorAll("video.remote-media")).toHaveLength(1);
    expect(((otherTile?.querySelector("video.remote-media") as HTMLVideoElement).srcObject as unknown as FakeMediaStream).getVideoTracks()).toEqual([unrelatedCamera]);

    const finalCamera = createFakeRemoteTrack("remote-camera-final", "video");
    const finalMicrophone = createFakeRemoteTrack("remote-mic-final", "audio");
    const finalScreenShare = createFakeRemoteTrack("remote-screen-final", "video");
    subscriber!.emitTrack("remote-0", finalCamera);
    subscriber!.emitTrack("remote-0", finalCamera);
    subscriber!.emitTrack("remote-1", finalMicrophone);
    subscriber!.emitTrack("remote-1", finalMicrophone);
    subscriber!.emitTrack("remote-3", finalScreenShare);
    subscriber!.emitTrack("remote-3", finalScreenShare);

    expect(nextCamera.stop).toHaveBeenCalledTimes(1);
    expect(nextMicrophone.stop).toHaveBeenCalledTimes(1);
    expect(nextScreenShare.stop).toHaveBeenCalledTimes(1);
    expect(remoteStream.getVideoTracks()).toEqual([finalCamera]);
    expect(screenStream.getVideoTracks()).toEqual([finalScreenShare]);
    expect(remoteStream.getAudioTracks()).toEqual([finalMicrophone]);
    expect(remoteStream.getTracks()).toHaveLength(2);
    expect(remoteTile?.querySelectorAll("video.remote-media")).toHaveLength(1);
    expect(remoteTile?.querySelectorAll("audio.remote-media")).toHaveLength(0);
    expect((remoteTile?.querySelector("video.remote-media") as HTMLVideoElement)).toBe(remoteVideo);
    expect(unrelatedCamera.stop).not.toHaveBeenCalled();
    expect(((otherTile?.querySelector("video.remote-media") as HTMLVideoElement).srcObject as unknown as FakeMediaStream).getVideoTracks()).toEqual([unrelatedCamera]);
  });

  it("reports autoplay blocking separately and retries remote microphone playback after interaction", async () => {
    const { window, document, fetchMock, setNextSubscribePayload, setIncludeRemoteParticipant } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    Object.defineProperty(window, "MediaStream", { value: FakeMediaStream, configurable: true });
    FakePeerConnection.initialRemoteTrackKind = "audio";
    setIncludeRemoteParticipant();
    setNextSubscribePayload({
      ok: true,
      data: {
        operationId: "remote-audio-autoplay-operation",
        sessionDescription: { type: "offer", sdp: "sfu-remote-audio-offer" },
        tracks: [{ mid: "remote-0", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "microphone", publicationKey: "remote-microphone" }],
      },
    });
    let rejectFirstRemotePlay = true;
    const playMock = vi.fn(function (this: HTMLMediaElement) {
      if (this.classList.contains("remote-media") && rejectFirstRemotePlay) {
        rejectFirstRemotePlay = false;
        return Promise.reject(new window.DOMException("Playback requires a user gesture.", "NotAllowedError"));
      }
      return Promise.resolve();
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, "play", { value: playMock, configurable: true });

    document.getElementById("startMeetingBtn")?.click();
    (document.getElementById("meetingTitle") as HTMLInputElement).value = "Autoplay check";
    (document.getElementById("hostName") as HTMLInputElement).value = "Alex";
    document.getElementById("createMeetingButton")?.click();
    await flush();
    (document.getElementById("displayNameInput") as HTMLInputElement).value = "Alex";
    document.getElementById("joinNowButton")?.click();
    await flush();

    const remoteTile = document.querySelector('#videoStage .tile[data-user-id="remote-user"]');
    const remoteAudio = remoteTile?.querySelector("audio.remote-media") as HTMLAudioElement | null;
    expect(remoteAudio).not.toBeNull();
    expect((remoteAudio?.srcObject as unknown as FakeMediaStream).getAudioTracks()).toHaveLength(1);
    expect((document.getElementById("enableRemotePlaybackBtn") as HTMLButtonElement).style.display).toBe("inline-flex");
    expect(document.getElementById("mediaStatus")?.textContent).toContain("user interaction");
    expect(fetchMock).toHaveBeenCalledWith("/api/meetings/btm_test_123/media/renegotiate", expect.objectContaining({ method: "POST" }));
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    document.getElementById("enableRemotePlaybackBtn")?.click();
    await flush();
    expect(playMock).toHaveBeenCalled();
    expect((document.getElementById("enableRemotePlaybackBtn") as HTMLButtonElement).style.display).toBe("none");
    expect(document.getElementById("mediaStatus")?.textContent).not.toContain("user interaction");
  });

  it("rebuilds a failed publisher once and republishes active camera and microphone without rejoining", async () => {
    const { window, document, fetchMock } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    await joinHostMeeting(document, "Publisher recovery");

    const publisherPeers = () => FakePeerConnection.instances.filter((peer) => peer.getTransceivers().some((transceiver) => transceiver.direction === "sendonly"));
    const originalPublisher = publisherPeers().at(-1);
    expect(originalPublisher?.connectionState).toBe("connected");
    const initialPublishCount = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/publish") && init?.method === "POST").length;
    const initialReadyCount = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/publish/ready") && init?.method === "POST").length;
    const joinCount = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/join") && init?.method === "POST").length;

    originalPublisher!.setConnectionStates("failed", "failed");
    originalPublisher!.onconnectionstatechange?.();
    originalPublisher!.oniceconnectionstatechange?.();
    await flush();
    await flush();

    const recoveryCalls = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/recover") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(recoveryCalls).toEqual([expect.objectContaining({ direction: "publisher" })]);
    const publishBodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/publish") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(publishBodies.length).toBeGreaterThan(initialPublishCount);
    expect(publishBodies.at(-1).tracks.map((track: { trackName: string }) => track.trackName)).toEqual(expect.arrayContaining(["microphone", "camera"]));
    expect(publisherPeers().at(-1)).not.toBe(originalPublisher);
    expect(publisherPeers().at(-1)?.connectionState).toBe("connected");
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/publish/ready") && init?.method === "POST")).toHaveLength(initialReadyCount + 1);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/join") && init?.method === "POST")).toHaveLength(joinCount);
  });

  it("rebuilds a failed subscriber once and re-subscribes without duplicating tracks or membership", async () => {
    const { window, document, fetchMock, setNextSubscribePayload, setIncludeRemoteParticipant } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    Object.defineProperty(window, "MediaStream", { value: FakeMediaStream, configurable: true });
    setIncludeRemoteParticipant();
    const subscribePayload = (sdp: string) => ({
      ok: true,
      data: {
        operationId: "subscriber-recovery-" + sdp,
        sessionDescription: { type: "offer", sdp },
        tracks: [{ mid: "remote-0", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "camera", publicationKey: "remote-camera" }],
      },
    });
    setNextSubscribePayload(subscribePayload("initial-offer"));
    await joinHostMeeting(document, "Subscriber recovery");

    const subscriberPeers = () => FakePeerConnection.instances.filter((peer) => Boolean(peer.ontrack));
    const originalSubscriber = subscriberPeers().at(-1);
    const oldVideo = document.querySelector('#videoStage .tile[data-user-id="remote-user"] video.remote-media') as HTMLVideoElement;
    const obsoleteTrack = (oldVideo.srcObject as unknown as FakeMediaStream).getVideoTracks()[0];
    expect(originalSubscriber?.connectionState).toBe("connected");
    const subscriptionsBeforeRecovery = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/subscribe") && init?.method === "POST").length;
    const renegotiationsBeforeRecovery = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/renegotiate") && init?.method === "POST").length;
    setNextSubscribePayload(subscribePayload("recovered-offer"));
    const joinCount = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/join") && init?.method === "POST").length;

    originalSubscriber!.setConnectionStates("failed", "failed");
    originalSubscriber!.onconnectionstatechange?.();
    originalSubscriber!.oniceconnectionstatechange?.();
    await flush();
    await flush();

    const recoveryCalls = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/recover") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(recoveryCalls).toEqual([expect.objectContaining({ direction: "subscriber" })]);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/subscribe") && init?.method === "POST")).toHaveLength(subscriptionsBeforeRecovery + 1);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/renegotiate") && init?.method === "POST")).toHaveLength(renegotiationsBeforeRecovery + 1);
    expect(obsoleteTrack.stop).toHaveBeenCalled();
    expect(subscriberPeers().at(-1)).not.toBe(originalSubscriber);
    const recoveredTile = document.querySelector('#videoStage .tile[data-user-id="remote-user"]');
    const recoveredVideo = recoveredTile?.querySelector("video.remote-media") as HTMLVideoElement | null;
    expect(recoveredVideo).not.toBeNull();
    expect((recoveredVideo?.srcObject as unknown as FakeMediaStream).getVideoTracks()).toHaveLength(1);
    expect(recoveredTile?.querySelectorAll("video.remote-media")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/join") && init?.method === "POST")).toHaveLength(joinCount);
  });

  describe("subscriber ICE timeout and recovery", () => {
    const subscribePayload = (operationId: string, withMicrophone = false) => ({
      ok: true,
      data: {
        operationId,
        sessionDescription: { type: "offer", sdp: operationId },
        tracks: [
          { mid: "remote-0", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "camera", publicationKey: "remote-camera" },
          ...(withMicrophone ? [{ mid: "remote-1", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "microphone", publicationKey: "remote-microphone" }] : []),
        ],
        diagnostics: { discovered: withMicrophone ? 2 : 1, subscribed: 0, publishers: {} },
      },
    });
    const settle = async () => { for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 40)); };
    const subscriberPeers = () => FakePeerConnection.instances.filter((peer) => Boolean(peer.ontrack));
    const publisherPeerList = () => FakePeerConnection.instances.filter((peer) => peer.getTransceivers().some((entry) => entry.direction === "sendonly"));
    const callsTo = (fetchMock: ReturnType<typeof vi.fn>, suffix: string) => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(suffix) && init?.method === "POST");
    const remoteVideo = (document: Document) => document.querySelector('#videoStage .tile[data-user-id="remote-user"] video.remote-media') as HTMLVideoElement | null;

    // Mimics the server: one pending offer per subscriber session generation until it is answered; recovery starts a new generation.
    function installSubscribeServer(page: Awaited<ReturnType<typeof loadRenderedPage>>, withMicrophone = false) {
      const original = page.fetchMock.getMockImplementation()!;
      let generation = 0;
      let negotiated = -1;
      page.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/media/recover") && JSON.parse(String(init?.body)).direction === "subscriber") generation += 1;
        if (url.endsWith("/media/renegotiate")) negotiated = generation;
        if (url.endsWith("/media/subscribe")) {
          if (negotiated === generation) return createResponse({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [] } });
          return createResponse(subscribePayload("op-" + generation, withMicrophone));
        }
        return original(input, init);
      });
    }

    async function setup(timeouts: number, withMicrophone = false) {
      const page = await loadRenderedPage();
      Object.defineProperty(page.window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
      Object.defineProperty(page.window, "MediaStream", { value: FakeMediaStream, configurable: true });
      (page.window as any).btIceGatheringTimeoutMs = 30;
      FakePeerConnection.subscriberIceTimeouts = timeouts;
      page.setIncludeRemoteParticipant();
      installSubscribeServer(page, withMicrophone);
      await joinHostMeeting(page.document, "ICE timeout");
      await settle();
      return page;
    }

    it("recovers the subscriber and re-subscribes every active publication after an ICE timeout, keeping the publisher", async () => {
      const { window, document, fetchMock, getUserMediaMock } = await setup(1, true);
      const peers = subscriberPeers();
      expect(peers).toHaveLength(2);
      expect(peers[0].connectionState).toBe("closed");
      expect(peers[1].connectionState).toBe("connected");
      expect(callsTo(fetchMock, "/media/recover").map(([, init]) => JSON.parse(String(init?.body)))).toEqual([expect.objectContaining({ direction: "subscriber" })]);
      expect(callsTo(fetchMock, "/media/subscribe").length).toBeGreaterThanOrEqual(2);
      expect(callsTo(fetchMock, "/media/renegotiate")).toHaveLength(1);
      expect(JSON.parse(String(callsTo(fetchMock, "/media/renegotiate")[0][1]?.body)).operationId).toBe("op-1");

      peers[1].emitTrack("remote-1", createFakeRemoteTrack("recovered-mic", "audio"));
      const diagnostics = (window as any).btMediaDiagnostics();
      expect(diagnostics).toEqual(expect.objectContaining({
        iceTimeoutCount: 1,
        subscriberRecoveryCount: 1,
        subscriptionResultCount: 2,
        remotePublicationCount: 2,
        connectionState: "connected",
        iceConnectionState: "connected",
        iceGatheringState: "complete",
        mediaStreamTrackCount: 2,
        videoSrcObjectAssigned: true,
        remoteVideoTrackReadyStates: ["live"],
        lastPlay: "success",
      }));
      expect(diagnostics.ontrackCount).toBeGreaterThanOrEqual(2);

      expect(publisherPeerList()).toHaveLength(1);
      expect(publisherPeerList()[0].connectionState).toBe("connected");
      expect(getUserMediaMock).toHaveBeenCalledTimes(2);
      expect(callsTo(fetchMock, "/join")).toHaveLength(1);
      expect(callsTo(fetchMock, "/media/recover").some(([, init]) => String(init?.body).includes("publisher"))).toBe(false);
      expect(document.querySelectorAll('#videoStage .tile[data-user-id="remote-user"]')).toHaveLength(1);
      expect(FakePeerConnection.negotiationViolations).toEqual([]);
    });

    it("continues without recovery when ICE gathering times out but candidates were already gathered", async () => {
      FakePeerConnection.subscriberTimeoutSdp = "v=0\r\na=candidate:1 1 udp 1 10.0.0.2 5000 typ host\r\n";
      const { fetchMock, window } = await setup(1);
      expect(subscriberPeers()).toHaveLength(1);
      expect(callsTo(fetchMock, "/media/recover")).toHaveLength(0);
      expect(callsTo(fetchMock, "/media/renegotiate")).toHaveLength(1);
      expect((window as any).btMediaDiagnostics().iceTimeoutCount).toBe(1);
    });

    it("assigns a fresh stream and video element after recovery and stops the stale track", async () => {
      const { document, window } = await setup(0);
      const [original] = subscriberPeers();
      const staleVideo = remoteVideo(document)!;
      const staleStream = staleVideo.srcObject as unknown as FakeMediaStream;
      const staleTrack = staleStream.getVideoTracks()[0];
      original.setConnectionStates("failed", "failed");
      await settle();

      const freshVideo = remoteVideo(document)!;
      const freshStream = freshVideo.srcObject as unknown as FakeMediaStream;
      expect(freshVideo).not.toBe(staleVideo);
      expect(staleVideo.isConnected).toBe(false);
      expect(staleVideo.srcObject).toBeNull();
      expect(freshStream).not.toBe(staleStream);
      expect(freshStream.getVideoTracks()).toHaveLength(1);
      expect(freshStream.getVideoTracks()[0]).not.toBe(staleTrack);
      expect(staleTrack.stop).toHaveBeenCalled();
      expect((window as any).btMediaDiagnostics().remoteVideoTrackReadyStates).toEqual(["live"]);
    });

    it("applies the muted autoplay fallback to the recovered video element", async () => {
      const page = await loadRenderedPage();
      const { window, document } = page;
      Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
      Object.defineProperty(window, "MediaStream", { value: FakeMediaStream, configurable: true });
      page.setIncludeRemoteParticipant();
      installSubscribeServer(page);
      Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: vi.fn(function (this: HTMLMediaElement) {
          if (this.classList.contains("remote-media") && !this.muted) {
            return Promise.reject(new window.DOMException("Playback requires a user gesture.", "NotAllowedError"));
          }
          return Promise.resolve();
        }),
      });
      await joinHostMeeting(document, "Autoplay after recovery");
      await settle();
      expect(remoteVideo(document)!.muted).toBe(true);

      subscriberPeers()[0].setConnectionStates("failed", "failed");
      await settle();

      const recovered = remoteVideo(document)!;
      expect(subscriberPeers()).toHaveLength(2);
      expect(recovered.muted).toBe(true);
      expect(recovered.dataset.autoMuted).toBe("true");
      expect(recovered.dataset.playback).toBe("muted");
      expect((document.getElementById("enableRemotePlaybackBtn") as HTMLButtonElement).style.display).toBe("inline-flex");
      expect((window as any).btMediaDiagnostics().lastPlay).toBe("success");
    });

    it("keeps exactly one remote track and element across repeated recovery cycles", async () => {
      const { document, window } = await setup(0);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        subscriberPeers().at(-1)!.setConnectionStates("failed", "failed");
        await settle();
      }
      const peers = subscriberPeers();
      expect(peers).toHaveLength(4);
      peers.slice(0, -1).forEach((peer) => expect(peer.connectionState).toBe("closed"));
      const tile = document.querySelector('#videoStage .tile[data-user-id="remote-user"]')!;
      expect(tile.querySelectorAll("video.remote-media")).toHaveLength(1);
      const stream = remoteVideo(document)!.srcObject as unknown as FakeMediaStream;
      expect(stream.getTracks()).toHaveLength(1);

      peers[0].emitTrack("remote-0", createFakeRemoteTrack("late-stale-track", "video"));
      expect(stream.getTracks()).toHaveLength(1);
      expect((window as any).btMediaDiagnostics().mediaStreamTrackCount).toBe(1);
      expect(tile.querySelectorAll("video.remote-media")).toHaveLength(1);
    });
  });

  describe("subscriber session mutation ordering", () => {
    const subscribePayload = (operationId: string) => ({
      ok: true,
      data: {
        operationId,
        sessionDescription: { type: "offer", sdp: operationId },
        tracks: [{ mid: "remote-0", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "camera", publicationKey: "remote-camera" }],
        diagnostics: { discovered: 1, subscribed: 0, publishers: {} },
      },
    });
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const settle = async () => { for (let index = 0; index < 5; index += 1) await wait(40); };
    const subscriberPeers = () => FakePeerConnection.instances.filter((peer) => Boolean(peer.ontrack));
    const remoteVideo = (document: Document) => document.querySelector('#videoStage .tile[data-user-id="remote-user"] video.remote-media') as HTMLVideoElement | null;
    const upstream406 = "Cloudflare Realtime request failed. HTTP status: 406. errorCode: negotiation_in_progress. errorDescription: Previous exchange incomplete";

    // Server model: one pending offer per session generation; recovery starts a new generation; records overlap of subscriber mutations.
    async function setup(options: { renegotiateDelayMs?: number; fail406?: "subscribe" | "renegotiate" } = {}) {
      const page = await loadRenderedPage();
      Object.defineProperty(page.window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
      Object.defineProperty(page.window, "MediaStream", { value: FakeMediaStream, configurable: true });
      page.setIncludeRemoteParticipant();
      const original = page.fetchMock.getMockImplementation()!;
      const events: string[] = [];
      let generation = 0;
      let negotiated = -1;
      let inFlight = 0;
      const stats = { maxInFlight: 0 };
      let pending406 = options.fail406 ?? null;
      page.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const kind = ["/media/subscribe", "/media/renegotiate", "/media/recover"].find((suffix) => url.endsWith(suffix))?.slice(7);
        if (!kind) return original(input, init);
        const subscriberRecover = kind === "recover" && JSON.parse(String(init?.body)).direction === "subscriber";
        if (kind === "recover" && !subscriberRecover) return original(input, init);
        inFlight += 1;
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        events.push(kind + ":start");
        try {
          if (kind === "renegotiate") {
            await wait(options.renegotiateDelayMs ?? 0);
            if (pending406 === "renegotiate") { pending406 = null; return createResponse({ ok: false, error: upstream406 }, false, 502); }
            negotiated = generation;
            return createResponse({ ok: true, data: { connected: true } });
          }
          if (kind === "recover") { generation += 1; return createResponse({ ok: true, data: { recovered: true, direction: "subscriber" } }); }
          if (pending406 === "subscribe") { pending406 = null; return createResponse({ ok: false, error: upstream406 }, false, 502); }
          if (negotiated === generation) return createResponse({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [] } });
          return createResponse(subscribePayload("op-" + generation));
        } finally {
          inFlight -= 1;
          events.push(kind + ":end");
        }
      });
      await joinHostMeeting(page.document, "Mutation ordering");
      return { ...page, events, stats };
    }

    const countOf = (events: string[], entry: string) => events.filter((event) => event === entry).length;

    it("keeps simultaneous join, initial subscription and refreshes to one subscriber mutation at a time", async () => {
      const { window, document, events, stats } = await setup({ renegotiateDelayMs: 80 });
      await wait(20);
      (window as any).refreshSfuSubscriptions();
      (window as any).refreshSfuSubscriptions();
      await settle();
      await settle();

      expect(stats.maxInFlight).toBe(1);
      expect(countOf(events, "renegotiate:start")).toBe(1);
      const firstRenegotiationStart = events.indexOf("renegotiate:start");
      const firstRenegotiationEnd = events.indexOf("renegotiate:end");
      expect(events.slice(firstRenegotiationStart, firstRenegotiationEnd)).not.toContain("subscribe:start");
      expect(subscriberPeers()).toHaveLength(1);
      expect(((remoteVideo(document)!.srcObject as unknown as FakeMediaStream).getTracks())).toHaveLength(1);
    });

    it("waits for a pending renegotiation before recovery touches the subscriber session", async () => {
      const { events, stats, document } = await setup({ renegotiateDelayMs: 150 });
      for (let attempt = 0; attempt < 20 && !events.includes("renegotiate:start"); attempt += 1) await wait(10);
      expect(events).toContain("renegotiate:start");
      expect(events).not.toContain("renegotiate:end");
      subscriberPeers()[0].setConnectionStates("failed", "failed");
      await settle();
      await settle();

      expect(stats.maxInFlight).toBe(1);
      expect(countOf(events, "recover:start")).toBe(1);
      expect(events.indexOf("recover:start")).toBeGreaterThan(events.indexOf("renegotiate:end"));
      expect(subscriberPeers()).toHaveLength(2);
      expect(((remoteVideo(document)!.srcObject as unknown as FakeMediaStream).getTracks())).toHaveLength(1);
    });

    it("replaces the subscriber session after a 406 from tracks/new without retrying the same mutation", async () => {
      const { window, document, events, fetchMock } = await setup({ fail406: "subscribe" });
      await settle();
      await settle();

      expect(countOf(events, "recover:start")).toBe(1);
      expect(events.slice(0, 4)).toEqual(["subscribe:start", "subscribe:end", "recover:start", "recover:end"]);
      const subscribeBodies = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/media/subscribe"));
      expect(subscribeBodies.length).toBeGreaterThanOrEqual(2);
      expect(subscriberPeers()).toHaveLength(2);
      expect(((remoteVideo(document)!.srcObject as unknown as FakeMediaStream).getTracks())).toHaveLength(1);
      const failed = (window as any).btMediaDiagnostics().subscriberMutations.find((entry: any) => entry.httpStatus === 406);
      expect(failed).toEqual(expect.objectContaining({ type: "subscribe", errorCode: "negotiation_in_progress", errorDescription: "Previous exchange incomplete" }));
    });

    it("replaces the subscriber session and re-subscribes once after a 406 from renegotiate without duplicate tracks", async () => {
      const { window, document, events } = await setup({ fail406: "renegotiate" });
      await settle();
      await settle();

      expect(countOf(events, "recover:start")).toBe(1);
      expect(countOf(events, "renegotiate:start")).toBe(2);
      const peers = subscriberPeers();
      expect(peers).toHaveLength(2);
      expect(peers[0].connectionState).toBe("closed");
      const tile = document.querySelector('#videoStage .tile[data-user-id="remote-user"]')!;
      expect(tile.querySelectorAll("video.remote-media")).toHaveLength(1);
      expect((remoteVideo(document)!.srcObject as unknown as FakeMediaStream).getTracks()).toHaveLength(1);
      expect((window as any).btMediaDiagnostics().mediaStreamTrackCount).toBe(1);

      const mutations = (window as any).btMediaDiagnostics().subscriberMutations as any[];
      const failedRenegotiation = mutations.find((entry) => entry.type === "renegotiate" && entry.httpStatus === 406);
      expect(failedRenegotiation).toEqual(expect.objectContaining({
        session: "subscriber-1",
        pendingOperationId: "op-0",
        errorCode: "negotiation_in_progress",
        errorDescription: "Previous exchange incomplete",
      }));
      expect(mutations.some((entry) => entry.session === "subscriber-2" && entry.type === "renegotiate" && entry.pendingOperationId === "op-1")).toBe(true);
      mutations.forEach((entry) => {
        expect(entry.seq).toBeGreaterThan(0);
        expect(entry.startedAt).toBeTruthy();
        expect(entry.endedAt).toBeTruthy();
        expect(entry.signalingBefore).toBeTruthy();
        expect(entry.signalingAfter).toBeTruthy();
      });
      expect(mutations.map((entry) => entry.seq)).toEqual([...mutations.map((entry) => entry.seq)].sort((a, b) => a - b));
    });
  });

  it("recovers a stale subscriber session after SFU returns 410", async () => {
    const { window, document, fetchMock, setNextSubscribePayload, setNextSubscribeError, setIncludeRemoteParticipant } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    Object.defineProperty(window, "MediaStream", { value: FakeMediaStream, configurable: true });
    setIncludeRemoteParticipant();
    setNextSubscribeError("Cloudflare Realtime request failed. HTTP status: 410.");
    setNextSubscribePayload({
      ok: true,
      data: {
        operationId: "stale-subscriber-recovered",
        sessionDescription: { type: "offer", sdp: "fresh-sfu-offer" },
        tracks: [{ mid: "remote-0", publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName: "camera", publicationKey: "remote-camera" }],
      },
    });

    await joinHostMeeting(document, "Stale subscriber recovery");
    await flush();
    await flush();

    const recoveryCalls = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/media/recover") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(recoveryCalls).toEqual([expect.objectContaining({ direction: "subscriber" })]);
    // Auto-published local media also triggers a subscription refresh, so at least the failed and recovered requests occur.
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/subscribe") && init?.method === "POST").length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/renegotiate") && init?.method === "POST")).toHaveLength(1);
    const remoteVideo = document.querySelector('#videoStage .tile[data-user-id="remote-user"] video.remote-media') as HTMLVideoElement | null;
    expect(remoteVideo).not.toBeNull();
    expect((remoteVideo?.srcObject as unknown as FakeMediaStream).getVideoTracks()).toHaveLength(1);
  });

  it("waits through a brief disconnected state and cancels recovery when media reconnects", async () => {
    const { window, document, fetchMock } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    await joinHostMeeting(document, "Transient disconnect");
    const micControl = document.getElementById("micControlBtn") as HTMLButtonElement;
    micControl.click();
    micControl.click();
    await flush();

    const publisher = FakePeerConnection.instances.find((peer) => peer.getTransceivers().some((transceiver) => transceiver.direction === "sendonly"));
    expect(publisher?.connectionState).toBe("connected");
    publisher!.setConnectionStates("disconnected", "disconnected");
    await flush();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/recover") && init?.method === "POST")).toHaveLength(0);

    publisher!.setConnectionStates("connected", "connected");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/media/recover") && init?.method === "POST")).toHaveLength(0);
    expect(FakePeerConnection.instances.filter((peer) => peer.getTransceivers().some((transceiver) => transceiver.direction === "sendonly"))).toEqual([publisher]);
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

    // Devices selected ON are captured when entering the meeting.
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    const firstTrack = micStreams[0]?.getAudioTracks?.()[0];
    expect(firstTrack?.readyState).toBe("live");
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    expect(() => micControl.click()).not.toThrow();
    await flush();
    expect(firstTrack?.stop).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);

    micControl.click();
    await flush();
    const secondTrack = micStreams[1]?.getAudioTracks?.()[0];
    expect(getUserMediaMock).toHaveBeenCalledTimes(3);
    expect(secondTrack).toBeTruthy();
    expect(secondTrack).not.toBe(firstTrack);
    expect(secondTrack?.readyState).toBe("live");
    expect(micControl.classList.contains("active") || micControl.textContent?.toLowerCase().includes("on")).toBe(true);
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    cameraControl.click();
    await flush();
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    cameraControl.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(4);
    expect(document.querySelector("video.local-preview")).not.toBeNull();
    expect(document.getElementById("errorBanner")?.textContent).toBe("");

    cameraControl.click();
    await flush();
    cameraControl.click();
    await flush();
    expect(getUserMediaMock).toHaveBeenCalledTimes(5);
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
    meeting.participants[0] = {
      id: "host-dev-participant",
      userId: "host-dev",
      displayName: "Host",
      role: "HOST",
      state: "JOINED",
    };
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
    expect(getUserMediaMock).toHaveBeenCalledTimes(0);
    expect((document.getElementById("toggleCameraBtn") as HTMLButtonElement).textContent).toContain("Off");

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
    expect((document.getElementById("recordingControls") as HTMLElement).style.display).toBe("none");
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

describe("BT-V0-018 production media stabilization", () => {
  const bodiesFor = (fetchMock: ReturnType<typeof vi.fn>, suffix: string) => fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith(suffix) && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)));
  const remotePublication = (trackName: string, mid: string, key: string) => ({
    mid, publisherUserId: "remote-user", publisherDisplayName: "Remote Guest", trackName, publicationKey: key,
  });
  const remoteTile = (document: Document) => document.querySelector('#videoStage .tile[data-user-id="remote-user"]') as HTMLElement;

  async function joinWithRemote(payload: unknown) {
    const page = await loadRenderedPage();
    Object.defineProperty(page.window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    Object.defineProperty(page.window, "MediaStream", { value: FakeMediaStream, configurable: true });
    page.setIncludeRemoteParticipant();
    page.setNextSubscribePayload(payload);
    await joinHostMeeting(page.document, "Remote diagnostics");
    await flush();
    return page;
  }

  it("captures and publishes microphone and camera that are ON at join without any toggle", async () => {
    const { window, document, fetchMock, getUserMediaMock } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    await joinHostMeeting(document, "Initial media");

    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    expect(bodiesFor(fetchMock, "/media/publish").flatMap((body) => body.tracks.map((track: { trackName: string }) => track.trackName))).toEqual(["microphone", "camera"]);
    expect(bodiesFor(fetchMock, "/media/publish/ready").flatMap((body) => body.trackNames)).toEqual(expect.arrayContaining(["microphone", "camera"]));
    expect(document.querySelector("video.local-preview")).not.toBeNull();
    expect(document.getElementById("mediaStatus")?.textContent).toBe("Publishing media");
  });

  it("captures and publishes selected devices when an approved guest is admitted from the waiting room", async () => {
    const { window, document, getUserMediaMock } = await loadRenderedPage();
    Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    const meeting = hostSnapshot();
    let guestId = "";
    let approved = false;
    const calls: string[] = [];
    installFetch(window, vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/media/publish")) return createResponse({ ok: true, data: { sessionDescription: { type: "answer", sdp: "a" }, tracks: JSON.parse(String(init?.body)).tracks } });
      if (url.endsWith("/media/publish/ready")) return createResponse({ ok: true, data: { ready: [] } });
      if (url.endsWith("/media/subscribe")) return createResponse({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [] } });
      if (init?.method === "POST" && url.endsWith("/admission/request")) {
        guestId = JSON.parse(String(init.body)).userId;
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
    expect(getUserMediaMock).not.toHaveBeenCalled();

    approved = true;
    await new Promise((resolve) => setTimeout(resolve, 3150));
    expect(getVisibleScreen(document, "meetingScreen")).toBe(true);
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    expect(calls.filter((url) => url.endsWith("/media/publish")).length).toBeGreaterThanOrEqual(1);
  });

  it("reports no-publication when the server sees no remote publication", async () => {
    const { document } = await joinWithRemote({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [], diagnostics: { discovered: 0, subscribed: 0, publishers: {} } } });
    expect(remoteTile(document).dataset.mediaState).toBe("no-publication");
  });

  it("reports no-subscription when a publication exists but no subscription was negotiated", async () => {
    const { document } = await joinWithRemote({ ok: true, data: { operationId: null, sessionDescription: null, tracks: [], diagnostics: { discovered: 1, subscribed: 0, publishers: { "remote-user": ["camera"] } } } });
    expect(remoteTile(document).dataset.mediaState).toBe("no-subscription");
  });

  it("reports no-track when the subscription is negotiated but no remote track event arrives", async () => {
    const { document, fetchMock } = await joinWithRemote({
      ok: true,
      data: {
        operationId: "op-no-track",
        sessionDescription: { type: "offer", sdp: "offer-removal-no-track-event" },
        tracks: [remotePublication("camera", "remote-0", "remote-camera")],
        diagnostics: { discovered: 1, subscribed: 0, publishers: { "remote-user": ["camera"] } },
      },
    });
    expect(bodiesFor(fetchMock, "/media/renegotiate")).toHaveLength(1);
    expect(remoteTile(document).dataset.mediaState).toBe("no-track");
  });

  it("renders a remote camera and reports playing once the track is assigned and playback starts", async () => {
    const { document } = await joinWithRemote({
      ok: true,
      data: {
        operationId: "op-camera",
        sessionDescription: { type: "offer", sdp: "offer-camera" },
        tracks: [remotePublication("camera", "remote-0", "remote-camera")],
        diagnostics: { discovered: 1, subscribed: 0, publishers: { "remote-user": ["camera"] } },
      },
    });
    const video = remoteTile(document).querySelector("video.remote-media") as HTMLVideoElement;
    expect((video.srcObject as unknown as FakeMediaStream).getVideoTracks()).toHaveLength(1);
    expect(video.dataset.playback).toBe("playing");
    expect(remoteTile(document).dataset.mediaState).toBe("playing");
  });

  it("keeps remote video visible muted when autoplay blocks audio and unmutes after the user enables playback", async () => {
    let userGesture = false;
    const page = await loadRenderedPage();
    Object.defineProperty(page.window.HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(function (this: HTMLMediaElement) {
        return !this.muted && !userGesture ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : Promise.resolve();
      }),
    });
    Object.defineProperty(page.window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
    Object.defineProperty(page.window, "MediaStream", { value: FakeMediaStream, configurable: true });
    page.setIncludeRemoteParticipant();
    page.setNextSubscribePayload({
      ok: true,
      data: {
        operationId: "op-blocked",
        sessionDescription: { type: "offer", sdp: "offer-camera" },
        tracks: [remotePublication("camera", "remote-0", "remote-camera")],
        diagnostics: { discovered: 1, subscribed: 0, publishers: { "remote-user": ["camera"] } },
      },
    });
    await joinHostMeeting(page.document, "Autoplay");
    await flush();

    const video = remoteTile(page.document).querySelector("video.remote-media") as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.dataset.playback).toBe("muted");
    expect(remoteTile(page.document).dataset.mediaState).toBe("playback-blocked");
    expect((page.document.getElementById("enableRemotePlaybackBtn") as HTMLButtonElement).style.display).toBe("inline-flex");

    userGesture = true;
    page.document.getElementById("enableRemotePlaybackBtn")?.click();
    await flush();
    expect(video.muted).toBe(false);
    expect(remoteTile(page.document).dataset.mediaState).toBe("playing");
  });

  it("renders a remote screen share as a distinct playing element beside live camera and microphone", async () => {
    const { document } = await joinWithRemote({
      ok: true,
      data: {
        operationId: "op-three",
        sessionDescription: { type: "offer", sdp: "offer-screen-three" },
        tracks: [remotePublication("camera", "remote-0", "remote-camera"), remotePublication("microphone", "remote-1", "remote-mic"), remotePublication("screen-video", "remote-2", "remote-screen")],
        diagnostics: { discovered: 3, subscribed: 0, publishers: { "remote-user": ["camera", "microphone", "screen-video"] } },
      },
    });
    const subscriber = FakePeerConnection.instances.find((peer) => peer.ontrack)!;
    const camera = createFakeRemoteTrack("remote-cam", "video");
    const microphone = createFakeRemoteTrack("remote-mic", "audio");
    const screen = createFakeRemoteTrack("remote-screen", "video");
    subscriber.emitTrack("remote-0", camera);
    subscriber.emitTrack("remote-1", microphone);
    subscriber.emitTrack("remote-2", screen);
    await flush();

    const tile = remoteTile(document);
    const cameraStream = (tile.querySelector("video.remote-media") as HTMLVideoElement).srcObject as unknown as FakeMediaStream;
    const screenElement = tile.querySelector("video.remote-screen-media") as HTMLVideoElement;
    expect(cameraStream.getTracks()).toEqual([camera, microphone]);
    expect((screenElement.srcObject as unknown as FakeMediaStream).getTracks()).toEqual([screen]);
    expect(screenElement.dataset.playback).toBe("playing");
    expect(tile.dataset.mediaState).toBe("playing");
  });

  describe("meeting link copy", () => {
    async function enterRoom(clipboard: unknown, execCommand?: () => boolean) {
      const page = await enterHostRoom();
      const view = page.document.defaultView!;
      Object.defineProperty(view.navigator, "clipboard", { value: clipboard, configurable: true });
      Object.defineProperty(page.document, "execCommand", { value: execCommand ? vi.fn(execCommand) : undefined, configurable: true });
      return page;
    }
    const copyButton = (document: Document) => document.getElementById("copyMeetingIdBtn") as HTMLButtonElement;

    it("copies with the Clipboard API and confirms with Link copied", async () => {
      const writeText = vi.fn(async () => undefined);
      const { document } = await enterRoom({ writeText });
      copyButton(document).click();
      await flush();
      expect(writeText).toHaveBeenCalledWith("http://localhost/?meeting=btm_test_123");
      expect(copyButton(document).textContent).toBe("Link copied");
    });

    it("falls back to selection copy when the Clipboard API rejects", async () => {
      const writeText = vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); });
      const { document } = await enterRoom({ writeText }, () => true);
      copyButton(document).click();
      await flush();
      expect(document.execCommand).toHaveBeenCalledWith("copy");
      expect(copyButton(document).textContent).toBe("Link copied");
      expect(document.querySelector("textarea")).toBeNull();
    });

    it("falls back to selection copy when the Clipboard API is unavailable", async () => {
      const { document } = await enterRoom(undefined, () => true);
      copyButton(document).click();
      await flush();
      expect(document.execCommand).toHaveBeenCalledWith("copy");
      expect(copyButton(document).textContent).toBe("Link copied");
    });

    it("shows the link for manual copy when every copy method fails", async () => {
      const { document } = await enterRoom(undefined, () => false);
      copyButton(document).click();
      await flush();
      expect(copyButton(document).textContent).toBe("Copy failed");
      expect(document.getElementById("errorBanner")?.textContent).toContain("http://localhost/?meeting=btm_test_123");
    });
  });

  describe("developer tools gating", () => {
    const sessionEnv = { SESSION_STORE: createSessionNamespace() };

    it("omits the developer panel, its controls, and enabling flag from the production page", async () => {
      const html = await (await app.fetch(new Request("https://billiontalks.example/"), sessionEnv)).text();
      expect(html).not.toContain('id="devPanel"');
      expect(html).not.toContain('id="toggleDevPanelBtn"');
      expect(html).not.toContain("data-dev-action=");
      expect(html).not.toContain("Developer tools");
      expect(html).toContain("const DEV_TOOLS_ENABLED = false;");
      const { document } = await loadRenderedPage("https://billiontalks.example/");
      expect(document.getElementById("devPanel")).toBeNull();
      expect(document.getElementById("toggleDevPanelBtn")).toBeNull();
    });

    it("keeps the developer panel for local development and the explicit debug flag", async () => {
      const local = await (await app.fetch(new Request("http://localhost:8787/"), sessionEnv)).text();
      expect(local).toContain('id="devPanel"');
      expect(local).toContain("const DEV_TOOLS_ENABLED = true;");
      const flagged = await (await app.fetch(new Request("https://staging.example/"), { ...sessionEnv, DEV_TOOLS_ENABLED: "true" })).text();
      expect(flagged).toContain('id="toggleDevPanelBtn"');
    });

    it("keeps simulated rooms off the real media transport", async () => {
      const { window, document, fetchMock, getUserMediaMock } = await loadRenderedPage();
      Object.defineProperty(window, "RTCPeerConnection", { value: FakePeerConnection, configurable: true });
      document.getElementById("toggleDevPanelBtn")?.click();
      (document.querySelector('[data-dev-action="hostView"]') as HTMLButtonElement).click();
      await flush();
      expect(getVisibleScreen(document, "meetingScreen")).toBe(true);
      expect(getUserMediaMock).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/media/"))).toHaveLength(0);
      expect(FakePeerConnection.instances).toHaveLength(0);
    });

    it("refuses to overwrite a real meeting with a simulated one", async () => {
      const { document } = await enterHostRoom();
      document.getElementById("toggleDevPanelBtn")?.click();
      (document.querySelector('[data-dev-action="participantView"]') as HTMLButtonElement).click();
      await flush();
      expect(document.getElementById("errorBanner")?.textContent).toContain("Leave the real meeting");
      expect(document.getElementById("participantList")?.textContent).not.toContain("Ava");
      expect(document.getElementById("participantList")?.textContent).toContain("Host");
    });
  });
});
