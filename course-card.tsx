import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "./press";
import type { Course } from "./lib/course";
import { glowOf } from "./theme";

// A course card, drawn in its own course's design, like a window into its era.
// Used on the course list and in the first-start introduction.
export function CourseCard({
  course,
  active,
  xp,
  selectable,
  onPress,
  note,
  percent,
}: {
  course: Course;
  active: boolean;
  xp: number;
  selectable: boolean;
  onPress: () => void;
  note?: string; // a small line under the card, like RECOMMENDED FOR BEGINNERS
  percent?: number; // how much of the course is done, 0-100 (lessons, quests and projects)
}) {
  // Uses the card's own course theme, not the active one
  const c = course.theme;
  const glow = glowOf(c.glowColor);
  const lessonCount = course.chapters.reduce((sum, ch) => sum + ch.units.reduce((n, u) => n + u.lessons.length, 0), 0);

  return (
    <Pressable
      disabled={!selectable}
      onPress={onPress}
      style={({ pressed }) => [
        cardStyles.card,
        {
          backgroundColor: c.bg,
          borderColor: active ? c.green : c.line,
          borderRadius: c.soft + 2,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={cardStyles.topRow}>
        <Text style={[cardStyles.label, { color: c.dim, fontFamily: c.mono }]} numberOfLines={2}>
          {c.bootLine}
        </Text>
        {active && (
          <View style={[cardStyles.badge, { backgroundColor: c.green, borderRadius: c.soft / 2 }]}>
            <Text style={[cardStyles.badgeText, { color: c.bg, fontFamily: c.mono }]}>ACTIVE</Text>
          </View>
        )}
      </View>

      <Text style={[cardStyles.title, { color: c.green, fontFamily: c.mono }, glow]}>{course.title}</Text>
      <Text style={[cardStyles.year, { color: c.amber, fontFamily: c.mono }]}>
        {course.year} · {course.machine}
      </Text>
      <Text style={[cardStyles.tagline, { color: c.green, fontFamily: c.mono }]}>{course.tagline}</Text>

      <View style={[cardStyles.footer, { borderTopColor: c.line }]}>
        {course.available ? (
          <Text style={[cardStyles.meta, { color: c.dim, fontFamily: c.mono }]}>
            {course.chapters.length} CHAPTERS · {lessonCount} LESSONS · {xp} XP
          </Text>
        ) : (
          <View style={cardStyles.soonRow}>
            <Ionicons name="time-outline" size={13} color={c.amber} />
            <Text style={[cardStyles.meta, { color: c.amber, fontFamily: c.mono }]}>COMING SOON</Text>
          </View>
        )}
        {selectable && <Ionicons name="chevron-forward" size={16} color={c.green} />}
      </View>

      {course.available && percent !== undefined && (
        <View style={cardStyles.progressRow}>
          <View style={[cardStyles.progressTrack, { borderColor: c.line, borderRadius: c.soft / 2 }]}>
            <View style={[cardStyles.progressFill, { width: `${percent}%`, backgroundColor: percent === 100 ? c.amber : c.green, borderRadius: c.soft / 2 }]} />
          </View>
          <Text style={[cardStyles.progressText, { color: percent === 100 ? c.amber : c.green, fontFamily: c.mono }]}>
            {percent === 100 ? "100% · DONE" : `${percent}%`}
          </Text>
        </View>
      )}

      {/* A taste of the era's style */}
      {course.id === "cobol" ? (
        // A 3270 input field, with the cursor waiting
        <View style={cardStyles.fieldRow}>
          <Text style={[cardStyles.fieldLabel, { fontFamily: c.mono }]}>{"TOTAL ===>"}</Text>
          <Text style={[cardStyles.fieldValue, { fontFamily: c.mono }]}>$1,234.50</Text>
          <View style={cardStyles.fieldCursor} />
        </View>
      ) : course.id === "altair" ? (
        // The Altair's front panel: a row of red lights, showing 42 (00 101 010)
        <View style={cardStyles.panelRow}>
          {[0, 0, 1, 0, 1, 0, 1, 0].map((on, i) => (
            <View key={i} style={[cardStyles.panelLed, on ? cardStyles.panelLedOn : cardStyles.panelLedOff, (i === 1 || i === 4) && { marginRight: 8 }]} />
          ))}
        </View>
      ) : c.button === "key" ? (
        <View style={cardStyles.leds}>
          {["A", "X", "Y"].map((r, i) => (
            <View key={r} style={cardStyles.led}>
              <Text style={[cardStyles.ledLabel, { color: c.dim, fontFamily: c.mono }]}>{r}</Text>
              <Text style={[cardStyles.ledValue, { fontFamily: c.mono, color: i === 0 ? "#FF3B2F" : "#5E1712" }]}>
                {i === 0 ? "42" : "00"}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[cardStyles.prompt, { color: c.green, fontFamily: c.mono }, glow]}>{c.prompt} █</Text>
      )}
      {note && <Text style={[cardStyles.note, { color: c.amber, fontFamily: c.mono }]}>{note}</Text>}
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: { borderWidth: 1.5, padding: 18, marginTop: 16 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  label: { fontSize: 10, letterSpacing: 1.5, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  title: { fontSize: 24, fontWeight: "700", marginTop: 10 },
  year: { fontSize: 12, marginTop: 4, letterSpacing: 0.5 },
  tagline: { fontSize: 13, lineHeight: 19, marginTop: 10, opacity: 0.85 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTopWidth: 1 },
  meta: { fontSize: 11, letterSpacing: 1 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  progressTrack: { flex: 1, height: 8, borderWidth: 1, overflow: "hidden" },
  progressFill: { height: "100%" },
  progressText: { fontSize: 11, fontWeight: "700", letterSpacing: 1, minWidth: 40, textAlign: "right" },
  soonRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  prompt: { fontSize: 14, marginTop: 12 },
  note: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginTop: 12 },
  leds: { flexDirection: "row", gap: 8, marginTop: 14 },
  panelRow: { flexDirection: "row", gap: 6, marginTop: 16 },
  fieldRow: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  fieldLabel: { fontSize: 13, color: "#4FC7C7" },
  fieldValue: { fontSize: 13, color: "#4FE36A", marginLeft: 8 },
  fieldCursor: { width: 8, height: 15, backgroundColor: "#4FE36A", marginLeft: 2 },
  panelLed: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  panelLedOn: { backgroundColor: "#FF3B26", borderColor: "#FF8A75", shadowColor: "#FF3B26", shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  panelLedOff: { backgroundColor: "#3A1410", borderColor: "#521C16" },
  led: { alignItems: "center", gap: 3 },
  ledLabel: { fontSize: 10 },
  ledValue: {
    fontSize: 18,
    letterSpacing: 2,
    backgroundColor: "#1A0605",
    borderWidth: 1,
    borderColor: "#3B1210",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});

