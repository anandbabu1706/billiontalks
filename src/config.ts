export type RealtimeEnv = {
  REALTIME_SFU_APP_ID?: string;
  REALTIME_SFU_BEARER_TOKEN?: string;
  MEETING_STORE?: unknown;
};

export function validateRealtimeEnv(env: Partial<RealtimeEnv> = {}): {
  ok: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  if (!env.REALTIME_SFU_APP_ID?.trim()) {
    missing.push("REALTIME_SFU_APP_ID");
  }

  if (!env.REALTIME_SFU_BEARER_TOKEN?.trim()) {
    missing.push("REALTIME_SFU_BEARER_TOKEN");
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}
