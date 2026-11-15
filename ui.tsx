import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { StyleSheet, Text, View } from "react-native";
import { Theme, makeStyles, useGlow, useTheme } from "./theme";

// Progress bar made of blocks, like ██████████░░░░░░
export function BlockBar({
  value,
  total,
  length = 18,
  color,
}: {
  value: number;
  total: number;
  length?: number;
  color?: string;
}) {
  const t = useTheme();
  const filled = total > 0 ? Math.round((value / total) * length) : 0;
  return (
    <Text style={[styles.bar, { fontFamily: t.mono }]} numberOfLines={1}>
      <Text style={{ color: color ?? t.green }}>{"█".repeat(filled)}</Text>
      <Text style={{ color: t.line }}>{"█".repeat(length - filled)}</Text>
    </Text>
  );
}

// Dark blurred shadow with a big icon, laid over locked content
export function LockOverlay({
  title = "LOCKED",
  text,
  icon = "lock-closed",
  inset = 0,
}: {
  title?: string;
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
  inset?: number;
}) {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  return (
    <View style={[s.overlay, { top: inset, bottom: inset, left: inset, right: inset }]}>
      {/* Light themes (punch cards) get a light frost, dark themes a dark shadow */}
      <BlurView intensity={14} tint={t.statusBar === "dark" ? "light" : "dark"} style={StyleSheet.absoluteFill} />
      <View style={s.shade} />
      <View style={s.circle}>
        <Ionicons name={icon} size={32} color={t.green} />
      </View>
      <Text style={[s.title, glow]}>{title}</Text>
      <Text style={s.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { fontSize: 10, letterSpacing: -1 },
});

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    overlay: {
      position: "absolute",
      borderRadius: t.soft + 2,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: t.line,
    },
    shade: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.statusBar === "dark" ? "rgba(217, 207, 180, 0.65)" : "rgba(5, 9, 6, 0.55)",
    },
    circle: {
      width: 76,
      height: 76,
      borderRadius: 38,
      borderWidth: 1.5,
      borderColor: t.dim,
      backgroundColor: t.surface,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: t.green,
      shadowOpacity: t.glowColor ? 0.35 : 0,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 0 },
    },
    title: { fontFamily: t.mono, fontSize: 16, fontWeight: "700", color: t.green, letterSpacing: 4, marginTop: 12 },
    text: { fontFamily: t.mono, fontSize: 12, color: t.green, opacity: 0.75, marginTop: 4 },
  })
);

// ---------- The smooth look ----------

// Rounder corners for the menu, rail and home cards, scaled from each course's own radius:
// the terminal gets soft pills, COBOL's square 3270 screen only slightly rounded corners.
export function softRadius(t: Theme) {
  return t.soft;
}

// A soft glow around a box, for the courses whose screens glow (none on paper or circuit boards)
export function boxGlow(t: Theme, color = t.green, strength = 0.45) {
  if (!t.glowColor) return null;
  return { shadowColor: color, shadowOpacity: strength, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } };
}

// A rounded progress bar
export function SmoothBar({ value, total, color, height = 8 }: { value: number; total: number; color?: string; height?: number }) {
  const t = useTheme();
  const part = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.faint, borderWidth: 1, borderColor: t.line, overflow: "hidden" }}>
      <View style={[{ width: `${part * 100}%`, height: "100%", borderRadius: height / 2, backgroundColor: color ?? t.green }, part > 0 && boxGlow(t, color ?? t.green, 0.6)]} />
    </View>
  );
}

// How much of the course is done: a ring of dots that light up, with the percentage inside
export function ProgressDots({ percent, size = 64, dots = 20 }: { percent: number; size?: number; dots?: number }) {
  const t = useTheme();
  const glow = useGlow();
  const lit = Math.round((percent / 100) * dots);
  const dot = 5;
  const r = size / 2 - dot;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${percent} percent done`}>
      {Array.from({ length: dots }, (_, i) => {
        const a = (i / dots) * Math.PI * 2 - Math.PI / 2;
        const on = i < lit;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: size / 2 + r * Math.cos(a) - dot / 2,
              top: size / 2 + r * Math.sin(a) - dot / 2,
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: on ? t.green : t.line,
            }}
          />
        );
      })}
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={[{ fontFamily: t.mono, fontSize: 13, fontWeight: "700", color: t.green }, glow]}>{percent}%</Text>
        <Text style={{ fontFamily: t.mono, fontSize: 8, letterSpacing: 1, color: t.dim }}>DONE</Text>
      </View>
    </View>
  );
}
