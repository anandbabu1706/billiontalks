import { describe, expect, it } from "vitest";

import {
  applyMeetingParticipants,
  createInitialUiState,
  getCurrentUserRole,
  getMeetingGridColumns,
  getParticipantTileLabel,
  getStageParticipants,
  resolveMeetingData,
  setMeetingRoute,
  setScreenShareState,
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

  it("can move to an explicit end state without mutating the meeting ID", () => {
    const state = setMeetingRoute(createInitialUiState(), "ended", {
      id: "btm_test",
      title: "Ended meeting",
      hostId: "host-1",
      status: "ended",
      participants: [],
    });

    expect(state.route).toBe("ended");
    expect(state.meeting?.id).toBe("btm_test");
  });
});
