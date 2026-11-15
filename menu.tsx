import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./press";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCourse } from "./lib/active-course";
import type { Course } from "./lib/course";
import { dailyChallenge, dailyDay, dailyKey } from "./lib/daily";
import { challengeIdsFor, practiceIdsFor } from "./lib/practice";
import { Progress, currentStreak, earnedXp, loadProgress } from "./lib/progress";
import { loadName } from "./lib/stats";
import { sound } from "./sounds";
import { makeStyles, useGlow, useTheme } from "./theme";
import { SmoothBar, boxGlow, softRadius } from "./ui";

const WIDTH = 286;

type IconName = keyof typeof Ionicons.glyphMap;

// ---------- What the menu and the rail show: progress, the daily challenge, your name ----------

export type MenuStats = {
  percent: number; // how much of the course is done
  solved: number; // practice challenges solved
  challenges: number;
  dailyNew: boolean; // there's a daily challenge you haven't solved today
  xp: number;
  streak: number;
  name: string;
};

export function menuStats(course: Course, progress: Progress, name: string): MenuStats {
  const ids = course.allStepIds();
  const challengeIds = challengeIdsFor(course);
  const practiceXp = course.hasPractice ? earnedXp(progress, practiceIdsFor(course)) + (progress.bonusXp ?? 0) : 0;
  return {
    percent: ids.length ? Math.floor((100 * ids.filter((id) => progress.done[id]).length) / ids.length) : 0,
    solved: challengeIds.filter((id) => progress.done[id]).length,
    challenges: challengeIds.length,
    dailyNew: !!dailyChallenge() && !progress.done[dailyKey(dailyDay())],
    xp: earnedXp(progress, ids) + practiceXp,
    streak: currentStreak(progress),
    name,
  };
}

// Loads the stats again whenever `refresh` changes (opening the menu, coming back to the screen)
export function useMenuStats(refresh: unknown): MenuStats {
  const { course } = useCourse();
  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [name, setName] = useState("");
  useEffect(() => {
    loadProgress().then(setProgress);
    loadName().then(setName);
  }, [refresh]);
  return menuStats(course, progress, name);
}

// Two letters for the profile button: "Mason Holz" → MH, "mason" → MA
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

// ---------- The slide-out menu ----------

// Opened from the rail's ☰ button. It slides out from under the rail, so the rail's
// icons stay exactly where they were and get their names next to them.
// Moving between the menu's screens: from home a new screen opens on top (so back returns home),
// between the other menu screens it replaces the one you're on, and Learn goes back to home.
export function menuNavigate(path: string, current: string) {
  if (path === current) return;
  sound("open");
  if (path === "/") {
    // Back down to home: all at once where the router can, else one step (menu screens sit right on top of home)
    const r = router as typeof router & { canDismiss?: () => boolean; dismissAll?: () => void };
    if (r.canDismiss?.() && r.dismissAll) r.dismissAll();
    else if (router.canGoBack()) router.back();
    else router.replace("/" as never);
  } else if (current === "/") router.push(path as never);
  else router.replace(path as never);
}

// The screens the menu (and the rail) lead to; which one you're on lights up
export const MENU_SCREENS = ["/", "/practice", "/daily", "/translate", "/reference", "/sandbox", "/profile", "/leaderboard", "/community", "/courses", "/settings"];

export function SideMenu({ visible, onClose, active = "/" }: { visible: boolean; onClose: () => void; active?: string }) {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const led = t.button === "key";
  // A Modal is drawn outside the normal screen, so SafeAreaView doesn't see the Dynamic Island there.
  // The insets from the hook do, so the menu starts below the island and ends above the home bar.
  const insets = useSafeAreaInsets();
  const stats = useMenuStats(visible);

  // Slide in from the left, slide out before closing
  const slide = useRef(new Animated.Value(-WIDTH - 20)).current;
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) {
      setShown(true);
      Animated.timing(slide, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    } else if (shown) {
      Animated.timing(slide, { toValue: -WIDTH - 20, duration: 160, useNativeDriver: true }).start(() => setShown(false));
    }
  }, [visible]);

  // Close the menu, then open the screen
  const open = (path: string) => () => {
    onClose();
    setTimeout(() => menuNavigate(path, active), 120);
  };

  return (
    <Modal visible={shown} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <Animated.View
        style={[s.panel, { top: insets.top + 8, bottom: insets.bottom + 10, transform: [{ translateX: slide }] }]}
      >
        <View style={s.header}>
          <Pressable onPress={onClose} accessibilityLabel="Close menu" style={({ pressed }) => [s.roundButton, pressed && s.pressed]}>
            <Ionicons name="close" size={20} color={t.green} />
          </Pressable>
          <Text style={[s.title, glow]}>{led ? "▌KIM-1 MONITOR" : "> MAIN MENU_"}</Text>
        </View>
        <View style={s.headerDivider} />
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          <MenuList open={open} onLearn={active === "/" ? onClose : open("/")} active={active} stats={stats} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// The menu entries. Used by the slide-out menu on phones and by the sidebar on a big computer window.
function MenuList({
  open,
  onLearn,
  active,
  stats,
}: {
  open: (path: string) => () => void;
  onLearn: () => void;
  active: string;
  stats: MenuStats;
}) {
  const t = useTheme();
  const s = useStyles();
  const { course } = useCourse();
  const led = t.button === "key";
  const activeBg = led ? t.keyFace : t.green;
  const activeFg = led ? t.keyText : t.bg;

  // One pill-shaped row: icon, name, a small line, and a badge on the right
  function Row({
    icon,
    label,
    sub,
    path,
    onPress,
    badge,
    amber,
  }: {
    icon: IconName;
    label: string;
    sub: string;
    path: string;
    onPress: () => void;
    badge?: string;
    amber?: boolean; // the daily challenge: amber like the quests
  }) {
    const isActive = path === active;
    const fg = isActive ? activeFg : amber ? t.amber : t.green;
    return (
      <Pressable
        onPress={() => {
          if (!isActive) sound("tap");
          onPress();
        }}
        style={({ pressed }) => [
          s.row,
          amber && !isActive && { backgroundColor: t.amberFaint },
          isActive && [{ backgroundColor: activeBg }, boxGlow(t, activeBg, 0.4)],
          pressed && !isActive && s.pressed,
        ]}
      >
        <View style={s.iconCell}>
          <Ionicons name={icon} size={20} color={fg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { color: fg }]}>{label}</Text>
          <Text style={[s.rowSub, { color: isActive ? fg : amber ? t.amber : t.dim }]} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        {badge !== undefined && (
          <Text
            style={[
              s.badge,
              isActive
                ? { color: activeFg }
                : amber
                  ? { backgroundColor: t.amber, color: t.bg, fontWeight: "700" }
                  : { backgroundColor: t.faint, color: t.dim },
            ]}
          >
            {badge}
          </Text>
        )}
      </Pressable>
    );
  }

  // A small square tile, for the less used screens
  function Tile({ icon, label, path }: { icon: IconName; label: string; path: string }) {
    const isActive = path === active;
    const fg = isActive ? activeFg : t.green;
    return (
      <Pressable
        onPress={() => {
          if (!isActive) sound("tap");
          open(path)();
        }}
        style={({ pressed }) => [s.tile, isActive && { backgroundColor: activeBg }, pressed && !isActive && s.pressed]}
      >
        <Ionicons name={icon} size={18} color={fg} />
        <Text style={[s.tileLabel, { color: fg }]}>{label}</Text>
      </Pressable>
    );
  }

  const daily = dailyChallenge();
  const courseActive = active === "/courses";
  const profileActive = active === "/profile";
  const settingsActive = active === "/settings";

  return (
    <View style={{ flex: 1, gap: 8 }}>
      {/* 52 px a row, like the rail's 44 px buttons with their 8 px gaps, so every icon sits where it was on the rail */}
      <View>
      <Row icon="radio-button-on" label="Learn" sub="Chapters & lessons" path="/" onPress={onLearn} badge={`${stats.percent}%`} />
      {course.hasPractice && (
        <Row
          icon="terminal"
          label="Practice"
          sub="Quick practice & challenges"
          path="/practice"
          onPress={open("/practice")}
          badge={`${stats.solved}/${stats.challenges}`}
        />
      )}
      {daily && (
        <Row
          icon="sunny-outline"
          label="Daily"
          sub={stats.dailyNew ? "Today's challenge" : "✓ Solved today"}
          path="/daily"
          onPress={open("/daily")}
          badge={stats.dailyNew ? "NEW" : undefined}
          amber={stats.dailyNew}
        />
      )}
      <Row icon="book-outline" label="Reference" sub="Cheat sheet" path="/reference" onPress={open("/reference")} />
      <Row icon="code-slash-outline" label="Sandbox" sub="Write and save anything" path="/sandbox" onPress={open("/sandbox")} />
      </View>

      <View style={s.divider} />
      <View style={s.tiles}>
        <Tile icon="podium-outline" label="Leaderboards" path="/leaderboard" />
        <Tile icon="people-outline" label="Community" path="/community" />
      </View>

      {/* The course: how far you are, and the way to another one */}
      <Pressable
        onPress={() => {
          sound("tap");
          open("/courses")();
        }}
        style={({ pressed }) => [s.courseCard, courseActive && { borderColor: t.green }, pressed && s.pressed]}
      >
        <View style={s.courseTop}>
          <Text style={s.courseTitle}>
            {course.title.toUpperCase()} · {course.year}
          </Text>
          <Text style={s.courseChange}>Change ›</Text>
        </View>
        <SmoothBar value={stats.percent} total={100} height={6} />
      </Pressable>

      {/* You: profile and settings */}
      <View style={s.youRow}>
        <Pressable
          onPress={() => {
            sound("tap");
            open("/profile")();
          }}
          accessibilityLabel="Profile"
          style={({ pressed }) => [s.youButton, pressed && s.pressed]}
        >
          <View style={[s.avatar, profileActive && { backgroundColor: activeBg }]}>
            {stats.name ? (
              <Text style={[s.avatarText, profileActive && { color: activeFg }]}>{initials(stats.name)}</Text>
            ) : (
              <Ionicons name="person-outline" size={18} color={profileActive ? activeFg : t.green} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.youName} numberOfLines={1}>
              {stats.name || "Profile"}
            </Text>
            <Text style={s.youSub} numberOfLines={1}>
              {stats.xp} XP · {stats.streak} day streak
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            sound("tap");
            open("/settings")();
          }}
          accessibilityLabel="Settings"
          style={({ pressed }) => [s.roundButton, settingsActive && { backgroundColor: activeBg }, pressed && s.pressed]}
        >
          <Ionicons name="settings-outline" size={18} color={settingsActive ? activeFg : t.dim} />
        </Pressable>
      </View>
    </View>
  );
}

// The menu as a fixed sidebar, for a big computer window
export function Sidebar() {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const pathname = usePathname();
  const led = t.button === "key";
  const stats = useMenuStats(pathname);
  // Which entry is lit: the screen you're on (lessons, quests and chapters count as "Learn")
  const top = "/" + (pathname.split("/")[1] ?? "");
  const known = ["/practice", "/daily", "/reference", "/sandbox", "/profile", "/leaderboard", "/community", "/courses", "/settings"];
  const active = known.includes(top) ? top : "/";
  const open = (path: string) => () => {
    if (path !== pathname) router.replace(path as never);
  };
  return (
    <View style={s.sidebar}>
      <Text style={s.label}>MENU</Text>
      <Text style={[s.title, glow, { marginTop: 6, marginBottom: 12 }]}>{led ? "▌KIM-1 MONITOR" : "> MAIN MENU_"}</Text>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <MenuList open={open} onLearn={open("/")} active={active} stats={stats} />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const r = softRadius(t);
  const round = Math.min(22, r); // 44 px buttons: a circle on the terminal, a rounded square on COBOL
  return StyleSheet.create({
    backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.6)" },
    panel: {
      position: "absolute",
      left: 10,
      width: WIDTH,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: r + 4,
      paddingTop: 8,
      paddingBottom: 10,
      paddingLeft: 5,
      paddingRight: 10,
      shadowColor: "#000",
      shadowOpacity: 0.5,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 16 },
      elevation: 16,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 12 },
    roundButton: { width: 44, height: 44, borderRadius: round, backgroundColor: t.faint, alignItems: "center", justifyContent: "center" },
    label: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.6 },
    title: { fontFamily: t.mono, fontSize: 15, fontWeight: "700", color: t.green },
    headerDivider: { height: 1, backgroundColor: t.line, marginTop: 8, marginBottom: 4, marginLeft: 10, marginRight: 6 },
    divider: { height: 1, backgroundColor: t.line, marginVertical: 4, marginLeft: 10, marginRight: 6 },
    pressed: { backgroundColor: t.faint },

    row: { flexDirection: "row", alignItems: "center", gap: 10, height: 52, paddingRight: 12, borderRadius: Math.min(26, r + 4) },
    iconCell: { width: 44, alignItems: "center" },
    rowLabel: { fontFamily: t.mono, fontSize: 14, fontWeight: "700" },
    rowSub: { fontFamily: t.mono, fontSize: 10, marginTop: 2 },
    badge: { fontFamily: t.mono, fontSize: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },

    tiles: { flexDirection: "row", gap: 8, paddingLeft: 5 },
    tile: { flex: 1, backgroundColor: t.faint, borderRadius: r - 4 > 6 ? r - 4 : 6, padding: 12, gap: 6 },
    tileLabel: { fontFamily: t.mono, fontSize: 12, fontWeight: "700" },

    courseCard: { marginTop: "auto", marginLeft: 5, backgroundColor: t.faint, borderWidth: 1, borderColor: "transparent", borderRadius: r - 2, padding: 12, gap: 8 },
    courseTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    courseTitle: { fontFamily: t.mono, fontSize: 12, fontWeight: "700", color: t.green },
    courseChange: { fontFamily: t.mono, fontSize: 11, color: t.dim },

    youRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
    youButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: round, paddingRight: 6 },
    avatar: { width: 44, height: 44, borderRadius: round, borderWidth: 1.5, borderColor: t.green, backgroundColor: t.faint, alignItems: "center", justifyContent: "center" },
    avatarText: { fontFamily: t.mono, fontSize: 12, fontWeight: "700", color: t.green },
    youName: { fontFamily: t.mono, fontSize: 13, fontWeight: "700", color: t.green },
    youSub: { fontFamily: t.mono, fontSize: 10, color: t.dim, marginTop: 2 },

    sidebar: { width: 270, backgroundColor: t.deep, borderRightWidth: 1.5, borderRightColor: t.line, paddingLeft: 9, paddingRight: 14, paddingTop: 22, paddingBottom: 14 },
  });
});
