// Local-first persistence (AsyncStorage for MVP; expo-sqlite is the upgrade
// path once run volume grows — spec §7.1).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CompletedRun, Profile } from "../types";

const KEYS = {
  profile: "pm.profile",
  runs: "pm.runs",
  lineHistory: "pm.lineHistory",
};

export async function loadProfile(): Promise<Profile | null> {
  const raw = await AsyncStorage.getItem(KEYS.profile);
  return raw ? (JSON.parse(raw) as Profile) : null;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await AsyncStorage.setItem(KEYS.profile, JSON.stringify(profile));
}

export async function loadRuns(): Promise<CompletedRun[]> {
  const raw = await AsyncStorage.getItem(KEYS.runs);
  return raw ? (JSON.parse(raw) as CompletedRun[]) : [];
}

export async function saveRun(run: CompletedRun): Promise<void> {
  const runs = await loadRuns();
  runs.unshift(run);
  await AsyncStorage.setItem(KEYS.runs, JSON.stringify(runs.slice(0, 200)));
}

export async function loadLineHistory(): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(KEYS.lineHistory);
  return raw ? (JSON.parse(raw) as Record<string, number>) : {};
}

export async function saveLineHistory(counts: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(KEYS.lineHistory, JSON.stringify(counts));
}
