// All run-session logic (GPS → filter → engine → line → TTS, splits, quit
// interception, run assembly) lives here; RunScreen stays presentational.

import { useEffect, useRef, useState } from "react";
import { Profile, RunTarget, CompletedRun, Split } from "../types";
import { coachById } from "../data/coaches";
import { CoachingEngine } from "../engine/stateMachine";
import { PaceFilter } from "../engine/paceFilter";
import { LineSelector, buildSlots } from "../engine/lineSelector";
import { EngineEvent } from "../types";
import { speak, stopSpeech } from "../services/speech";
import { startTracking, haversineM, Fix } from "../services/location";
import { loadLineHistory, saveLineHistory } from "../services/storage";
import { fetchTier2, sendEvents } from "../services/api";

export interface RunSession {
  elapsedS: number;
  distanceM: number;
  paceS: number | null;
  lastLine: string;
  fractionRemaining: number;
  /** Quit-intercept gate (spec D.7). Returns the intercept script when the
   *  one-per-run intercept should fire; null means end immediately. */
  quitIntercept: () => string | null;
  /** User accepted the 2-minute walk downgrade. */
  acceptWalk: () => void;
  /** Finalize the run and hand the CompletedRun to the caller. */
  endRun: (quitEarly: boolean) => Promise<void>;
}

export function useRunSession(
  profile: Profile,
  target: RunTarget,
  onFinish: (run: CompletedRun) => void
): RunSession {
  const coach = coachById(profile.coachId);
  const [elapsedS, setElapsedS] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [paceS, setPaceS] = useState<number | null>(null);
  const [lastLine, setLastLine] = useState("");

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
  const intercepted = useRef(false);

  const say = (text: string) => {
    transcript.current.push({ atS: elapsedRef.current, text });
    setLastLine(text);
    speak(coach, text);
  };

  // Live values come from refs/filter — interval closures would see stale state.
  const slots = (event: EngineEvent) =>
    buildSlots(event, {
      distanceM: distRef.current,
      targetDistanceM: target.distanceM,
      targetPaceS: target.targetPaceS,
      curPaceS: filter.paceSecPerKm(),
    });

  // Boot: line history, engine, GPS, pre-run brief
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const history = await loadLineHistory();
      selectorRef.current = new LineSelector(history, profile.strongLanguage);
      engineRef.current = new CoachingEngine(coach, target, profile.segment, profile.runsCompleted);

      const brief = await fetchTier2("brief", coach.id, {
        today_plan: target, segment: profile.segment, runs_completed: profile.runsCompleted,
      });
      if (cancelled) return;
      if (brief) say(brief);
      else {
        const line = selectorRef.current.pick(coach.id, "RUN_START", 1, slots("RUN_START"));
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

  // 1 Hz clock + 10 s engine tick
  useEffect(() => {
    const clock = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedS(elapsedRef.current);
      setPaceS(filter.paceSecPerKm());

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
        const line = selectorRef.current?.pick(coach.id, "RUN_SAVED", 1, slots("RUN_SAVED"));
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
        const line = selector.pick(coach.id, prompt.event, prompt.intensity, slots(prompt.event));
        if (line) {
          say(line.text);
          sendEvents([{ type: "prompt_played", payload: { coach: coach.id, line_id: line.lineId, state: prompt.event, intensity: prompt.intensity, pace_s: filter.paceSecPerKm() } }]);
        }
      }
    }, 1000);
    return () => clearInterval(clock);
  }, []);

  const fractionRemaining = target.distanceM > 0 ? Math.max(0, 1 - distanceM / target.distanceM) : 0;

  const quitIntercept = (): string | null => {
    const atRisk = engineRef.current?.state === "AT_RISK";
    const remaining = target.distanceM > 0 ? 1 - distRef.current / target.distanceM : 0;
    if (intercepted.current || remaining <= 0.25 || atRisk || elapsedRef.current <= 60) return null;
    intercepted.current = true;
    const line = selectorRef.current?.pick(coach.id, "QUIT_INTERCEPT", 1, slots("QUIT_INTERCEPT"));
    const script = line?.text ?? "Two minutes of walking, then decide?";
    say(script);
    return script;
  };

  const acceptWalk = () => {
    quitWalkUntil.current = elapsedRef.current + 120;
  };

  const endRun = async (quitEarly: boolean) => {
    stopSpeech();
    if (quitEarly && quitWalkUntil.current !== null) {
      // E-WALKED-OUT: full grace, partial credit (D.7)
      const line = selectorRef.current?.pick(coach.id, "WALKED_OUT", 1, slots("WALKED_OUT"));
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

  return { elapsedS, distanceM, paceS, lastLine, fractionRemaining, quitIntercept, acceptWalk, endRun };
}
