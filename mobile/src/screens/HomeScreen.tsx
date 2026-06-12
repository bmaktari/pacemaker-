// Home: today's run per segment, coach card, history access.

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Profile, RunTarget, CompletedRun } from "../types";
import { coachById } from "../data/coaches";
import { fmtDist, fmtDuration, fmtPace } from "../engine/lineSelector";
import { T, archetypeColor } from "../theme";

interface Props {
  profile: Profile;
  runs: CompletedRun[];
  onStartRun: (target: RunTarget) => void;
  onChangeCoach: () => void;
}

// Default session per segment (the plan engine generates full weeks server-side;
// this is the always-available quick start).
function defaultTarget(profile: Profile): RunTarget {
  switch (profile.segment) {
    case "S1": return { mode: "COMPLETION", distanceM: 1500, intervals: { runS: 90, walkS: 120, repeats: 6 } };
    case "S2": return { mode: "COMPLETION", distanceM: 1800, intervals: { runS: 300, walkS: 90, repeats: 3 } };
    case "S3": return { mode: "CONSISTENCY", distanceM: 5000 };
    case "S4": return { mode: "PACE", distanceM: 5000, targetPaceS: 330, toleranceS: 15 };
  }
}

const SEGMENT_LABEL: Record<string, string> = {
  S1: "First Steps — run/walk intervals",
  S2: "Building Up — extend the continuous block",
  S3: "Daily Mover — comfortable 5 km",
  S4: "Improver — 5 km @ target pace",
};

export default function HomeScreen({ profile, runs, onStartRun, onChangeCoach }: Props) {
  const coach = coachById(profile.coachId);
  const target = defaultTarget(profile);
  const streak = runs.length;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.brand}>PaceMaker</Text>

      <TouchableOpacity style={[s.coachCard, { borderColor: archetypeColor[coach.archetype] }]} onPress={onChangeCoach}>
        <Text style={s.coachName}>{coach.name}</Text>
        <Text style={s.tagline}>{coach.tagline}</Text>
        <Text style={s.change}>change coach ›</Text>
      </TouchableOpacity>

      <View style={s.todayCard}>
        <Text style={s.todayLabel}>TODAY'S RUN</Text>
        <Text style={s.todayTitle}>{SEGMENT_LABEL[profile.segment]}</Text>
        {target.mode === "PACE" && target.targetPaceS ? (
          <Text style={s.todayDetail}>{fmtDist(target.distanceM)} @ {fmtPace(target.targetPaceS)}/km</Text>
        ) : target.intervals ? (
          <Text style={s.todayDetail}>
            Run {Math.round(target.intervals.runS / 60)} min / walk {Math.round(target.intervals.walkS / 60)} min × {target.intervals.repeats}
          </Text>
        ) : (
          <Text style={s.todayDetail}>{fmtDist(target.distanceM)}, comfortable effort</Text>
        )}
        <TouchableOpacity style={s.startBtn} onPress={() => onStartRun(target)}>
          <Text style={s.startText}>START RUN</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.sectionTitle}>Run log {streak > 0 ? `· ${streak} run${streak > 1 ? "s" : ""}` : ""}</Text>
      {runs.length === 0 && <Text style={s.empty}>Your first run is waiting. The coach is, too.</Text>}
      {runs.slice(0, 20).map((r) => (
        <View key={r.clientRunId} style={s.runRow}>
          <View>
            <Text style={s.runMain}>{fmtDist(r.distanceM)} · {fmtDuration(r.durationS)}</Text>
            <Text style={s.runSub}>
              {new Date(r.startedAt).toLocaleDateString()} · {coachById(r.coachId).name}
              {r.wasSaved ? " · 💪 saved" : ""}{r.quitEarly ? " · partial" : ""}
            </Text>
          </View>
          <Text style={[s.runPace, { color: r.targetMet ? T.accent : T.dim }]}>{fmtPace(r.avgPaceS)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.pad, paddingTop: 56 },
  brand: { color: T.accent, fontSize: 24, fontWeight: "800", marginBottom: 18 },
  coachCard: { backgroundColor: T.card, borderRadius: T.radius, borderWidth: 1, padding: 16, marginBottom: 14 },
  coachName: { color: T.text, fontSize: 18, fontWeight: "700" },
  tagline: { color: T.dim, fontSize: 13, marginTop: 4 },
  change: { color: T.dim, fontSize: 12, marginTop: 8, textAlign: "right" },
  todayCard: { backgroundColor: T.cardAlt, borderRadius: T.radius, padding: 20, marginBottom: 22 },
  todayLabel: { color: T.dim, fontSize: 12, letterSpacing: 1.5 },
  todayTitle: { color: T.text, fontSize: 19, fontWeight: "700", marginTop: 6 },
  todayDetail: { color: T.dim, fontSize: 14, marginTop: 4 },
  startBtn: { backgroundColor: T.accent, borderRadius: T.radius, padding: 16, marginTop: 16 },
  startText: { color: "#06280F", textAlign: "center", fontWeight: "800", fontSize: 16, letterSpacing: 1 },
  sectionTitle: { color: T.text, fontSize: 16, fontWeight: "700", marginBottom: 10 },
  empty: { color: T.dim, fontSize: 14, fontStyle: "italic" },
  runRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: T.card, borderRadius: T.radius, padding: 14, marginBottom: 8 },
  runMain: { color: T.text, fontSize: 15, fontWeight: "600" },
  runSub: { color: T.dim, fontSize: 12, marginTop: 2 },
  runPace: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
