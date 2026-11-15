import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../press";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../lib/active-course";
import type { RunResult } from "../../lib/course";
import { SharedProgram, blockUser, deleteShared, fetchShared, myLikes, reportProgram, setLike } from "../../lib/online";
import { loadPrograms, newId, savePrograms } from "../../lib/sandbox";
import { useSession } from "../../lib/supabase";
import { MachinePanel } from "../../led";
import { SignInButtons } from "../../signin";
import { goBack, sound } from "../../sounds";
import { TermButton, makeStyles, useGlow, useTheme } from "../../theme";

// Programs other players shared from their sandbox, for the language you're learning
// The screen, with the rail on its left on phones
export default function Community() {
  return (
    <WithRail path="/community">
      <CommunityContent />
    </WithRail>
  );
}

function CommunityContent() {
  const { course } = useCourse();
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const session = useSession();
  const [sort, setSort] = useState<"top" | "new">("top");
  const [rows, setRows] = useState<SharedProgram[]>([]);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const load = useCallback(async () => {
    const res = await fetchShared(course.id, sort);
    setRows(res.rows);
    setError(res.error);
    setLiked(await myLikes());
  }, [course.id, sort, session?.user.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function toggleLike(p: SharedProgram) {
    if (!session) return Alert.alert("Join first", "Pick a nickname on this screen or in your profile to like programs.");
    const on = !liked.has(p.id);
    sound(on ? "correct" : "tap");
    const next = new Set(liked);
    if (on) next.add(p.id);
    else next.delete(p.id);
    setLiked(next);
    setRows((list) => list.map((r) => (r.id === p.id ? { ...r, likes: r.likes + (on ? 1 : -1) } : r)));
    setLike(p.id, on);
  }

  // Copy it into your own sandbox, then open the sandbox
  async function openInSandbox(p: SharedProgram) {
    sound("open");
    const mine = await loadPrograms(course.id);
    const copy = { id: newId(), name: p.name.slice(0, 24), code: p.code, input: "", updated: new Date().toISOString() };
    await savePrograms(course.id, [copy, ...mine]);
    router.push("/sandbox");
  }

  function report(p: SharedProgram) {
    if (!session) return Alert.alert("Join first", "Pick a nickname to report programs.");
    Alert.alert("Report this program?", "If several players report it, it's hidden for everyone until it's checked.", [
      { text: "Cancel", style: "cancel" },
      { text: "Offensive", onPress: () => reportProgram(p.id, "offensive").then(load) },
      { text: "Spam", onPress: () => reportProgram(p.id, "spam").then(load) },
    ]);
  }

  function block(p: SharedProgram) {
    Alert.alert(`Block ${p.nickname}?`, "You won't see their programs any more.", [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: () => blockUser(p.user_id).then(load) },
    ]);
  }

  function remove(p: SharedProgram) {
    Alert.alert("Delete your shared program?", `"${p.name}" will be removed for everyone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteShared(p.id).then(load) },
    ]);
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>COMMUNITY · {course.title.toUpperCase()}</Text>
        </View>
        <Text style={[s.title, glow]}>Shared Programs</Text>
        <Text style={s.note}>Programs other players wrote in their sandbox. Share your own with SHARE in the sandbox.</Text>

        <View style={s.tabs}>
          {(["top", "new"] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => {
                sound("tap");
                setSort(k);
              }}
              style={[s.tab, sort === k && s.tabOn]}
            >
              <Text style={[s.tabText, sort === k && { color: t.button === "bracket" ? t.bg : t.keyText }]}>
                {k === "top" ? "MOST LIKED" : "NEWEST"}
              </Text>
            </Pressable>
          ))}
        </View>

        {!session && (
          <View style={{ marginTop: 14 }}>
            <SignInButtons why="Join to like, share and report programs. You can browse and run them without joining." />
          </View>
        )}
        {error && <Text style={[s.note, { color: t.red }]}>{error}</Text>}
        {!error && rows.length === 0 && <Text style={s.note}>No shared {course.title} programs yet. Be the first!</Text>}

        {rows.map((p) => {
          const open = openId === p.id;
          const mine = p.user_id === session?.user.id;
          return (
            <View key={p.id} style={[s.card, open && { borderColor: t.amber }]}>
              <Pressable
                onPress={() => {
                  sound("tap");
                  setOpenId(open ? null : p.id);
                  setResult(null);
                }}
                style={s.cardTop}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{p.name}</Text>
                  <Text style={s.by}>
                    by {p.nickname} · {p.code.split("\n").filter((l) => l.trim()).length} lines
                  </Text>
                </View>
                <Pressable onPress={() => toggleLike(p)} hitSlop={10} style={s.likeBox}>
                  <Ionicons name={liked.has(p.id) ? "heart" : "heart-outline"} size={20} color={liked.has(p.id) ? t.red : t.dim} />
                  <Text style={s.likeCount}>{p.likes}</Text>
                </Pressable>
              </Pressable>

              {open && (
                <View style={{ gap: 10, marginTop: 10 }}>
                  <View style={s.codeBox}>
                    <Text style={s.code}>{p.code}</Text>
                  </View>
                  {result && (
                    <View style={s.codeBox}>
                      {result.output !== "" && <Text style={s.code}>{result.output.replace(/\n$/, "")}</Text>}
                      {result.error && <Text style={[s.code, { color: t.red }]}>{result.error}</Text>}
                      {!result.error && result.output === "" && !result.machine && <Text style={s.by}>(NO OUTPUT)</Text>}
                    </View>
                  )}
                  {result?.machine && <MachinePanel machine={result.machine} />}
                  <View style={s.buttons}>
                    <View style={{ flex: 1 }}>
                      <TermButton
                        label="RUN"
                        onPress={() => {
                          sound("run");
                          setResult(course.run(p.code, []));
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TermButton label="EDIT A COPY" color={t.dim} onPress={() => openInSandbox(p)} />
                    </View>
                  </View>
                  <View style={s.smallActions}>
                    {mine ? (
                      <Pressable onPress={() => remove(p)} hitSlop={8}>
                        <Text style={[s.action, { color: t.red }]}>DELETE MY PROGRAM</Text>
                      </Pressable>
                    ) : (
                      <>
                        <Pressable onPress={() => report(p)} hitSlop={8}>
                          <Text style={s.action}>REPORT</Text>
                        </Pressable>
                        <Pressable onPress={() => block(p)} hitSlop={8}>
                          <Text style={s.action}>BLOCK {p.nickname}</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 20, paddingBottom: 60, gap: 8 },
    topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    close: { fontSize: 20, color: t.dim },
    label: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.6 },
    title: { fontFamily: t.mono, fontSize: 24, fontWeight: "700", color: t.green, marginTop: 14 },
    note: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.dim, marginTop: 6 },
    tabs: { flexDirection: "row", gap: 6, marginTop: 10, marginBottom: 6 },
    tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: t.soft, borderWidth: 1.5, borderColor: t.line },
    tabOn: { backgroundColor: t.button === "bracket" ? t.green : t.keyFace, borderColor: t.button === "bracket" ? t.green : t.keyFace },
    tabText: { fontFamily: t.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1, color: t.green },
    card: { backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: t.soft, padding: 12 },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: { fontFamily: t.mono, fontSize: 15, fontWeight: "700", color: t.green },
    by: { fontFamily: t.mono, fontSize: 10, color: t.dim, marginTop: 2 },
    likeBox: { alignItems: "center", minWidth: 36 },
    likeCount: { fontFamily: t.mono, fontSize: 11, color: t.dim },
    codeBox: { backgroundColor: t.bg, borderRadius: t.soft, borderWidth: 1, borderColor: t.line, padding: 10 },
    code: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green },
    buttons: { flexDirection: "row", gap: 8 },
    smallActions: { flexDirection: "row", gap: 18, justifyContent: "flex-end" },
    action: { fontFamily: t.mono, fontSize: 10, letterSpacing: 1, color: t.dim },
  })
);
