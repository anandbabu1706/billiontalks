import { describe, expect, it } from "vitest";

import {
  applyMeetingParticipants,
  createInitialUiState,
  createLocalMediaState,
  getCurrentUserRole,
  getMeetingGridColumns,
  getParticipantTileLabel,
  getStageParticipants,
  removeSelectedDevParticipant,
  resolveMeetingData,
  setDeviceAvailability,
  setMeetingRoute,
  setScreenShareState,
  startLocalMediaStream,
  stopLocalMediaStream,
  toggleLocalDevice,
} from "../src/ui-state";

describe("UI state model", () => {
  it("initializes device controls and route state for the home screen", () => {
    const state = createInitialUiState();

    expect(state.route).toBe("home");
    expect(state.localDevice.micEnabled).toBe(true);
    expect(state.localDevice.cameraEnabled).toBe(true);
    expect(state.localDevice.screenShareEnabled).toBe(false);
  });

  it("toggles local mic and camera state without affecting the meeting domain", () => {
    const state = createInitialUiState();
    const micOff = toggleLocalDevice(state, "micEnabled");
    const cameraOff = toggleLocalDevice(micOff, "cameraEnabled");

    expect(micOff.localDevice.micEnabled).toBe(false);
    expect(cameraOff.localDevice.cameraEnabled).toBe(false);
    expect(cameraOff.meeting).toBeNull();
  });

  it("updates screen-share state only when capture is explicitly started or stopped", () => {
    const ready = createInitialUiState();
    const started = setScreenShareState(ready, true);
    const stopped = setScreenShareState(started, false);

    expect(ready.localDevice.screenShareEnabled).toBe(false);
    expect(started.localDevice.screenShareEnabled).toBe(true);
    expect(stopped.localDevice.screenShareEnabled).toBe(false);
  });

  it("derives stage tiles and labels from the live participant roster", () => {
    const state = {
      ...createInitialUiState(),
      displayName: "Alex",
      route: "meeting" as const,
      meeting: {
        id: "btm_test",
        title: "Sprint Review",
        hostId: "host-1",
        status: "active",
        participants: [
          { id: "host", userId: "host-1", displayName: "Host", role: "HOST", state: "JOINED" },
          { id: "me", userId: "user-me", displayName: "Alex", role: "PARTICIPANT", state: "JOINED" },
          { id: "ava", userId: "user-ava", displayName: "Ava", role: "PARTICIPANT", state: "JOINED" },
        ],
      },
    };

    const stageParticipants = getStageParticipants(state);
    const labels = stageParticipants.map((participant) => getParticipantTileLabel(state, participant));

    expect(labels).toEqual(["You", "Host", "Ava"]);
    expect(getMeetingGridColumns(stageParticipants.length)).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("derives meeting role from the BillionTalks model rather than a UI-only flag", () => {
    const hostState = {
      ...createInitialUiState(),
      currentUserId: "host-1",
      meeting: {
        id: "btm_test",
        title: "Sprint Review",
        hostId: "host-1",
        status: "active",
        participants: [{ id: "p1", userId: "host-1", displayName: "Host", role: "HOST", state: "JOINED" }],
      },
    };

    const participantState = {
      ...createInitialUiState(),
      currentUserId: "user-2",
      meeting: {
        id: "btm_test",
        title: "Sprint Review",
        hostId: "host-1",
        status: "active",
        participants: [
          { id: "p1", userId: "host-1", displayName: "Host", role: "HOST", state: "JOINED" },
          { id: "p2", userId: "user-2", displayName: "Guest", role: "PARTICIPANT", state: "JOINED" },
        ],
      },
    };

    expect(getCurrentUserRole(hostState)).toBe("HOST");
    expect(getCurrentUserRole(participantState)).toBe("PARTICIPANT");
  });

  it("tracks microphone and camera availability separately from enabled state", () => {
    const state = createInitialUiState();
    const micUnavailable = setDeviceAvailability(state, "micAvailable", false);
    const cameraUnavailable = setDeviceAvailability(micUnavailable, "cameraAvailable", false);

    expect(state.localDevice.micAvailable).toBe(true);
    expect(state.localDevice.cameraAvailable).toBe(true);
    expect(micUnavailable.localDevice.micAvailable).toBe(false);
    expect(micUnavailable.localDevice.micEnabled).toBe(true);
    expect(cameraUnavailable.localDevice.cameraAvailable).toBe(false);
    expect(cameraUnavailable.localDevice.cameraEnabled).toBe(true);
  });

  it("resolves a meeting into the prejoin route and preserves local UI state", () => {
    const state = createInitialUiState();
    const resolved = resolveMeetingData(state, {
      id: "btm_test",
      title: "Sprint Review",
      hostId: "host-1",
      status: "active",
      participants: [],
    });

    expect(resolved.route).toBe("prejoin");
    expect(resolved.meeting?.id).toBe("btm_test");
    expect(resolved.localDevice.micEnabled).toBe(true);
  });

  it("updates participant data without modifying the underlying meeting identity", () => {
    const state = {
      ...createInitialUiState(),
      meeting: {
        id: "btm_test",
        title: "Sprint Review",
        hostId: "host-1",
        status: "active",
        participants: [{ id: "p1", userId: "u1", displayName: "Host", role: "HOST", state: "JOINED" }],
      },
      route: "meeting" as const,
    };

    const next = applyMeetingParticipants(state, [
      { id: "p1", userId: "u1", displayName: "Host", role: "HOST", state: "JOINED" },
      { id: "p2", userId: "u2", displayName: "Guest", role: "PARTICIPANT", state: "JOINED" },
    ]);

    expect(next.meeting?.id).toBe("btm_test");
    expect(next.meeting?.participants).toHaveLength(2);
    expect(next.route).toBe("meeting");
  });

  it("reacquires a microphone after it is turned off and back on", () => {
    const mediaState = createLocalMediaState();
    const firstMic = startLocalMediaStream(mediaState, "mic", createMockStream("audio"));
    const stoppedMic = stopLocalMediaStream(firstMic, "mic");
    const restartedMic = startLocalMediaStream(stoppedMic, "mic", createMockStream("audio"));

    expect(firstMic.micStream).not.toBeNull();
    expect(stoppedMic.micStream).toBeNull();
    expect(restartedMic.micStream).not.toBeNull();
    expect(restartedMic.micRequestInFlight).toBe(false);
  });

  it("reacquires a camera after it is turned off and back on", () => {
    const mediaState = createLocalMediaState();
    const firstCamera = startLocalMediaStream(mediaState, "camera", createMockStream("video"));
    const stoppedCamera = stopLocalMediaStream(firstCamera, "camera");
    const restartedCamera = startLocalMediaStream(stoppedCamera, "camera", createMockStream("video"));

    expect(firstCamera.cameraStream).not.toBeNull();
    expect(stoppedCamera.cameraStream).toBeNull();
    expect(restartedCamera.cameraStream).not.toBeNull();
    expect(restartedCamera.cameraRequestInFlight).toBe(false);
  });

  it("resets the request guard after requesting media so future toggles remain possible", () => {
    const mediaState = createLocalMediaState();
    const inFlight = {
      ...mediaState,
      micRequestInFlight: true,
      cameraRequestInFlight: true,
    };

    const clearedMic = stopLocalMediaStream(inFlight, "mic");
    const clearedCamera = stopLocalMediaStream(clearedMic, "camera");

    expect(clearedCamera.micRequestInFlight).toBe(false);
    expect(clearedCamera.cameraRequestInFlight).toBe(false);
  });

  it("removes only the selected simulated participant without affecting the rest of the roster", () => {
    const state = {
      ...createInitialUiState(),
      meeting: {
        id: "btm_dev_1234567890",
        title: "Development Test Room",
        hostId: "host-dev",
        status: "active",
        participants: [
          { id: "demo-host", userId: "host-dev", displayName: "Host", role: "HOST", state: "JOINED" },
          { id: "demo-guest-1", userId: "user-ava", displayName: "Ava", role: "PARTICIPANT", state: "JOINED" },
          { id: "demo-guest-2", userId: "user-sam", displayName: "Sam", role: "PARTICIPANT", state: "PENDING" },
        ],
      },
    };

    const next = removeSelectedDevParticipant(state, "demo-guest-1");

    expect(next.meeting?.participants).toHaveLength(2);
    expect(next.meeting?.participants.map((participant) => participant.id)).toEqual(["demo-host", "demo-guest-2"]);
    expect(next.meeting?.participants.some((participant) => participant.id === "demo-guest-1")).toBe(false);
  });
});

function createMockStream(kind: "audio" | "video") {
  return {
    getTracks: () => [{ kind, readyState: "live", stop: () => undefined }],
    getAudioTracks: () => (kind === "audio" ? [{ readyState: "live", stop: () => undefined }] : []),
    getVideoTracks: () => (kind === "video" ? [{ readyState: "live", stop: () => undefined }] : []),
  };
}
