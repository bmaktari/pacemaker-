// Backend client. Local-first: every call is fire-and-forget tolerant —
// the app never blocks on network (spec §6.3).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CompletedRun } from "../types";

// Set this to your Replit deployment URL, e.g. "https://pacemaker.yourname.repl.co"
export const API_BASE = "http://localhost:3000";

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem("pm.token");
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T | null> {
  try {
    const token = await getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // offline — caller falls back to canned content / local queue
  }
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem("pm.deviceId");
  if (existing) return existing;
  const id = `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  await AsyncStorage.setItem("pm.deviceId", id);
  return id;
}

export async function registerDevice(displayName: string): Promise<boolean> {
  const deviceId = await getOrCreateDeviceId();
  const result = await request<{ token: string }>("/api/auth/device", "POST", { deviceId, displayName });
  if (result?.token) {
    await AsyncStorage.setItem("pm.token", result.token);
    return true;
  }
  return false;
}

export async function syncProfile(segment: string, coachId: string, strongLanguage: boolean): Promise<void> {
  await request("/api/profile", "PUT", { segment, coachId, strongLanguage });
}

export async function syncRun(run: CompletedRun): Promise<boolean> {
  const { transcript, ...rest } = run;
  const result = await request("/api/runs", "POST", { ...rest, summary: { transcript: transcript.slice(0, 50) } });
  return result !== null;
}

export async function sendEvents(events: { type: string; payload?: Record<string, unknown> }[]): Promise<void> {
  await request("/api/events", "POST", { events });
}

export async function fetchTier2(
  kind: "brief" | "debrief" | "milestone" | "recap",
  coachId: string,
  input: unknown
): Promise<string | null> {
  const result = await request<{ script: string }>(`/api/coach/${kind}`, "POST", { coachId, input });
  return result?.script ?? null;
}
