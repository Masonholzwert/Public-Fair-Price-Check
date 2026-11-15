import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../lib/active-course";
import { isUnitUnlocked } from "../../lib/course";
import { loadAdminMode, loadProgress } from "../../lib/progress";
import { ASCII_CHARS, RefEntry, referenceTabs } from "../../lib/reference";
import { goBack, sound } from "../../sounds";
import { makeStyles, useGlow, useTheme } from "../../theme";

// Red seven-segment look for 6502 instruction names and the ASCII display
const LED_ON = "#FF3B2F";
const LED_GLOW = { textShadowColor: "rgba(255, 59, 47, 0.7)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 };

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

// The screen, with the rail on its left on phones
export default function ReferenceScreen() {
  return (
    <WithRail path="/reference">
      <ReferenceScreenContent />
    </WithRail>
  );
}

function ReferenceScreenContent() {
  const { course } = useCourse();
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const led = t.button === "key"; // the circuit board look

  const tabs = referenceTabs[course.id] ?? [];
  const [tabId, setTabId] = useState(tabs[0]?.id ?? "");
  const tab = tabs.find((x) => x.id === tabId) ?? tabs[0];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);
  const [asciiChar, setAsciiChar] = useState("A");

  // Which units are open: their entries are unlocked
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      Promise.all([loadProgress(), loadAdminMode()]).then(([progress, admin]) => {
        const units = new Set<string>();
        course.chapters.forEach((chapter, ci) => {
          const chapterOpen = course.isChapterUnlocked(ci, progress.done, admin);
          chapter.units.forEach((unit, ui) => {
            if (!unit.comingSoon && isUnitUnlocked(chapter, ui, chapterOpen, progress.done, admin)) units.add(unit.id);
          });
        });
        setOpenUnits(units);
      });
    }, [course.id])
  );
  const unlocked = (e: RefEntry) => e.unit === null || openUnits.has(e.unit);

  // Search and category filter, then group by category
  const groups = useMemo(() => {
    if (!tab) return [];
    const q = query.trim().toLowerCase();
    const list = tab.entries.filter(
      (e) =>
        (!category || e.category === category) &&
        (!q || [e.name, e.long, e.short, e.text].some((field) => field?.toLowerCase().includes(q)))
    );
    const byCategory = new Map<string, RefEntry[]>();
    list.forEach((e) => byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e]));
    return [...byCategory.entries()];
  }, [tab, query, category]);
  const categories = useMemo(() => [...new Set((tab?.entries ?? []).map((e) => e.category))], [tab]);

  function switchTab(id: string) {
    sound("tap");
    setTabId(id);
    setQuery("");
    setCategory(null);
    setOpenName(null);
  }

  function toggle(e: RefEntry) {
    if (!unlocked(e)) return;
    sound("tap");
    setOpenName((name) => (name === e.name ? null : e.name));
  }

  // The name of an entry: red LED letters on the board, bold terminal text for BASIC
  function Name({ e, dim }: { e: RefEntry; dim?: boolean }) {
    if (led) {
      return (
        <View style={s.ledBadge}>
          <Text style={[s.ledName, dim ? { color: "#7A1E17" } : LED_GLOW]}>{e.name}</Text>
        </View>
      );
    }
    return <Text style={[s.name, dim && { color: t.dim }]}>{e.name}</Text>;
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {/* Top bar */}
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>REFERENCE · {course.title.toUpperCase()}</Text>
        </View>
        <Text style={[s.title, glow]}>{tab?.title ?? "Reference"}</Text>

        {/* Tabs (6502 has several) */}
        {tabs.length > 1 && (
          <View style={s.tabs}>
            {tabs.map((x) => {
              const active = x.id === tab?.id;
              return (
                <Pressable key={x.id} onPress={() => switchTab(x.id)} style={[s.tab, active ? s.tabOn : s.tabOff]}>
                  <Text style={[s.tabText, { color: active ? (led ? t.keyText : t.bg) : led ? "#FFF6EE" : t.green }]}>
                    {x.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Search and categories */}
        {tab?.search && (
          <>
            <View style={s.search}>
              <Ionicons name="search" size={15} color={t.dim} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={course.id === "6502" ? "LDA, carry, branch …" : course.id === "cobol" ? 'Search "PIC", "MOVE" …' : course.id === "pascal" ? 'Search "readln", "div" …' : course.id === "altair" ? 'Search "MVI", "octal" …' : 'Search "FOR", "GOSUB" …'}
                placeholderTextColor={t.dim}
                autoCapitalize="none"
                autoCorrect={false}
                style={s.searchInput}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {[null, ...categories].map((c) => {
                const active = category === c;
                return (
                  <Pressable key={c ?? "all"} onPress={() => setCategory(c)} style={[s.chip, active && s.chipOn]}>
                    <Text style={[s.chipText, active && { color: t.bg }]}>
                      {(c ?? "ALL").replace(" (NOT IN THE LESSONS)", "")}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* ASCII table */}
        {tab?.id === "ascii" ? (
          <>
            <Text style={[s.label, { marginTop: 18 }]}>TAP A CHARACTER TO SEE ITS CODE</Text>
            <View style={s.asciiGrid}>
              {ASCII_CHARS.map((ch) => {
                const active = ch === asciiChar;
                return (
                  <Pressable
                    key={ch}
                    onPress={() => {
                      sound("tap");
                      setAsciiChar(ch);
                    }}
                    style={[s.asciiCell, active && { backgroundColor: t.amber }]}
                  >
                    <Text style={[s.asciiChar, active && { color: t.keyText }]}>{ch === " " ? "␠" : ch}</Text>
                    <Text style={[s.asciiCode, active && { color: t.keyText }]}>${hex(ch.charCodeAt(0))}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={s.asciiPanel}>
              <View style={s.ledGlass}>
                <Text style={[s.ledBig, LED_GLOW]}>{hex(asciiChar.charCodeAt(0))}</Text>
              </View>
              <Text style={s.asciiInfo}>
                <Text style={{ fontWeight: "700", fontSize: 16 }}>{asciiChar === " " ? "space" : `'${asciiChar}`}</Text>
                {"\n"}= ${hex(asciiChar.charCodeAt(0))} = {asciiChar.charCodeAt(0)}
                {"\n"}= %{asciiChar.charCodeAt(0).toString(2).padStart(8, "0")}
              </Text>
            </View>
            <Text style={[s.label, { marginTop: 18 }]}>GOOD TO KNOW</Text>
            <Text style={s.note}>
              '0–'9 = $30–$39 · ADC #'0 turns 0–9 into a digit{"\n"}'A–'Z = $41–$5A · small letters are $20 higher{"\n"}13 = new line · $20 = space · 0 marks the end of a message
            </Text>
          </>
        ) : (
          groups.map(([cat, entries]) => (
            <View key={cat}>
              <Text style={[s.label, { marginTop: 20, marginBottom: 8 }]}>{cat}</Text>
              {entries.map((e) => {
                const isUnlocked = unlocked(e);
                const isOpen = isUnlocked && openName === e.name;
                return (
                  <Pressable
                    key={e.name}
                    onPress={() => toggle(e)}
                    style={[s.entry, isOpen && s.entryOpen, !isUnlocked && { opacity: 0.45 }]}
                  >
                    <View style={s.entryTop}>
                      <Name e={e} dim={!isUnlocked} />
                      <Text style={s.short} numberOfLines={1}>
                        {isUnlocked
                          ? led && e.long
                            ? e.long
                            : e.short
                          : `🔒 unlocks in unit ${e.unit ? course.unitNumber(e.unit) : "?"}`}
                      </Text>
                      {isUnlocked && (
                        <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={14} color={t.dim} />
                      )}
                    </View>

                    {isOpen && (
                      <View style={{ gap: 8, marginTop: 8 }}>
                        <Text style={s.text}>{e.text}</Text>
                        {e.example && (
                          <View style={s.codeBox}>
                            {e.example.map((line, i) => (
                              <Text key={i} style={s.code}>
                                {line}
                              </Text>
                            ))}
                            {e.output?.map((line, i) => (
                              <Text key={`o${i}`} style={[s.code, { color: t.dim }]}>
                                {line}
                              </Text>
                            ))}
                          </View>
                        )}
                        {(e.flags !== undefined || e.modes) && (
                          <View style={s.metaRow}>
                            {e.flags !== undefined && (
                              <View style={s.metaGroup}>
                                <Text style={s.metaLabel}>FLAGS</Text>
                                {e.flags === "" ? (
                                  <Text style={s.metaText}>none</Text>
                                ) : (
                                  e.flags
                                    .replace(/\s*\(.*\)$/, "")
                                    .split(e.flags.startsWith("all") ? / /g : "")
                                    .map((f, i) => (
                                      <View key={i} style={s.flag}>
                                        <Text style={s.flagText}>{f}</Text>
                                      </View>
                                    ))
                                )}
                              </View>
                            )}
                            {e.modes && (
                              <View style={s.metaGroup}>
                                <Text style={s.metaLabel}>MODES</Text>
                                <Text style={s.metaText}>{e.modes}</Text>
                              </View>
                            )}
                          </View>
                        )}
                        {e.unit && <Text style={s.metaLabel}>TAUGHT IN UNIT {course.unitNumber(e.unit)}</Text>}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))
        )}

        {tab?.id !== "ascii" && groups.length === 0 && <Text style={[s.note, { marginTop: 24 }]}>Nothing found.</Text>}
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
    tab: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: t.soft - 2, borderBottomWidth: t.button === "key" ? 3 : 0 },
    tabOn: { backgroundColor: t.button === "key" ? t.keyFace : t.green, borderBottomColor: t.keyEdge },
    tabOff: { backgroundColor: t.button === "key" ? "#2B2B2B" : "transparent", borderBottomColor: "#000", borderWidth: t.button === "key" ? 0 : 1, borderColor: t.line },
    tabText: { fontFamily: t.mono, fontSize: 11, fontWeight: "700", letterSpacing: 1 },

    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 14,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      paddingHorizontal: 12,
    },
    searchInput: { flex: 1, fontFamily: t.mono, fontSize: 14, color: t.green, paddingVertical: 10 },
    chips: { gap: 6, marginTop: 12, paddingRight: 20 },
    chip: { borderWidth: 1, borderColor: t.line, borderRadius: 6, paddingVertical: 5, paddingHorizontal: 9 },
    chipOn: { backgroundColor: t.green, borderColor: t.green },
    chipText: { fontFamily: t.mono, fontSize: 10, color: t.green, letterSpacing: 1 },

    entry: { backgroundColor: t.surface, borderRadius: t.soft, borderWidth: 1.5, borderColor: "transparent", padding: 12, marginBottom: 8 },
    entryOpen: { borderColor: t.amber },
    entryTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: { fontFamily: t.mono, fontSize: 15, fontWeight: "700", color: t.green },
    short: { flex: 1, fontFamily: t.mono, fontSize: 12, color: t.dim, textAlign: t.button === "key" ? "left" : "right" },
    ledBadge: { backgroundColor: "#1E0605", borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
    ledName: { fontFamily: t.mono, fontSize: 14, fontWeight: "700", fontStyle: "italic", color: LED_ON },
    text: { fontFamily: t.mono, fontSize: 13, lineHeight: 19, color: t.green, opacity: 0.9 },
    codeBox: { backgroundColor: t.bg, borderRadius: 6, padding: 10 },
    code: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green },
    metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
    metaGroup: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
    metaLabel: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1 },
    metaText: { fontFamily: t.mono, fontSize: 11, color: t.green },
    flag: { backgroundColor: t.button === "key" ? LED_ON : t.green, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
    flagText: { fontFamily: t.mono, fontSize: 10, fontWeight: "700", color: t.button === "key" ? "#fff" : t.bg },

    asciiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 10 },
    asciiCell: { width: "15.2%", backgroundColor: t.surface, borderRadius: 4, paddingVertical: 5, alignItems: "center" },
    asciiChar: { fontFamily: t.mono, fontSize: 13, fontWeight: "700", color: t.green },
    asciiCode: { fontFamily: t.mono, fontSize: 9, color: t.dim },
    asciiPanel: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 14, backgroundColor: "#141414", borderRadius: t.soft, padding: 12 },
    ledGlass: { backgroundColor: "#1E0605", borderRadius: 4, paddingHorizontal: 10, paddingVertical: 2 },
    ledBig: { fontFamily: t.mono, fontSize: 32, fontWeight: "700", fontStyle: "italic", color: LED_ON },
    asciiInfo: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: "#EDF2E9" },
    note: { fontFamily: t.mono, fontSize: 12, lineHeight: 19, color: t.green, marginTop: 6 },
  })
);
