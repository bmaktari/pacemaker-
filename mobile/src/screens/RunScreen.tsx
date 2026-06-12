// The core loop (spec §4.3): GPS → pace filter → engine tick every 10 s →
// coach line → TTS. Includes the quit-moment interception system (D.7).

import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Profile, RunTarget, CompletedRun, Split } from "../types";
import { coachById } from "../data/coaches";
import { CoachingEngine } from "../engine/stateMachine";
import { PaceFilter } from "../engine/paceFilter";
import { LineSelector, fmtPace, fmtDist, fmtDuration } from "../engine/lineSelector";
import { speak, stopSpeech } from "../services/speech";
import { startTracking, haversineM, Fix } from "../services/location";
import { loadLineHistory, saveLineHistory } from "../services/storage";
import { fetchTier2, sendEvents } from "../services/api";
import { T } from "../theme";

interface Props {
  profile: Profile;
  target: RunTarget;
  onFinish: (run: CompletedRun) => void;
}

export default function RunScreen({ profile, target, onFinish }: Props) {
  const coach = coachById(profile.coachId);
  const [elapsedS, setElapsedS] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [paceS, setPaceS] = useState<number | null>(null);
  const [lastLine, setLastLine] = useState("");
  const [intercepted, setIntercepted] = useState(false);

  const filter = useRef(new PaceFilter()).current;
  const engineRef = useRef<CoachingEngine | null>(null);
  const selectorRef = useRef<LineSelector | null>(null);
  const lastFix = useRef<Fix | null>(null);
  const distRef = useRef(0);
  const elapsedRef = useRef(0);
  const splitsRef = useRef<Split[]>([]);
  const splitStartS = useRef(0);
  const splitStartM = useRef(0);
  const transcript = useRef<{ atS: number; text: string }[]>([]);
  const startedAt = useRef(new Date().toISOString());
  const wasSaved = useRef(false);
  const quitWalkUntil = useRef<number | null>(null);

  const say = (text: string) => {
    transcript.current.push({ atS: elapsedRef.current, text });
    setLastLine(text);
    speak(coach, text);
  };

  // Boot: line history, engine, GPS, pre-run brief
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const history = await loadLineHistory();
      selectorRef.current = new LineSelector(history, profile.strongLanguage);
      engineRef.current = new CoachingEngine(coach, target, profile.segment, profile.runsCompleted);

      // Tier-2 pre-run brief, pre-fetched (spec §6.1); canned RUN_START as fallback.
      const brief = await fetchTier2("brief", coach.id, {
        today_plan: target, segment: profile.segment, runs_completed: profile.runsCompleted,
      });
      if (cancelled) return;
      if (brief) say(brief);
      else {
        const line = selectorRef.current.pick(coach.id, "RUN_START", 1, slots());
        if (line) say(line.text);
      }

      stop = await startTracking((fix) => {
        filter.addSample(fix.speed, fix.accuracy, fix.t);
        if (lastFix.current && fix.accuracy != null && fix.accuracy < 35) {
          const d = haversineM(lastFix.current, fix);
          if (d > 0.5 && d < 60) {
            distRef.current += d;
            setDistanceM(Math.round(distRef.current));
          }
        }
        lastFix.current = fix;
      });
      sendEvents([{ type: "run_started", payload: { coach: coach.id, mode: target.mode } }]);
    })();
    return () => { cancelled = true; stop?.(); stopSpeech(); };
  }, []);

  // Read live values from refs/filter — this runs inside interval closures
  // where React state would be stale.
  const slots = () => {
    const cur = filter.paceSecPerKm();
    return {
      pace: target.targetPaceS ? fmtPace(target.targetPaceS) : cur ? fmtPace(cur) : "this pace",
      dist: fmtDist(target.distanceM),
      n: cur && target.targetPaceS
        ? String(Math.abs(cur - target.targetPaceS))
        : String(Math.max(1, Math.floor(distRef.current / 1000))),
    };
  };

  // 1 Hz clock + 10 s engine tick
  useEffect(() => {
    const clock = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedS(elapsedRef.current);
      setPaceS(filter.paceSecPerKm());

      // close a km split
      if (distRef.current - splitStartM.current >= 1000) {
        const dt = elapsedRef.current - splitStartS.current;
        splitsRef.current.push({ km: splitsRef.current.length + 1, paceS: Math.round(dt) });
        splitStartS.current = elapsedRef.current;
        splitStartM.current = distRef.current;
      }

      // E-RUN-SAVED: resumed running after a quit-intercept walk
      if (quitWalkUntil.current !== null && filter.speed() > 2.0) {
        quitWalkUntil.current = null;
        wasSaved.current = true;
        const line = selectorRef.current?.pick(coach.id, "RUN_SAVED", 1, slots());
        if (line) say(line.text);
        sendEvents([{ type: "run_saved", payload: { coach: coach.id } }]);
      }

      if (elapsedRef.current % 10 !== 0) return;
      const engine = engineRef.current;
      const selector = selectorRef.current;
      if (!engine || !selector) return;
      const prompt = engine.tick(
        {
          elapsedS: elapsedRef.current,
          distanceM: distRef.current,
          paceS: filter.paceSecPerKm(),
          trend: filter.trend(),
          hasEnoughData: filter.hasEnoughData(),
          speedMs: filter.speed(),
        },
        splitsRef.current.map((sp) => sp.paceS)
      );
      if (prompt) {
        const line = selector.pick(coach.id, prompt.event, prompt.intensity, slots());
        if (line) {
          say(line.text);
          // prompt_played + prompt_reaction seed (pace measured again client-side at +60 s
          // would refine this; MVP logs pace at play time — spec §7.3)
          sendEvents([{ type: "prompt_played", payload: { coach: coach.id, line_id: line.lineId, state: prompt.event, intensity: prompt.intensity, pace_s: filter.paceSecPerKm() } }]);
        }
      }
    }, 1000);
    return () => clearInterval(clock);
  }, []);

  const fractionRemaining = target.distanceM > 0 ? 1 - distRef.current / target.distanceM : 0;

  const onEndPress = () => {
    // E-QUIT-TAP (spec D.7): one intercept when >25% remains; suppressed if AT_RISK;
    // second tap ends instantly and gracefully.
    const engine = engineRef.current;
    const atRisk = engine?.state === "AT_RISK";
    if (!intercepted && fractionRemaining > 0.25 && !atRisk && elapsedRef.current > 60) {
      setIntercepted(true);
      const line = selectorRef.current?.pick(coach.id, "QUIT_INTERCEPT", 1, slots());
      const script = line?.text ?? "Two minutes of walking, then decide?";
      say(script);
      Alert.alert("Hold on —", script, [
        {
          text: "Walk it with me (2 min)",
          onPress: () => { quitWalkUntil.current = elapsedRef.current + 120; },
        },
        { text: "End run", style: "destructive", onPress: () => endRun(true) },
      ]);
      return;
    }
    endRun(fractionRemaining > 0.1);
  };

  const endRun = async (quitEarly: boolean) => {
    stopSpeech();
    if (quitEarly && quitWalkUntil.current !== null) {
      // E-WALKED-OUT: full grace, partial credit (D.7)
      const line = selectorRef.current?.pick(coach.id, "WALKED_OUT", 1, slots());
      if (line) transcript.current.push({ atS: elapsedRef.current, text: line.text });
    }
    const avg = distRef.current > 100 ? Math.round(elapsedRef.current / (distRef.current / 1000)) : null;
    const targetMet =
      target.mode === "PACE" && target.targetPaceS && avg
        ? !quitEarly && avg <= target.targetPaceS + (target.toleranceS ?? 15)
        : !quitEarly;
    if (selectorRef.current) await saveLineHistory(selectorRef.current.getPlayCounts());
    onFinish({
      clientRunId: `${Date.now()}`,
      coachId: coach.id,
      mode: target.mode,
      startedAt: startedAt.current,
      durationS: elapsedRef.current,
      distanceM: Math.round(distRef.current),
      avgPaceS: avg,
      targetPaceS: target.targetPaceS ?? null,
      targetMet,
      wasSaved: wasSaved.current,
      quitEarly,
      splits: splitsRef.current,
      transcript: transcript.current,
    });
  };

  return (
    <View style={s.root}>
      <Text style={s.coachLabel}>{coach.name}</Text>
      <Text style={s.timer}>{fmtDuration(elapsedS)}</Text>
      <View style={s.statRow}>
        <Stat label="DISTANCE" value={fmtDist(distanceM)} />
        <Stat label="PACE /KM" value={fmtPace(paceS)} />
        {target.targetPaceS ? <Stat label="TARGET" value={fmtPace(target.targetPaceS)} /> : null}
      </View>
      <View style={s.lineBox}>
        <Text style={s.lineText}>{lastLine || "…"}</Text>
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
