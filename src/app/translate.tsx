import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../lib/active-course";
import { courseById } from "../../lib/courses";
import { difficultyStars, isChallengeUnlocked, translationsFor, unlockHint } from "../../lib/practice";
import { Progress, loadAdminMode, loadProgress } from "../../lib/progress";
import { go, goBack } from "../../sounds";
import { makeStyles, useGlow, useTheme } from "../../theme";
import { SmoothBar } from "../../ui";

// Translate: rewrite a program from another course in this course's language
// The screen, with the rail on its left on phones
export default function TranslateScreen() {
  return (
    <WithRail path="/translate">
      <TranslateScreenContent />
    </WithRail>
  );
}

function TranslateScreenContent() {
  const theme = useTheme();
  const styles = useStyles();
  const glow = useGlow();
  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [admin, setAdmin] = useState(false);
  const { course } = useCourse();
  const translations = translationsFor(course);

  useFocusEffect(
    useCallback(() => {
      loadProgress().then(setProgress);
      loadAdminMode().then(setAdmin);
    }, [])
  );

  const done = progress.done;
  const translated = translations.filter((c) => done[c.id]).length;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={styles.back}>‹ PRACTICE</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: 20 }]}>
          ⇄ TRANSLATE · {translated}/{translations.length} DONE
        </Text>
        <Text style={[styles.title, glow]}>Translate</Text>
        <Text style={styles.subtitle}>
          Each one is a working program from another language and another decade. Read it, then rewrite it in{" "}
          {course.title}, so it does exactly the same. You don't need to know the other language: the programs are short.
        </Text>
        <View style={{ marginTop: 14 }}>
          <SmoothBar value={translated} total={translations.length} />
        </View>
        <View style={styles.divider} />

        {translations.length === 0 ? (
          <Text style={styles.subtitle}>No translations for this course yet.</Text>
        ) : (
        <View style={styles.group}>
          {translations.map((c) => {
            const isDone = !!done[c.id];
            const open = isChallengeUnlocked(course, c, done, admin);
            const from = c.from ? courseById(c.from) : undefined;
            return (
              <Pressable
                key={c.id}
                disabled={!open}
                onPress={() => go(`/quest/${c.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  isDone && styles.rowDone,
                  !open && styles.rowLocked,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, !open && { color: theme.dim }]}>{c.title}</Text>
                  <Text style={styles.rowMeta}>
                    {from ? `${from.title} ${from.year} → ${course.title} ${course.year}` : ""}
                    {"  ·  "}
                    {difficultyStars(c.difficulty)}
                    {!open ? `  ·  ${unlockHint(course, c)}` : ""}
                  </Text>
                </View>
                {isDone ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>✓</Text>
                  </View>
                ) : !open ? (
                  <Ionicons name="lock-closed-outline" size={16} color={theme.dim} />
                ) : (
                  <Text style={styles.xp}>{c.xp} XP</Text>
                )}
              </Pressable>
            );
          })}
        </View>
        )}
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
    divider: { height: 1, backgroundColor: theme.line, marginTop: 20, marginBottom: 20 },
    group: { marginTop: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: theme.surface,
      borderWidth: 1.5,
      borderColor: theme.line,
      borderRadius: theme.radius,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    rowDone: { backgroundColor: theme.doneBg, borderColor: theme.green },
    rowLocked: { opacity: 0.5 },
    rowPressed: { backgroundColor: theme.faint, borderColor: theme.green },
    rowTitle: { fontFamily: theme.mono, fontSize: 15, fontWeight: "600", color: theme.green },
    rowMeta: { fontFamily: theme.mono, fontSize: 11, color: theme.dim, marginTop: 4, letterSpacing: 0.5 },
    badge: {
      width: 26,
      height: 26,
      borderRadius: 6,
      backgroundColor: theme.green,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: { color: theme.bg, fontSize: 15, fontWeight: "900" },
    xp: { fontFamily: theme.mono, fontSize: 12, color: theme.dim },
  })
);
