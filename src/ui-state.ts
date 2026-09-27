export type MeetingRoute =
  | "home"
  | "join"
  | "prejoin"
  | "meeting"
  | "ended"
  | "disconnected";

export type LocalDeviceState = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  micAvailable: boolean;
  cameraAvailable: boolean;
};

export type UiParticipant = {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  state: string;
};

export type UiMeetingState = {
  id: string;
  title: string;
  hostId: string;
  status: string;
  participants: UiParticipant[];
};

export type MeetingUiState = {
  route: MeetingRoute;
  meetingId: string;
  meeting: UiMeetingState | null;
  displayName: string;
  currentUserId: string;
  isHost: boolean;
  error: string | null;
  localDevice: LocalDeviceState;
};

export type LocalMediaTrackLike = {
  readyState: string;
  stop: () => void;
};

export type LocalMediaStreamLike = {
  getTracks: () => LocalMediaTrackLike[];
};

export type LocalMediaStreamState = {
  micStream: LocalMediaStreamLike | null;
  cameraStream: LocalMediaStreamLike | null;
  micRequestInFlight: boolean;
  cameraRequestInFlight: boolean;
};

export function createInitialUiState(): MeetingUiState {
  return {
    route: "home",
    meetingId: "",
    meeting: null,
    displayName: "",
    currentUserId: "",
    isHost: false,
    error: null,
    localDevice: {
      micEnabled: true,
      cameraEnabled: true,
      screenShareEnabled: false,
      micAvailable: true,
      cameraAvailable: true,
    },
  };
}

export function createLocalMediaState(): LocalMediaStreamState {
  return {
    micStream: null,
    cameraStream: null,
    micRequestInFlight: false,
    cameraRequestInFlight: false,
  };
}

export function startLocalMediaStream(
  state: LocalMediaStreamState,
  device: "mic" | "camera",
  stream: LocalMediaStreamLike | null,
): LocalMediaStreamState {
  if (!stream) {
    return state;
  }

  const nextState = stopLocalMediaStream(state, device);

  if (device === "mic") {
    return {
      ...nextState,
      micStream: stream,
      micRequestInFlight: false,
    };
  }

  return {
    ...nextState,
    cameraStream: stream,
    cameraRequestInFlight: false,
  };
}

export function stopLocalMediaStream(
  state: LocalMediaStreamState,
  device: "mic" | "camera",
): LocalMediaStreamState {
  const stream = device === "mic" ? state.micStream : state.cameraStream;

  if (stream) {
    stream.getTracks().forEach((track) => {
      if (track.readyState !== "ended") {
        try {
          track.stop();
        } catch {
          // Ignore stop failures; the stale stream ref must still be cleared.
        }
      }
    });
  }

  if (device === "mic") {
    return {
      ...state,
      micStream: null,
      micRequestInFlight: false,
    };
  }

  return {
    ...state,
    cameraStream: null,
    cameraRequestInFlight: false,
  };
}

export function removeSelectedDevParticipant(
  state: MeetingUiState,
  participantId: string,
): MeetingUiState {
  if (!state.meeting || !participantId) {
    return state;
  }

  const nextParticipants = state.meeting.participants.filter((participant) => participant.id !== participantId);
  if (nextParticipants.length === state.meeting.participants.length) {
    return state;
  }

  return {
    ...state,
    meeting: {
      ...state.meeting,
      participants: nextParticipants,
    },
  };
}

export function toggleLocalDevice(
  state: MeetingUiState,
  device: keyof Pick<LocalDeviceState, "micEnabled" | "cameraEnabled" | "screenShareEnabled">,
): MeetingUiState {
  return {
    ...state,
    localDevice: {
      ...state.localDevice,
      [device]: !state.localDevice[device],
    },
  };
}

export function setScreenShareState(state: MeetingUiState, enabled: boolean): MeetingUiState {
  return {
    ...state,
    localDevice: {
      ...state.localDevice,
      screenShareEnabled: enabled,
    },
  };
}

export function setDeviceAvailability(
  state: MeetingUiState,
  device: "micAvailable" | "cameraAvailable",
  available: boolean,
): MeetingUiState {
  return {
    ...state,
    localDevice: {
      ...state.localDevice,
      [device]: available,
    },
  };
}

export function setMeetingRoute(
  state: MeetingUiState,
  route: MeetingRoute,
  meeting: UiMeetingState | null = state.meeting,
): MeetingUiState {
  return {
    ...state,
    route,
    meeting,
  };
}

export function resolveMeetingData(
  state: MeetingUiState,
  meeting: UiMeetingState | null,
  displayName = state.displayName,
): MeetingUiState {
  return {
    ...state,
    meeting,
    displayName,
    route: meeting ? "prejoin" : state.route,
    error: meeting ? null : "Meeting not found.",
  };
}

export function applyMeetingParticipants(
  state: MeetingUiState,
  participants: UiParticipant[],
): MeetingUiState {
  if (!state.meeting) {
    return state;
  }

  return {
    ...state,
    meeting: {
      ...state.meeting,
      participants,
    },
  };
}

export function getParticipantTileLabel(state: MeetingUiState, participant: UiParticipant): string {
  const localDisplayName = state.displayName.trim().toLowerCase();
  const participantName = participant.displayName.trim().toLowerCase();

  if (
    localDisplayName &&
    participantName === localDisplayName
  ) {
    return "You";
  }

  if (
    participant.userId === "user-me" ||
    participant.id === "demo-me" ||
    participant.displayName === "You"
  ) {
    return "You";
  }

  return participant.displayName;
}

export function getStageParticipants(state: MeetingUiState): UiParticipant[] {
  const participants = state.meeting?.participants ?? [];

  if (!participants.length) {
    return state.displayName
      ? [{ id: "local-user", userId: "local-user", displayName: state.displayName, role: "PARTICIPANT", state: "JOINED" }]
      : [];
  }

  const ordered = [...participants].filter((participant) => participant.state !== "LEFT");
  const localIndex = ordered.findIndex((participant) => {
    const localDisplayName = state.displayName.trim().toLowerCase();
    const participantName = participant.displayName.trim().toLowerCase();

    return (
      !!localDisplayName && participantName === localDisplayName
    ) || participant.userId === "user-me" || participant.id === "demo-me" || participant.displayName === "You";
  });

  if (localIndex > 0) {
    const [localParticipant] = ordered.splice(localIndex, 1);
    ordered.unshift(localParticipant);
  }

  return ordered;
}

export function getMeetingGridColumns(participantCount: number): string {
  if (participantCount <= 1) {
    return "1fr";
  }

  if (participantCount <= 4) {
    return "repeat(2, minmax(0, 1fr))";
  }

  return "repeat(3, minmax(0, 1fr))";
}

export function getCurrentUserRole(state: MeetingUiState): "HOST" | "PARTICIPANT" | null {
  if (!state.meeting) {
    return null;
  }

  if (state.meeting.hostId === state.currentUserId) {
    return "HOST";
  }

  const participant = state.meeting.participants.find((entry) => entry.userId === state.currentUserId);
  if (participant) {
    return participant.role === "HOST" ? "HOST" : "PARTICIPANT";
  }

  if (state.displayName) {
    const localMatch = state.meeting.participants.find(
      (entry) => entry.displayName.toLowerCase() === state.displayName.toLowerCase(),
    );
    if (localMatch) {
      return localMatch.role === "HOST" ? "HOST" : "PARTICIPANT";
    }
  }

  return null;
}
