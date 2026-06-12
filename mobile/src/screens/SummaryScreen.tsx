// Post-run debrief (spec §4.3 / peak-end R17): Tier-2 LLM debrief with canned
// fallback, splits, coach transcript.

import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { CompletedRun, Profile } from "../types";
import { coachById } from "../data/coaches";
import { fmtDist, fmtDuration, fmtPace } from "../engine/lineSelector";
import { speak } from "../services/speech";
import { fetchTier2 } from "../services/api";
import { T } from "../theme";

interface Props {
  profile: Profile;
  run: CompletedRun;
  onDone: () => void;
}

export default function SummaryScreen({ profile, run, onDone }: Props) {
  const coach = coachById(run.coachId);
  const [debrief, setDebrief] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const script = await fetchTier2("debrief", run.coachId, {
        run_summary: {
          distance_m: run.distanceM, duration_s: run.durationS, avg_pace_s: run.avgPaceS,
          target_pace_s: run.targetPaceS, target_met: run.targetMet, splits: run.splits,
        },
        runs_saved_flag: run.wasSaved,
        user_quit: run.quitEarly,
      });
      const finalText =
        script ??
        (run.wasSaved
          ? "You saved this run — that's the stat that matters today."
          : run.targetMet
          ? "Target met. Banked. Next one builds on it."
          : "Run logged. Every session counts — we go again.");
      setDebrief(finalText);
      speak(coach, finalText);
    })();
  }, []);

  // Golden KM (E-GOLDEN-KM): name the best moment even on bad runs.
  const golden = run.splits.length > 0 ? run.splits.reduce((a, b) => (b.paceS < a.paceS ? b : a)) : null;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>{run.quitEarly ? "Run logged" : run.targetMet ? "Target met 🎯" : "Run complete"}</Text>
      <View style={s.statRow}>
        <Stat label="DISTANCE" value={fmtDist(run.distanceM)} />
        <Stat label="TIME" value={fmtDuration(run.durationS)} />
        <Stat label="AVG PACE" value={fmtPace(run.avgPaceS)} />
      </View>

      <View style={s.debriefBox}>
        <Text style={s.debriefCoach}>{coach.name}</Text>
        <Text style={s.debriefText}>{debrief ?? "…"}</Text>
      </View>

      {golden && (
        <View style={s.goldenBox}>
          <Text style={s.goldenLabel}>GOLDEN KM</Text>
          <Text style={s.goldenText}>Kilometre {golden.km} — {fmtPace(golden.paceS)}/km, your best of the run.</Text>
        </View>
      )}

      {run.splits.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Splits</Text>
          {run.splits.map((sp) => (
            <View key={sp.km} style={s.splitRow}>
              <Text style={s.splitKm}>km {sp.km}</Text>
              <Text style={s.splitPace}>{fmtPace(sp.paceS)}</Text>
            </View>
          ))}
        </>
      )}

      <Text style={s.sectionTitle}>Coach transcript</Text>
      {run.transcript.map((t, i) => (
        <Text key={i} style={s.transcript}>
          <Text style={s.transcriptTime}>{fmtDuration(t.atS)}  </Text>{t.text}
        </Text>
      ))}

      <TouchableOpacity style={s.doneBtn} onPress={onDone}>
        <Text style={s.doneText}>DONE</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.pad, paddingTop: 56, paddingBottom: 40 },
  title: { color: T.text, fontSize: 26, fontWeight: "800", marginBottom: 20 },
  statRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 22 },
  stat: { alignItems: "center" },
  statLabel: { color: T.dim, fontSize: 11, letterSpacing: 1 },
  statValue: { color: T.text, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  debriefBox: { backgroundColor: T.cardAlt, borderRadius: T.radius, padding: 18, marginBottom: 14 },
  debriefCoach: { color: T.dim, fontSize: 12, marginBottom: 6, letterSpacing: 1 },
  debriefText: { color: T.accent, fontSize: 16, lineHeight: 23, fontStyle: "italic" },
  goldenBox: { backgroundColor: T.card, borderRadius: T.radius, padding: 14, marginBottom: 18, borderLeftWidth: 3, borderLeftColor: T.warn },
  goldenLabel: { color: T.warn, fontSize: 11, letterSpacing: 1.5, marginBottom: 4 },
  goldenText: { color: T.text, fontSize: 14 },
  sectionTitle: { color: T.text, fontSize: 16, fontWeight: "700", marginTop: 8, marginBottom: 8 },
  splitRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.card },
  splitKm: { color: T.dim, fontSize: 14 },
  splitPace: { color: T.text, fontSize: 14, fontVariant: ["tabular-nums"] },
  transcript: { color: T.dim, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  transcriptTime: { color: T.accent, fontVariant: ["tabular-nums"] },
  doneBtn: { backgroundColor: T.accent, borderRadius: T.radius, padding: 16, marginTop: 24 },
  doneText: { color: "#06280F", textAlign: "center", fontWeight: "800", fontSize: 16, letterSpacing: 1 },
});
