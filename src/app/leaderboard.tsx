import { useFocusEffect } from "expo-router";
import { WithRail } from "../../rail";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { Board, BoardRow, fetchBoard, syncStats } from "../../lib/online";
import { loadProgress } from "../../lib/progress";
import { loadName } from "../../lib/stats";
import { useSession } from "../../lib/supabase";
import { SignInButtons } from "../../signin";
import { goBack, sound } from "../../sounds";
import { makeStyles, useAmberGlow, useGlow, useTheme } from "../../theme";

const BOARDS: { id: Board; label: string; title: string; value: (r: BoardRow) => string; sub: (r: BoardRow) => string }[] = [
  { id: "current_streak", label: "STREAK", title: "Daily Streak", value: (r) => `${r.current_streak}`, sub: (r) => `best ${r.best_streak}` },
  { id: "units_done", label: "UNITS", title: "Units Done", value: (r) => `${r.units_done}`, sub: () => "all languages" },
  { id: "programs", label: "SANDBOX", title: "Programs Written", value: (r) => `${r.programs}`, sub: (r) => `${r.program_lines} lines` },
  { id: "likes", label: "SHARED", title: "Likes on Shared Programs", value: (r) => `${r.likes}`, sub: () => "likes" },
];

// The screen, with the rail on its left on phones
export default function Leaderboard() {
  return (
    <WithRail path="/leaderboard">
      <LeaderboardContent />
    </WithRail>
  );
}

function LeaderboardContent() {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const amberGlow = useAmberGlow();
  const session = useSession();
  const [board, setBoard] = useState<Board>("current_streak");
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const info = BOARDS.find((b) => b.id === board)!;

  // Send your newest numbers first, then load the board
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        if (session) await syncStats(await loadProgress(), await loadName());
        const result = await fetchBoard(board);
        if (!alive) return;
        setRows(result.rows);
        setError(result.error);
        setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [board, session?.user.id])
  );

  const myRank = rows.findIndex((r) => r.user_id === session?.user.id);

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>LEADERBOARDS</Text>
        </View>
        <Text style={[s.title, glow]}>{info.title}</Text>

        <View style={s.tabs}>
          {BOARDS.map((b) => {
            const on = b.id === board;
            return (
              <Pressable
                key={b.id}
                onPress={() => {
                  sound("tap");
                  setBoard(b.id);
                }}
                style={[s.tab, on && s.tabOn]}
              >
                <Text style={[s.tabText, on && { color: t.button === "bracket" ? t.bg : t.keyText }]}>{b.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {!session && (
          <View style={{ marginTop: 16 }}>
            <SignInButtons why="Pick a nickname to put yourself on the leaderboards. You can look without joining." />
          </View>
        )}

        {session && myRank >= 0 && (
          <Text style={[s.myRank, amberGlow]}>
            YOU ARE #{myRank + 1} OF {rows.length}
          </Text>
        )}

        {loading && rows.length === 0 && <Text style={s.note}>Loading …</Text>}
        {error && <Text style={[s.note, { color: t.red }]}>{error}</Text>}
        {!loading && !error && rows.length === 0 && <Text style={s.note}>Nobody here yet. Be the first!</Text>}

        <View style={{ marginTop: 14, gap: 6 }}>
          {rows.map((r, i) => {
            const me = r.user_id === session?.user.id;
            const medal = i < 3;
            return (
              <View key={r.user_id} style={[s.row, me && s.rowMe]}>
                <Text style={[s.rank, medal && { color: t.amber }]}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>
                    {r.nickname}
                    {me ? "  (YOU)" : ""}
                  </Text>
                  <Text style={s.sub}>{info.sub(r)}</Text>
                </View>
                <Text style={[s.value, medal && { color: t.amber }]}>{info.value(r)}</Text>
              </View>
            );
          })}
        </View>
        <Text style={[s.note, { marginTop: 16 }]}>Top 50 players. Numbers update whenever someone opens their profile or this screen.</Text>
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
    title: { fontFamily: t.mono, fontSize: 24, fontWeight: "700", color: t.green, marginTop: 14 },
    tabs: { flexDirection: "row", gap: 6, marginTop: 14 },
    tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: t.soft, borderWidth: 1.5, borderColor: t.line },
    tabOn: { backgroundColor: t.button === "bracket" ? t.green : t.keyFace, borderColor: t.button === "bracket" ? t.green : t.keyFace },
    tabText: { fontFamily: t.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1, color: t.green },
    myRank: { fontFamily: t.mono, fontSize: 13, fontWeight: "700", color: t.amber, marginTop: 16, letterSpacing: 1.5 },
    note: { fontFamily: t.mono, fontSize: 12, color: t.dim, marginTop: 14 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    rowMe: { borderColor: t.amber, backgroundColor: t.amberFaint },
    rank: { fontFamily: t.mono, fontSize: 16, fontWeight: "700", color: t.dim, width: 28, textAlign: "right" },
    name: { fontFamily: t.mono, fontSize: 14, fontWeight: "700", color: t.green },
    sub: { fontFamily: t.mono, fontSize: 10, color: t.dim, marginTop: 2 },
    value: { fontFamily: t.mono, fontSize: 20, fontWeight: "700", color: t.green },
  })
);
