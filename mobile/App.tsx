// PaceMaker app shell — simple state-driven navigation (no nav lib needed
// for four screens; keeps the Replit/EAS dependency surface small).

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import WizardScreen from "./src/screens/WizardScreen";
import HomeScreen from "./src/screens/HomeScreen";
import RunScreen from "./src/screens/RunScreen";
import SummaryScreen from "./src/screens/SummaryScreen";
import CoachSelectScreen from "./src/screens/CoachSelectScreen";
import { Profile, RunTarget, CompletedRun } from "./src/types";
import { loadProfile, saveProfile, loadRuns, saveRun } from "./src/services/storage";
import { registerDevice, syncProfile, syncRun } from "./src/services/api";
import { requestPermissions } from "./src/services/location";
import { T } from "./src/theme";

type Screen = "loading" | "wizard" | "home" | "coach" | "run" | "summary";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [runs, setRuns] = useState<CompletedRun[]>([]);
  const [activeTarget, setActiveTarget] = useState<RunTarget | null>(null);
  const [lastRun, setLastRun] = useState<CompletedRun | null>(null);

  useEffect(() => {
    (async () => {
      const [p, r] = await Promise.all([loadProfile(), loadRuns()]);
      setRuns(r);
      if (p) {
        setProfile(p);
        setScreen("home");
      } else {
        setScreen("wizard");
      }
    })();
  }, []);

  const completeWizard = async (data: Omit<Profile, "token" | "runsCompleted">) => {
    const p: Profile = { ...data, runsCompleted: 0 };
    setProfile(p);
    await saveProfile(p);
    setScreen("home");
    // best-effort backend registration; app is fully usable offline
    registerDevice(p.displayName).then((ok) => {
      if (ok) syncProfile(p.segment, p.coachId, p.strongLanguage);
    });
  };

  const startRun = async (target: RunTarget) => {
    const granted = await requestPermissions();
    if (!granted) {
      Alert.alert("Location needed", "PaceMaker coaches your pace from GPS. Enable location to run with a coach.");
      return;
    }
    setActiveTarget(target);
    setScreen("run");
  };

  const finishRun = async (run: CompletedRun) => {
    setLastRun(run);
    setRuns((prev) => [run, ...prev]);
    if (profile) {
      const p = { ...profile, runsCompleted: profile.runsCompleted + 1 };
      setProfile(p);
      await saveProfile(p);
    }
    await saveRun(run);
    syncRun(run); // fire-and-forget; queue-and-retry is the v1.1 refinement
    setScreen("summary");
  };

  const selectCoach = async (coachId: string, strongLanguage: boolean) => {
    if (!profile) return;
    const p = { ...profile, coachId, strongLanguage };
    setProfile(p);
    await saveProfile(p);
    syncProfile(p.segment, coachId, strongLanguage);
    setScreen("home");
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar style="light" />
      {screen === "loading" && (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={T.accent} size="large" />
        </View>
      )}
      {screen === "wizard" && <WizardScreen onComplete={completeWizard} />}
      {screen === "home" && profile && (
        <HomeScreen profile={profile} runs={runs} onStartRun={startRun} onChangeCoach={() => setScreen("coach")} />
      )}
      {screen === "coach" && profile && (
        <CoachSelectScreen profile={profile} onSelect={selectCoach} onBack={() => setScreen("home")} />
      )}
      {screen === "run" && profile && activeTarget && (
        <RunScreen profile={profile} target={activeTarget} onFinish={finishRun} />
      )}
      {screen === "summary" && profile && lastRun && (
        <SummaryScreen profile={profile} run={lastRun} onDone={() => setScreen("home")} />
      )}
    </View>
  );
}
