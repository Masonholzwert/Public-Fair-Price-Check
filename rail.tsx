import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { ReactNode, createContext, useCallback, useContext, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "./press";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWide } from "./lib/layout";
import { useCourse } from "./lib/active-course";
import { dailyChallenge } from "./lib/daily";
import { MenuStats, initials, menuNavigate, useMenuStats } from "./menu";
import { sound } from "./sounds";
import { makeStyles, useTheme } from "./theme";
import { boxGlow, softRadius } from "./ui";

type IconName = keyof typeof Ionicons.glyphMap;

// The rail: a slim strip of icons on the left of the menu screens (on phones), so the screens you use
// most are one tap away. ☰ opens the full menu, which slides out from under it.
export function Rail({ stats, onMenu, active }: { stats: MenuStats; onMenu: () => void; active: string }) {
  const t = useTheme();
  const s = useStyles();
  const { course } = useCourse();
  const led = t.button === "key";

  const litBg = led ? t.keyFace : t.green;
  const litFg = led ? t.keyText : t.bg;

  function Item({ icon, label, path, color, dot }: { icon: IconName; label: string; path: string; color?: string; dot?: boolean }) {
    const lit = path === active;
    return (
      <Pressable
        accessibilityLabel={dot ? `${label}, new` : label}
        accessibilityState={{ selected: lit }}
        onPress={() => menuNavigate(path, active)}
        style={({ pressed }) => [s.button, lit && [{ backgroundColor: litBg }, boxGlow(t, litBg)], pressed && !lit && s.pressed]}
      >
        <Ionicons name={icon} size={20} color={lit ? litFg : color ?? t.green} />
        {dot && <View style={[s.dot, boxGlow(t, t.amber, 0.9)]} />}
      </Pressable>
    );
  }

  return (
    <View style={s.rail}>
      <View style={s.pill}>
        <Pressable
          accessibilityLabel="Open menu"
          onPress={() => {
            sound("open");
            onMenu();
          }}
          style={({ pressed }) => [s.button, pressed && s.pressed]}
        >
          <Ionicons name="menu" size={20} color={t.green} />
        </Pressable>
        <View style={s.divider} />
        <Item icon="radio-button-on" label="Learn" path="/" />
        {course.hasPractice && <Item icon="terminal" label="Practice" path="/practice" />}
        {dailyChallenge() && (
          <Item icon="sunny-outline" label="Daily challenge" path="/daily" color={stats.dailyNew ? t.amber : t.green} dot={stats.dailyNew} />
        )}
        <Item icon="book-outline" label="Reference" path="/reference" />
        <Item icon="code-slash-outline" label="Sandbox" path="/sandbox" />
        <View style={s.divider} />
        <Pressable
          accessibilityLabel="Profile"
          accessibilityState={{ selected: active === "/profile" }}
          onPress={() => menuNavigate("/profile", active)}
          style={({ pressed }) => [s.avatar, active === "/profile" && { backgroundColor: litBg }, pressed && s.pressed]}
        >
          {stats.name ? (
            <Text style={[s.avatarText, active === "/profile" && { color: litFg }]}>{initials(stats.name)}</Text>
          ) : (
            <Ionicons name="person-outline" size={18} color={active === "/profile" ? litFg : t.green} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

export const RAIL_WIDTH = 68;

const useStyles = makeStyles((t) => {
  const r = softRadius(t);
  const round = Math.min(22, r);
  return StyleSheet.create({
    rail: { width: RAIL_WIDTH, paddingLeft: 10, paddingTop: 8 },
    pill: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: r + 4,
      paddingVertical: 8,
      paddingHorizontal: 5,
      alignItems: "center",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
    button: { width: 44, height: 44, borderRadius: round, alignItems: "center", justifyContent: "center" },
    pressed: { backgroundColor: t.faint },
    divider: { width: 24, height: 1, backgroundColor: t.line },
    dot: { position: "absolute", top: 9, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: t.amber },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: round,
      borderWidth: 1.5,
      borderColor: t.green,
      backgroundColor: t.faint,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontFamily: t.mono, fontSize: 12, fontWeight: "700", color: t.green },
  });
});

// Opens the slide-out menu. The layout provides it, so there is one menu for all screens.
export const OpenMenuContext = createContext<() => void>(() => {});

// A menu screen with the rail on its left (phones only; a big window has the sidebar).
// The rail is part of the screen, so it slides in and out together with it.
export function WithRail({ path, children }: { path: string; children: ReactNode }) {
  const t = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const openMenu = useContext(OpenMenuContext);
  // Fresh numbers (progress, daily, streak) every time the screen comes into view
  const [visits, setVisits] = useState(0);
  useFocusEffect(useCallback(() => setVisits((n) => n + 1), []));
  const stats = useMenuStats(visits);
  if (wide) return <>{children}</>;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.bg }}>
      <View style={{ paddingTop: insets.top }}>
        <Rail stats={stats} active={path} onMenu={openMenu} />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
