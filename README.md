# PaceMaker — AI Running Coach (MVP)

Adaptive-personality running coach. The coach is the product: 9 personas, a deterministic
real-time coaching engine, and LLM-generated "relationship" moments (brief / debrief /
milestones / weekly recap).

Built per `run-coach-product-spec.md` v0.1. Monorepo with two apps:

```
server/   Node + Express + TypeScript REST API  ← this is what Replit hosts & runs
mobile/   Expo (React Native) Android client    ← developed in the workspace, built via EAS
```

## Quick start on Replit

1. **Import this repo** into Replit (Import from GitHub, or upload the folder).
2. **Provision PostgreSQL**: open the *Database* tool in Replit and create a PostgreSQL
   database. Replit injects `DATABASE_URL` automatically. Tables are created on first boot.
3. **Set Secrets** (Tools → Secrets):
   | Secret | Required | Purpose |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | for LLM moments | Claude API key for Tier-2 coach content |
   | `JWT_SECRET` | yes | Session token signing (any long random string) |
   | `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-4-8` |
4. **Run.** The `.replit` file starts the API (`server/`) on port 3000. Replit maps it to 80/443.
5. **Deploy**: use a Replit *Autoscale* deployment for production (run command:
   `npm run start --prefix server`, build command: `npm run build --prefix server`).

The API works without `ANTHROPIC_API_KEY` — Tier-2 endpoints then return canned fallback
scripts (the spec's offline rule: *the coach never goes silent and never blocks on network*).

## Running the mobile app

Replit cannot build native Android binaries; the Expo client is compiled in the cloud via
**EAS Build** (no local Android Studio needed):

```bash
cd mobile
npm install
npx expo start --tunnel          # dev: scan QR with the Expo Go app on your phone
npx eas build -p android --profile preview   # cloud-build an installable APK
```

Set the API base URL for the app in `mobile/src/services/api.ts` (your Replit deployment URL).

> GPS note: full *background* tracking (screen locked) requires a custom dev client /
> EAS build because Expo Go cannot register background location tasks on Android 14+.
> Foreground tracking (screen on, app open) works in Expo Go and is enough for Phase-0
> validation of pace smoothing + engine behaviour, which the spec calls out as the first
> make-or-break item (Risk #1).

## What's implemented (MVP / Phase 0+)

- **Startup Wizard** — goal classifier → S1–S4 segment, reality check, style question,
  coach recommendations with the gating matrix (Pushers soft-locked for S1/S2 with
  double-confirm; escalation caps enforced by segment).
- **9 coaches** — personas, escalation curves, and the full Appendix-B PACE-mode line banks
  plus variant sets for high-frequency cells; humor-tagged lines; Strong-Language twins
  with clean fallbacks.
- **Adaptive engine** (`mobile/src/engine/`) — deterministic state machine evaluated every
  10 s: ON_TARGET / SLIPPING / RECOVERING / AHEAD / STRUGGLING / AT_RISK, escalation
  ramp + cooldown per coach, anti-nag (max 1 corrective per 90 s, non-corrective line
  between two correctives), crisis-window prompt (55–70 %), final-stretch density ramp,
  COMPLETION mode (run/walk intervals, never scolds) and CONSISTENCY mode.
- **Pace smoothing** — rolling-window + outlier-rejecting filter over raw GPS speed;
  grace period (no judgement on <15 s of data).
- **Quit intercept** — E-QUIT-TAP downgrade ladder (1/run hard cap, second tap ends
  gracefully), E-RUN-SAVED / E-WALKED-OUT celebrations.
- **Voice** — on-device TTS (`expo-speech`) with per-coach rate/pitch as the stand-in for
  the canned Opus voice bank (Appendix C pipeline is an offline batch job, out of repo scope).
- **Backend** — device auth (JWT), run sync, rule-based plan generation per segment,
  remote-config endpoint (paywall gate threshold etc.), event analytics ingest incl.
  `prompt_played`, and the **LLM proxy** for brief/debrief/milestone/recap with per-user
  daily token budget and canned fallback.

## Explicitly deferred (per spec §10 / solo-builder honesty)

Buddy matching + chat, Google Play Billing / RevenueCat wiring (entitlements table and
provider-agnostic shape exist), Google OAuth (device auth ships first), HR/BLE, elevation,
real TTS voice bank generation, admin dashboard. Each has a marked extension point.
