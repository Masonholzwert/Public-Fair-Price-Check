import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../press";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../lib/active-course";
import { courses } from "../../lib/courses";
import { loadPrograms } from "../../lib/sandbox";
import { TimeStats, formatTime, loadAllUsage, timeStats } from "../../lib/usage";
import { Progress, currentStreak, loadProgress } from "../../lib/progress";
import { accuracy, Achievement, ACHIEVEMENT_GROUPS, achievements, badgeDate, courseStats, generalStats, lastDays, loadName, longestStreak, saveName, totalXp, withSeenDates } from "../../lib/stats";
import { saveNickname, syncStats } from "../../lib/online";
import { useSession } from "../../lib/supabase";
import { onSynced } from "../../lib/cloud";
import { SignInButtons } from "../../signin";
import { go, goBack } from "../../sounds";
import { makeStyles, useAmberGlow, useGlow, useTheme } from "../../theme";
import { SmoothBar } from "../../ui";

// Your stats across all courses, in the style of the course you're in
// The screen, with the rail on its left on phones
export default function Profile() {
  return (
    <WithRail path="/profile">
      <ProfileContent />
    </WithRail>
  );
}

function ProfileContent() {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const amberGlow = useAmberGlow();
  const { course: active } = useCourse();
  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [name, setName] = useState("");
  const session = useSession();

  // Load the numbers, and send them to the leaderboards when signed in
  useFocusEffect(
    useCallback(() => {
      // Time in the app and the number of sandbox programs, for the stats
      loadAllUsage().then((u) => setTime(timeStats(u)));
      Promise.all(courses.map((c) => loadPrograms(c.id))).then((lists) => setProgramCount(lists.reduce((sum, l) => sum + l.length, 0)));
      Promise.all([loadProgress(), loadName()]).then(([p, n]) => {
        setProgress(p);
        setName(n);
        if (session) syncStats(p, n);
      });
    }, [session?.user.id])
  );

  // When progress from another device arrives, show it right away
  useEffect(
    () =>
      onSynced(() => {
        loadProgress().then(setProgress);
        loadName().then(setName);
      }),
    []
  );

  const xp = totalXp(progress);
  const streak = currentStreak(progress);
  const best = longestStreak(progress);
  const acc = accuracy(progress);
  const days = lastDays(progress);
  const activeDays = (progress.activeDays ?? []).length;
  // Achievements with the day each one was earned
  const [time, setTime] = useState<TimeStats | null>(null);
  const [programCount, setProgramCount] = useState(0);
  const [dated, setBadges] = useState<Achievement[]>([]);
  const badges = dated.length ? dated : achievements(progress);
  useEffect(() => {
    let live = true;
    withSeenDates(achievements(progress)).then((list) => live && setBadges(list));
    return () => {
      live = false;
    };
  }, [progress]);
  const earned = badges.filter((b) => b.earned).length;
  const stats = courses.filter((c) => c.available).map((c) => courseStats(c, progress));
  const lessonsDone = courses.reduce((sum, c) => sum + courseStats(c, progress).lessonsDone, 0);

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>PROFILE</Text>
        </View>

        {/* Name: tap to change */}
        <View style={s.nameRow}>
          <View style={s.avatar}>
            <Ionicons name="person" size={26} color={t.button === "bracket" ? t.bg : t.keyText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>OPERATOR</Text>
            <TextInput
              value={name}
              onChangeText={(text: string) => setName(text.toUpperCase())}
              onEndEditing={async () => {
                saveName(name.trim());
                if (session) {
                  const error = await saveNickname(name);
                  if (error) Alert.alert("Nickname not changed", error);
                }
              }}
              placeholder="YOUR NAME"
              placeholderTextColor={t.dim}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={16}
              style={[s.name, glow]}
            />
          </View>
        </View>

        {/* Big numbers */}
        <View style={s.tiles}>
          <View style={s.tile}>
            <Text style={[s.tileValue, glow]}>{xp}</Text>
            <Text style={s.tileLabel}>TOTAL XP</Text>
          </View>
          <View style={[s.tile, streak > 0 && { borderColor: t.amber }]}>
            <Text style={[s.tileValue, { color: streak > 0 ? t.amber : t.dim }, streak > 0 && amberGlow]}>{streak}</Text>
            <Text style={s.tileLabel}>DAY STREAK</Text>
          </View>
          <View style={s.tile}>
            <Text style={[s.tileValue, glow]}>{best}</Text>
            <Text style={s.tileLabel}>BEST STREAK</Text>
          </View>
          <View style={s.tile}>
            <Text style={[s.tileValue, glow]}>{acc === null ? "–" : `${acc}%`}</Text>
            <Text style={s.tileLabel}>ACCURACY</Text>
          </View>
        </View>

        {/* Time and lessons: phone and computer together */}
        <Text style={s.section}>TIME & LESSONS</Text>
        <View style={[s.tiles, { marginTop: 0 }]}>
          <View style={s.tile}>
            <Text style={[s.tileValue, glow]}>{time ? formatTime(time.total) : "–"}</Text>
            <Text style={s.tileLabel}>TIME IN TOTAL</Text>
          </View>
          <View style={s.tile}>
            <Text style={[s.tileValue, glow]}>{time ? formatTime(time.perDay) : "–"}</Text>
            <Text style={s.tileLabel}>AVERAGE PER DAY</Text>
          </View>
          <View style={s.tile}>
            <Text style={[s.tileValue, glow]}>{lessonsDone}</Text>
            <Text style={s.tileLabel}>LESSONS DONE</Text>
          </View>
          <View style={s.tile}>
            <Text style={[s.tileValue, glow]}>{time && lessonsDone > 0 ? formatTime(time.total / lessonsDone) : "–"}</Text>
            <Text style={s.tileLabel}>TIME PER LESSON</Text>
          </View>
        </View>
        {time && time.sessions > 0 && (
          <Text style={s.timeNote}>
            TODAY {formatTime(time.today)} · LAST 7 DAYS {formatTime(time.week)} · {time.sessions} SESSION
            {time.sessions === 1 ? "" : "S"} · LONGEST {formatTime(time.longest)}
          </Text>
        )}

        {/* The last 5 weeks */}
        <Text style={s.section}>LAST 5 WEEKS · {activeDays} DAY{activeDays === 1 ? "" : "S"} LEARNED IN TOTAL</Text>
        <View style={s.grid}>
          {days.map((d) => (
            <View key={d.key} style={[s.day, d.active && s.dayOn, d.today && !d.active && s.dayToday]} />
          ))}
        </View>

        {/* Courses */}
        <Text style={s.section}>LANGUAGES</Text>
        {stats.map((st) => {
          const ct = st.course.theme;
          const pct = st.stepsTotal ? Math.round((st.stepsDone / st.stepsTotal) * 100) : 0;
          return (
            <View
              key={st.course.id}
              style={[s.courseCard, { backgroundColor: ct.surface, borderColor: st.course.id === active.id ? ct.amber : ct.line, borderRadius: ct.soft }]}
            >
              <View style={s.courseTop}>
                <Text style={[s.courseTitle, { color: ct.green, fontFamily: ct.mono }]}>{st.course.title}</Text>
                <Text style={[s.courseXp, { color: ct.amber, fontFamily: ct.mono }]}>{st.xp} XP</Text>
              </View>
              <Text style={[s.courseMeta, { color: ct.dim, fontFamily: ct.mono }]}>
                {st.course.year} · {st.lessonsDone} LESSON{st.lessonsDone === 1 ? "" : "S"} · {pct}%
                {time?.courses[st.course.id] ? ` · ${formatTime(time.courses[st.course.id])}` : ""}
              </Text>
              <SmoothBar value={st.stepsDone} total={st.stepsTotal} color={ct.green} />
            </View>
          );
        })}

        {/* Everything counted so far */}
        <Text style={s.section}>STATS</Text>
        <View style={s.statList}>
          {generalStats(progress, programCount).map((line, i) => (
            <View key={line.label} style={[s.statRow, i > 0 && s.statDivider]}>
              <Text style={s.statLabel}>{line.label}</Text>
              <Text style={[s.statValue, glow]}>{line.value}</Text>
            </View>
          ))}
        </View>

        {/* Leaderboards */}
        <Pressable onPress={() => go("/leaderboard")} style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.7 }]}>
          <Ionicons name="podium-outline" size={20} color={t.green} />
          <Text style={s.linkText}>Leaderboards</Text>
          <Ionicons name="chevron-forward" size={16} color={t.dim} />
        </Pressable>

        {/* Achievements */}
        <Text style={s.section}>
          ACHIEVEMENTS · {earned}/{badges.length}
        </Text>
        {ACHIEVEMENT_GROUPS.map((group) => {
          const inGroup = badges.filter((b) => b.group === group);
          return (
            <View key={group}>
              <Text style={s.badgeGroup}>
                {group} · {inGroup.filter((b) => b.earned).length}/{inGroup.length}
              </Text>
        <View style={s.badges}>
          {inGroup.map((b) => (
            <View key={b.id} style={[s.badge, b.earned ? s.badgeOn : s.badgeOff]}>
              <View style={[s.badgeIcon, b.earned && { backgroundColor: t.amber, borderColor: t.amber }]}>
                <Ionicons
                  name={(b.earned ? b.icon : "lock-closed-outline") as keyof typeof Ionicons.glyphMap}
                  size={20}
                  color={b.earned ? t.bg : t.dim}
                />
              </View>
              <Text style={[s.badgeTitle, !b.earned && { color: t.dim }]} numberOfLines={1}>
                {b.title}
              </Text>
              <Text style={s.badgeText} numberOfLines={2}>
                {b.text}
              </Text>
              {!b.earned && b.count && <Text style={s.badgeCount}>{b.count}</Text>}
              {b.earned && b.date && <Text style={s.badgeDate}>{badgeDate(b.date)}</Text>}
            </View>
          ))}
        </View>
            </View>
          );
        })}

        {/* Account */}
        <Text style={s.section}>ACCOUNT</Text>
        {session ? (
          <View style={s.account}>
            <Text style={s.accountText}>On the leaderboards as {name || "PLAYER"}</Text>
            <Text style={s.accountNote}>
              Change the name at the top to change your nickname. Your streak, units and sandbox numbers are sent when you open
              this screen.
            </Text>
            <View style={s.accountButtons}>
              <Pressable onPress={() => go("/settings")} hitSlop={8}>
                <Text style={s.accountAction}>ACCOUNT & SETTINGS ›</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <SignInButtons why="Join the leaderboards and share your sandbox programs. Learning works without joining too." />
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 20, paddingBottom: 60 },
    topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    close: { fontSize: 20, color: t.dim },
    label: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.6 },
    section: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.6, marginTop: 28, marginBottom: 10 },

    nameRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 18 },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: t.button === "bracket" ? 28 : t.soft,
      backgroundColor: t.button === "bracket" ? t.green : t.keyFace,
      alignItems: "center",
      justifyContent: "center",
    },
    name: { fontFamily: t.mono, fontSize: 22, fontWeight: "700", color: t.green, paddingVertical: 2 },

    tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 20 },
    tile: {
      width: "47%",
      flexGrow: 1,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      paddingVertical: 14,
      alignItems: "center",
      gap: 4,
    },
    tileValue: { fontFamily: t.mono, fontSize: 26, fontWeight: "700", color: t.green },
    tileLabel: { fontFamily: t.mono, fontSize: 9, color: t.dim, letterSpacing: 1.5 },

    timeNote: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1, marginTop: 10, lineHeight: 15 },
    statList: { backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: t.soft, paddingHorizontal: 14 },
    statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, gap: 12 },
    statDivider: { borderTopWidth: 1, borderTopColor: t.line },
    statLabel: { fontFamily: t.mono, fontSize: 12, color: t.dim, flexShrink: 1 },
    statValue: { fontFamily: t.mono, fontSize: 13, fontWeight: "700", color: t.green },

    grid: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
    day: { width: "12.2%", aspectRatio: 1, borderRadius: 4, borderWidth: 1.5, borderColor: t.line, backgroundColor: t.surface },
    dayOn: { backgroundColor: t.amber, borderColor: t.amber },
    dayToday: { borderColor: t.amber, borderStyle: "dashed" },

    courseCard: { borderWidth: 1.5, padding: 14, marginBottom: 10, gap: 6 },
    courseTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    courseTitle: { fontSize: 16, fontWeight: "700" },
    courseXp: { fontSize: 13, fontWeight: "700" },
    courseMeta: { fontSize: 10, letterSpacing: 1.2 },

    linkRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 24,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      padding: 14,
    },
    linkText: { flex: 1, fontFamily: t.mono, fontSize: 15, fontWeight: "700", color: t.green },
    account: { backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: t.soft, padding: 16, gap: 8 },
    accountText: { fontFamily: t.mono, fontSize: 13, fontWeight: "700", color: t.green },
    accountNote: { fontFamily: t.mono, fontSize: 11, lineHeight: 16, color: t.dim },
    accountButtons: { flexDirection: "row", gap: 22, marginTop: 6 },
    accountAction: { fontFamily: t.mono, fontSize: 11, letterSpacing: 1, fontWeight: "700", color: t.green },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    badge: { width: "31%", flexGrow: 1, alignItems: "center", padding: 10, borderRadius: t.soft, borderWidth: 1.5, gap: 4 },
    badgeOn: { backgroundColor: t.amberFaint, borderColor: t.amber },
    badgeOff: { backgroundColor: t.surface, borderColor: t.line, opacity: 0.7 },
    badgeIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: t.line, alignItems: "center", justifyContent: "center" },
    badgeTitle: { fontFamily: t.mono, fontSize: 11, fontWeight: "700", color: t.green, textAlign: "center" },
    badgeGroup: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.5, marginTop: 14, marginBottom: 8 },
    badgeDate: { fontFamily: t.mono, fontSize: 9, fontWeight: "700", color: t.amber, marginTop: 2, letterSpacing: 0.5 },
    badgeCount: { fontFamily: t.mono, fontSize: 10, fontWeight: "700", color: t.amber, marginTop: 2 },
    badgeText: { fontFamily: t.mono, fontSize: 9, lineHeight: 12, color: t.dim, textAlign: "center" },
  })
);
