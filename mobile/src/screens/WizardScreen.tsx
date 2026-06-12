// Startup Wizard (spec §2.2): goal classifier → segment, reality check,
// style question, coach recommendation with the gating matrix.

import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from "react-native";
import { Segment, CoachStyle, Profile } from "../types";
import { COACHES, recommendCoaches, isPusherSoftLocked, coachById } from "../data/coaches";
import { T, archetypeColor } from "../theme";

interface Props {
  onComplete: (profile: Omit<Profile, "token" | "runsCompleted">) => void;
}

type Step = "goal" | "reality" | "style" | "coach";

const GOALS: { label: string; segment: Segment }[] = [
  { label: "Run without stopping for the first time", segment: "S1" },
  { label: "Run further than I can today", segment: "S2" },
  { label: "Stay active and consistent", segment: "S3" },
  { label: "Get faster / hit a race time", segment: "S4" },
];

const REALITY: { label: string; maxSegment: Segment }[] = [
  { label: "I get winded within a few hundred metres", maxSegment: "S1" },
  { label: "I can run about 1 km continuously", maxSegment: "S2" },
  { label: "I can run 3–5 km, most days if I want", maxSegment: "S4" },
  { label: "I train regularly and race", maxSegment: "S4" },
];

const STYLES: { label: string; value: CoachStyle }[] = [
  { label: "Encourage me", value: "encourage" },
  { label: "Teach me", value: "teach" },
  { label: "Push me", value: "push" },
];

const ORDER: Segment[] = ["S1", "S2", "S3", "S4"];

export default function WizardScreen({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("goal");
  const [claimed, setClaimed] = useState<Segment>("S4");
  const [segment, setSegment] = useState<Segment>("S4");
  const [style, setStyle] = useState<CoachStyle>("encourage");
  const [showAll, setShowAll] = useState(false);

  const pickGoal = (s: Segment) => { setClaimed(s); setStep("reality"); };

  const pickReality = (max: Segment) => {
    // Reality check corrects optimistic self-classification (the Tom problem):
    // never assign a segment above what the evidence supports.
    const corrected = ORDER[Math.min(ORDER.indexOf(claimed), ORDER.indexOf(max))];
    setSegment(corrected);
    setStep("style");
  };

  const pickCoach = (coachId: string) => {
    if (isPusherSoftLocked(segment, coachId)) {
      const coach = coachById(coachId);
      Alert.alert(
        `${coach.name} doesn't do gentle.`,
        "Are you sure? Their intensity will still be capped for your level — the engine protects you from the worst of it.",
        [
          { text: "Maybe not", style: "cancel" },
          { text: "I'm sure", onPress: () => finish(coachId) },
        ]
      );
      return;
    }
    finish(coachId);
  };

  const finish = (coachId: string) => {
    onComplete({ segment, coachId, strongLanguage: false, displayName: "Runner" });
  };

  const recommended = recommendCoaches(segment, style);
  const visibleCoaches = showAll ? COACHES : COACHES.filter((c) => recommended.includes(c.id));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.brand}>PaceMaker</Text>
      {step === "goal" && (
        <>
          <Text style={s.q}>What does success look like for you right now?</Text>
          {GOALS.map((g) => (
            <Option key={g.segment} label={g.label} onPress={() => pickGoal(g.segment)} />
          ))}
        </>
      )}
      {step === "reality" && (
        <>
          <Text style={s.q}>Honestly — where are you today?</Text>
          <Text style={s.hint}>No judgement. This is how your coach avoids asking too much, too soon.</Text>
          {REALITY.map((r) => (
            <Option key={r.label} label={r.label} onPress={() => pickReality(r.maxSegment)} />
          ))}
        </>
      )}
      {step === "style" && (
        <>
          <Text style={s.q}>How do you want your coach to talk to you?</Text>
          {STYLES.map((st) => (
            <Option key={st.value} label={st.label} onPress={() => { setStyle(st.value); setStep("coach"); }} />
          ))}
        </>
      )}
      {step === "coach" && (
        <>
          <Text style={s.q}>Meet your coaches</Text>
          <Text style={s.hint}>Recommended for you — tap one to start.</Text>
          {visibleCoaches.map((c) => {
            const locked = isPusherSoftLocked(segment, c.id);
            return (
              <TouchableOpacity key={c.id} style={[s.coachCard, { borderColor: archetypeColor[c.archetype] }]} onPress={() => pickCoach(c.id)}>
                <View style={s.coachHeader}>
                  <Text style={s.coachName}>{c.name}</Text>
                  <Text style={[s.badge, { color: archetypeColor[c.archetype] }]}>
                    {c.archetype}{locked ? " · ⚠" : ""}
                  </Text>
                </View>
                <Text style={s.tagline}>{c.tagline}</Text>
              </TouchableOpacity>
            );
          })}
          {!showAll && (
            <TouchableOpacity onPress={() => setShowAll(true)}>
              <Text style={s.showAll}>Show all coaches</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Option({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.option} onPress={onPress}>
      <Text style={s.optionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.pad, paddingTop: 64 },
  brand: { color: T.accent, fontSize: 28, fontWeight: "800", marginBottom: 24 },
  q: { color: T.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  hint: { color: T.dim, fontSize: 14, marginBottom: 16 },
  option: { backgroundColor: T.card, borderRadius: T.radius, padding: 18, marginBottom: 10 },
  optionText: { color: T.text, fontSize: 16 },
  coachCard: { backgroundColor: T.card, borderRadius: T.radius, borderWidth: 1, padding: 16, marginBottom: 10 },
  coachHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  coachName: { color: T.text, fontSize: 17, fontWeight: "700" },
  badge: { fontSize: 13, fontWeight: "600" },
  tagline: { color: T.dim, fontSize: 14, lineHeight: 19 },
  showAll: { color: T.dim, textAlign: "center", padding: 14, textDecorationLine: "underline" },
});
