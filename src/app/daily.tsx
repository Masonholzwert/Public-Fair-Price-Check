import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DailyResult,
  dailyBonus,
  dailyChallenge,
  dailyDay,
  dailyKey,
  dailyStreak,
  fetchDailyBoard,
  formatTime,
  timeUntilNext,
} from "../../lib/daily";
import { courseById } from "../../lib/courses";
import { difficultyStars } from "../../lib/practice";
import { Progress, loadAdminMode, loadProgress } from "../../lib/progress";
import { go, goBack } from "../../sounds";
import { TermButton, makeStyles, useGlow, useTheme } from "../../theme";

// Today's daily challenge: the same one for everybody, with a clock and a leaderboard
// The screen, with the rail on its left on phones
export default function DailyScreen() {
  return (
    <WithRail path="/daily">
      <DailyScreenContent />
    </WithRail>
  );
}

function DailyScreenContent() {
  const theme = useTheme();
  const styles = useStyles();
  const glow = useGlow();
  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [admin, setAdmin] = useState(false);
  const [board, setBoard] = useState<{ rows: DailyResult[]; me: string | null; error: string | null } | null>(null);
  // Admin: look at other days' challenges (0 = today)
  const [offset, setOffset] = useState(0);
  const dayAt = (o: number) => dailyDay(new Date(Date.now() + o * 86400000));
  const realDay = dailyDay();
  const preview = admin && offset !== 0;
  const day = preview ? dayAt(offset) : realDay;
  const today = dailyChallenge(day);

  const load = useCallback(() => {
    loadProgress().then(setProgress);
    loadAdminMode().then(setAdmin);
    fetchDailyBoard(day).then(setBoard);
  }, [day]);
  useFocusEffect(load);

  const solved = !!progress.done[dailyKey(day)];
  const streak = dailyStreak(progress, day);
  const myRow = board?.rows.find((r) => r.user_id === board.me);
  const original = today?.challenge.from ? courseById(today.challenge.from) : undefined;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={styles.back}>‹ BACK</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: 20 }]}>☀ DAILY CHALLENGE · {day}</Text>
        {preview && (
          <Text style={[styles.label, { color: theme.amber, marginTop: 4 }]}>
            ADMIN PREVIEW · {offset > 0 ? `${offset} DAY${offset === 1 ? "" : "S"} AHEAD` : `${-offset} DAY${offset === -1 ? "" : "S"} AGO`}
          </Text>
        )}
        <Text style={[styles.title, glow]}>Today's Challenge</Text>
        <Text style={styles.subtitle}>
          One challenge a day, the same for everybody. The courses take turns. The clock starts when you open it.
        </Text>

        {/* Daily streak */}
        <View style={styles.streakRow}>
          <View style={styles.streakBox}>
            <Text style={[styles.big, glow]}>{streak}</Text>
            <Text style={styles.label}>DAILY STREAK</Text>
          </View>
          <View style={styles.streakBox}>
            <Text style={[styles.big, glow]}>+{solved ? progress.done[dailyKey(day)].xp : dailyBonus(streak)}</Text>
            <Text style={styles.label}>{solved ? "BONUS EARNED" : "TODAY'S BONUS XP"}</Text>
          </View>
        </View>

        {/* Today's challenge */}
        {today ? (
          <View style={[styles.card, solved && styles.cardDone]}>
            <Text style={styles.label}>
              {today.course.title.toUpperCase()} ({today.course.year})
              {original ? ` · TRANSLATE FROM ${original.title.toUpperCase()}` : ""} · {difficultyStars(today.challenge.difficulty)}
            </Text>
            <Text style={[styles.cardTitle, glow]}>{today.challenge.title}</Text>
            <Text style={styles.cardText} numberOfLines={4}>
              {today.challenge.task}
            </Text>
            {preview ? (
              <TermButton label="OPEN · PREVIEW, NO CLOCK" onPress={() => go(`/quest/${today.challenge.id}`)} />
            ) : solved ? (
              <>
                <Text style={[styles.cardText, { color: theme.green, opacity: 1 }]}>
                  ✓ Solved{myRow ? ` in ${formatTime(myRow.seconds)} · ${myRow.runs} run${myRow.runs === 1 ? "" : "s"}` : ""}
                </Text>
                <TermButton label="OPEN AGAIN" onPress={() => go(`/quest/${today.challenge.id}`)} />
              </>
            ) : (
              <TermButton label="START · CLOCK RUNS" onPress={() => go(`/quest/${today.challenge.id}?daily=${day}`)} />
            )}
          </View>
        ) : (
          <Text style={styles.subtitle}>No challenge today.</Text>
        )}
        <Text style={[styles.label, { marginTop: 10 }]}>NEXT CHALLENGE IN {timeUntilNext()}</Text>

        {/* Admin: jump to the other courses' days */}
        {admin && (
          <View style={styles.adminBox}>
            <Text style={[styles.label, { color: theme.amber }]}>ADMIN · OTHER DAYS</Text>
            <View style={styles.chipRow}>
              {[0, 1, 2, 3].map((o) => {
                const c = dailyChallenge(dayAt(o));
                if (!c) return null;
                const active = offset === o;
                return (
                  <Pressable key={o} onPress={() => setOffset(o)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && { color: theme.bg }]}>
                      {o === 0 ? "TODAY · " : ""}
                      {c.course.title.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.chipRow}>
              <Pressable onPress={() => setOffset((o) => o - 1)} style={styles.chip}>
                <Text style={styles.chipText}>‹ DAY BEFORE</Text>
              </Pressable>
              <Pressable onPress={() => setOffset((o) => o + 1)} style={styles.chip}>
                <Text style={styles.chipText}>NEXT DAY ›</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Leaderboard */}
        <View style={styles.boardHeader}>
          <Text style={styles.label}>{preview ? day : "TODAY'S"} FASTEST · {board?.rows.length ?? 0} SOLVED</Text>
          <Pressable onPress={load} hitSlop={12}>
            <Ionicons name="refresh" size={16} color={theme.dim} />
          </Pressable>
        </View>
        {board?.error && <Text style={styles.cardText}>{board.error}</Text>}
        {board && !board.error && board.rows.length === 0 && (
          <Text style={styles.cardText}>Nobody has solved today's challenge yet. Be the first!</Text>
        )}
        {board?.rows.map((r, i) => (
          <View key={r.user_id} style={[styles.row, r.user_id === board.me && styles.rowMe]}>
            <Text style={[styles.rank, i < 3 && glow]}>{i + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {r.nickname}
              {r.user_id === board.me ? " (YOU)" : ""}
            </Text>
            <Text style={styles.meta}>
              {r.runs} run{r.runs === 1 ? "" : "s"}
              {r.hints > 0 ? ` · ${r.hints} hint${r.hints === 1 ? "" : "s"}` : ""}
            </Text>
            <Text style={[styles.time, glow]}>{formatTime(r.seconds)}</Text>
          </View>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    content: { padding: 20, paddingBottom: 60 },
    back: { fontFamily: theme.mono, fontSize: 13, color: theme.dim, letterSpacing: 1 },
    label: { fontFamily: theme.mono, fontSize: 11, color: theme.dim, letterSpacing: 1.5 },
    title: { fontFamily: theme.mono, fontSize: 26, fontWeight: "700", color: theme.green, marginTop: 6 },
    subtitle: { fontFamily: theme.mono, fontSize: 14, lineHeight: 22, color: theme.green, opacity: 0.75, marginTop: 8 },
    streakRow: { flexDirection: "row", gap: 12, marginTop: 20 },
    streakBox: {
      flex: 1,
      borderWidth: 1.5,
      borderColor: theme.line,
      borderRadius: theme.radius,
      padding: 14,
      gap: 4,
      backgroundColor: theme.surface,
    },
    big: { fontFamily: theme.mono, fontSize: 26, fontWeight: "700", color: theme.green },
    card: {
      marginTop: 16,
      borderWidth: 1.5,
      borderColor: theme.green,
      borderRadius: theme.radius,
      padding: 16,
      gap: 10,
      backgroundColor: theme.faint,
    },
    cardDone: { backgroundColor: theme.doneBg },
    cardTitle: { fontFamily: theme.mono, fontSize: 20, fontWeight: "700", color: theme.green },
    cardText: { fontFamily: theme.mono, fontSize: 13, lineHeight: 20, color: theme.green, opacity: 0.8 },
    adminBox: { marginTop: 24, gap: 10, borderWidth: 1, borderColor: theme.amber, borderRadius: theme.radius, padding: 12 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius, paddingVertical: 6, paddingHorizontal: 10 },
    chipActive: { backgroundColor: theme.amber, borderColor: theme.amber },
    chipText: { fontFamily: theme.mono, fontSize: 11, color: theme.green, letterSpacing: 1 },
    boardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 32,
      paddingBottom: 10,
      marginBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.line,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: theme.radius,
      borderWidth: 1,
      borderColor: theme.line,
      marginBottom: 6,
      backgroundColor: theme.surface,
    },
    rowMe: { borderColor: theme.green, backgroundColor: theme.doneBg },
    rank: { fontFamily: theme.mono, fontSize: 14, fontWeight: "700", color: theme.green, width: 24 },
    name: { fontFamily: theme.mono, fontSize: 14, color: theme.green, flex: 1 },
    meta: { fontFamily: theme.mono, fontSize: 11, color: theme.dim },
    time: { fontFamily: theme.mono, fontSize: 14, fontWeight: "700", color: theme.green, minWidth: 52, textAlign: "right" },
  })
);
