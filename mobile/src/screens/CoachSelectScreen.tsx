// Coach browsing & switching between runs (spec §3.4). Pushers stay
// soft-locked for S1/S2 with the double-confirm. Strong Language toggle
// lives here (S4 only — spec §2.2 gating table).

import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch } from "react-native";
import { Profile } from "../types";
import { COACHES, isPusherSoftLocked, coachById } from "../data/coaches";
import { speak } from "../services/speech";
import { LINE_BANK } from "../data/lineBank";
import { T, archetypeColor } from "../theme";

interface Props {
  profile: Profile;
  onSelect: (coachId: string, strongLanguage: boolean) => void;
  onBack: () => void;
}

export default function CoachSelectScreen({ profile, onSelect, onBack }: Props) {
  const [strong, setStrong] = useState(profile.strongLanguage);

  const preview = (coachId: string) => {
    const coach = coachById(coachId);
    const line = LINE_BANK.find((l) => l.coachId === coachId && l.event === "RUN_START");
    if (line) speak(coach, line.text.replace("{pace}", "5:30").replace("{dist}", "5 kilometres").replace("{n}", "28 minutes"));
  };

  const choose = (coachId: string) => {
    if (isPusherSoftLocked(profile.segment, coachId)) {
      const coach = coachById(coachId);
      Alert.alert(
        `${coach.name} doesn't do gentle.`,
        "Are you sure? Intensity stays capped for your level either way.",
        [
          { text: "Maybe not", style: "cancel" },
          { text: "I'm sure", onPress: () => onSelect(coachId, strong) },
        ]
      );
      return;
    }
    onSelect(coachId, strong);
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <TouchableOpacity onPress={onBack}><Text style={s.back}>‹ back</Text></TouchableOpacity>
      <Text style={s.title}>Coaches</Text>
      {profile.segment === "S4" && (
        <View style={s.strongRow}>
          <Text style={s.strongLabel}>Strong Language tier</Text>
          <Switch value={strong} onValueChange={setStrong} trackColor={{ true: T.pusher }} />
        </View>
      )}
      {COACHES.map((c) => {
        const locked = isPusherSoftLocked(profile.segment, c.id);
        const active = c.id === profile.coachId;
        return (
          <View key={c.id} style={[s.card, { borderColor: active ? T.accent : archetypeColor[c.archetype] }]}>
            <View style={s.header}>
              <Text style={s.name}>{c.name}{active ? "  ✓" : ""}</Text>
              <Text style={[s.badge, { color: archetypeColor[c.archetype] }]}>{c.archetype}{locked ? " · ⚠" : ""}</Text>
            </View>
            <Text style={s.tagline}>{c.tagline}</Text>
            <View style={s.actions}>
              <TouchableOpacity onPress={() => preview(c.id)}><Text style={s.previewBtn}>▶ preview voice</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => choose(c.id)}><Text style={s.chooseBtn}>choose</Text></TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.pad, paddingTop: 56, paddingBottom: 40 },
  back: { color: T.dim, fontSize: 15, marginBottom: 10 },
  title: { color: T.text, fontSize: 24, fontWeight: "800", marginBottom: 14 },
  strongRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: T.card, borderRadius: T.radius, padding: 14, marginBottom: 14 },
  strongLabel: { color: T.text, fontSize: 15 },
  card: { backgroundColor: T.card, borderRadius: T.radius, borderWidth: 1, padding: 16, marginBottom: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  name: { color: T.text, fontSize: 17, fontWeight: "700" },
  badge: { fontSize: 13, fontWeight: "600" },
  tagline: { color: T.dim, fontSize: 14, lineHeight: 19, marginBottom: 10 },
  actions: { flexDirection: "row", justifyContent: "space-between" },
  previewBtn: { color: T.dim, fontSize: 14 },
  chooseBtn: { color: T.accent, fontSize: 14, fontWeight: "700" },
});
