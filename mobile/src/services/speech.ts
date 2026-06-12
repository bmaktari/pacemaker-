// Coach voice via on-device TTS (expo-speech) — the stand-in for the canned
// Opus voice bank (Appendix C). Per-coach pitch/rate gives each persona a
// distinct delivery until the real voice packs land. Music ducking is handled
// by the OS audio focus when TTS plays.

import * as Speech from "expo-speech";
import { Coach } from "../types";

let speaking = false;

export function speak(coach: Coach, text: string, onDone?: () => void): void {
  // Never stack prompts — newest wins only if nothing is playing (silence is
  // also coaching, spec D.5); queued prompts drop rather than stack.
  if (speaking) return;
  speaking = true;
  Speech.speak(text, {
    pitch: coach.tts.pitch,
    rate: coach.tts.rate,
    onDone: () => { speaking = false; onDone?.(); },
    onStopped: () => { speaking = false; },
    onError: () => { speaking = false; },
  });
}

export function stopSpeech(): void {
  Speech.stop();
  speaking = false;
}
