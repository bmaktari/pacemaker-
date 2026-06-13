// In-run UI (spec §4.3) — presentational only; the session logic (GPS, engine,
// quit interception) lives in useRunSession.

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Profile, RunTarget, CompletedRun } from "../types";
import { coachById } from "../data/coaches";
import { useRunSession } from "../hooks/useRunSession";
import { fmtPace, fmtDist, fmtDuration } from "../engine/lineSelector";
import { T } from "../theme";

interface Props {
  profile: Profile;
  target: RunTarget;
  onFinish: (run: CompletedRun) => void;
}

export default function RunScreen({ profile, target, onFinish }: Props) {
  const coach = coachById(profile.coachId);
  const session = useRunSession(profile, target, onFinish);

  const onEndPress = () => {
    const script = session.quitIntercept();
    if (script) {
      Alert.alert("Hold on —", script, [
        { text: "Walk it with me (2 min)", onPress: session.acceptWalk },
        { text: "End run", style: "destructive", onPress: () => session.endRun(true) },
      ]);
      return;
    }
    session.endRun(session.fractionRemaining > 0.1);
  };

  return (
    <View style={s.root}>
      <Text style={s.coachLabel}>{coach.name}</Text>
      <Text style={s.timer}>{fmtDuration(session.elapsedS)}</Text>
      <View style={s.statRow}>
        <Stat label="DISTANCE" value={fmtDist(session.distanceM)} />
        <Stat label="PACE /KM" value={fmtPace(session.paceS)} />
        {target.targetPaceS ? <Stat label="TARGET" value={fmtPace(target.targetPaceS)} /> : null}
      </View>
      <View style={s.lineBox}>
        <Text style={s.lineText}>{session.lastLine || "…"}</Text>
      </View>
      <TouchableOpacity style={s.endBtn} onPress={onEndPress}>
        <Text style={s.endText}>END RUN</Text>
      </TouchableOpacity>
    </View>
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
  root: { flex: 1, backgroundColor: T.bg, padding: T.pad, paddingTop: 64 },
  coachLabel: { color: T.dim, fontSize: 15, textAlign: "center", marginBottom: 8 },
  timer: { color: T.text, fontSize: 64, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"] },
  statRow: { flexDirection: "row", justifyContent: "space-around", marginVertical: 28 },
  stat: { alignItems: "center" },
  statLabel: { color: T.dim, fontSize: 12, letterSpacing: 1 },
  statValue: { color: T.text, fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
  lineBox: { flex: 1, backgroundColor: T.card, borderRadius: T.radius, padding: 20, justifyContent: "center" },
  lineText: { color: T.accent, fontSize: 19, lineHeight: 27, textAlign: "center", fontStyle: "italic" },
  endBtn: { backgroundColor: T.danger, borderRadius: T.radius, padding: 18, marginTop: 20 },
  endText: { color: "#fff", textAlign: "center", fontWeight: "800", fontSize: 16, letterSpacing: 1 },
});
