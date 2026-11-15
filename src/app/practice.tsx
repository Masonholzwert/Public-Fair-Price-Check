import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { go, goBack } from "../../sounds";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { QUICK_PRACTICE_XP, quickPracticeId } from "../../lib/course";
import { useCourse } from "../../lib/active-course";
import {
  challengeIdsFor,
  challengesByChapter,
  challengesFor,
  difficultyStars,
  isChallengeUnlocked,
  practiceLessonIds,
  practiceIdsFor,
  translationsFor,
  unlockHint,
} from "../../lib/practice";
import { Progress, earnedXp, loadAdminMode, loadProgress } from "../../lib/progress";
import { TermButton, makeStyles, useGlow, useTheme } from "../../theme";
import { SmoothBar } from "../../ui";

// The screen, with the rail on its left on phones
export default function PracticeScreen() {
  return (
    <WithRail path="/practice">
      <PracticeScreenContent />
    </WithRail>
  );
}

function PracticeScreenContent() {
  const theme = useTheme();
  const styles = useStyles();
  const glow = useGlow();
  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [admin, setAdmin] = useState(false);
  const { course } = useCourse();
  const challenges = challengesFor(course);
  const challengeIds = challengeIdsFor(course);
  const translations = translationsFor(course);

  // Reload whenever we come back from a round or a challenge
  useFocusEffect(
    useCallback(() => {
      loadProgress().then(setProgress);
      loadAdminMode().then(setAdmin);
    }, [])
  );

  const done = progress.done;
  const lessonIds = practiceLessonIds(course, done, admin);
  const solved = challengeIds.filter((id) => done[id]).length;
  const translated = translations.filter((c) => done[c.id]).length;
  const practiceXp = earnedXp(progress, practiceIdsFor(course)) + (progress.bonusXp ?? 0);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={styles.back}>‹ HOME</Text>
        </Pressable>

        {/* Header */}
        <Text style={[styles.label, { marginTop: 20 }]}>PRACTICE · {practiceXp} XP</Text>
        <Text style={[styles.title, glow]}>Practice</Text>
        <Text style={styles.subtitle}>Keep your skills sharp. Nothing here blocks your progress in the course.</Text>
        <View style={styles.divider} />

        {/* Quick Practice */}
        <View style={styles.quickCard}>
          <View style={styles.quickHeader}>
            <Ionicons name="terminal" size={14} color={theme.bg} />
            <Text style={styles.quickHeaderText}>QUICK PRACTICE</Text>
          </View>
          <View style={styles.quickBody}>
            <Text style={styles.quickText}>
              {lessonIds.length > 0
                ? `10 random exercises from the ${lessonIds.length} lesson${lessonIds.length === 1 ? "" : "s"} you've finished. A new mix every round.`
                : "Finish your first lesson, and its exercises will show up here."}
            </Text>
            {(progress.practiceRounds ?? 0) > 0 && (
              <Text style={styles.label}>ROUNDS PLAYED · {progress.practiceRounds}</Text>
            )}
            <TermButton
              label={`START · +${QUICK_PRACTICE_XP} XP`}
              disabled={lessonIds.length === 0}
              onPress={() => go(`/lesson/${quickPracticeId(lessonIds)}`)}
            />
          </View>
        </View>

        {/* Translate: its own screen, opened from here */}
        {translations.length > 0 && (
          <View style={[styles.quickCard, { marginTop: 16 }]}>
            <View style={styles.quickHeader}>
              <Ionicons name="swap-horizontal" size={14} color={theme.bg} />
              <Text style={styles.quickHeaderText}>TRANSLATE</Text>
            </View>
            <View style={styles.quickBody}>
              <Text style={styles.quickText}>
                Working programs from other languages and other decades. Rewrite them in {course.title}, so they do exactly
                the same.
              </Text>
              <Text style={styles.label}>
                {translated}/{translations.length} DONE
              </Text>
              <SmoothBar value={translated} total={translations.length} />
              <TermButton label="OPEN TRANSLATIONS" onPress={() => go("/translate")} />
            </View>
          </View>
        )}

        {/* Code challenges */}
        <View style={styles.challengeHeader}>
          <Text style={styles.label}>
            CODE CHALLENGES · {solved}/{challenges.length} SOLVED
          </Text>
          <Text style={styles.sectionText}>
            Small programs to write yourself. They open once you've finished the lessons of their unit.
          </Text>
          <View style={{ marginTop: 10 }}>
            <SmoothBar value={solved} total={challenges.length} />
          </View>
        </View>

        {challengesByChapter(course).map(({ chapter, index, items }) => (
          <View key={chapter.id} style={styles.group}>
            <Text style={styles.groupTitle}>
              CHAPTER {index + 1} · {chapter.title.toUpperCase()}
            </Text>
            {items.map((c) => {
              const isDone = !!done[c.id];
              const open = isChallengeUnlocked(course, c, done, admin);
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
  divider: { height: 1, backgroundColor: theme.line, marginTop: 20, marginBottom: 24 },

  // Quick Practice
  quickCard: { borderRadius: theme.radius, borderWidth: 1.5, borderColor: theme.green, overflow: "hidden" },
  quickHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.green,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  quickHeaderText: { fontFamily: theme.mono, fontSize: 11, fontWeight: "700", color: theme.bg, letterSpacing: 2 },
  quickBody: { backgroundColor: theme.faint, padding: 16, gap: 12 },
  quickText: { fontFamily: theme.mono, fontSize: 14, lineHeight: 21, color: theme.green },

  // Challenges
  challengeHeader: { marginTop: 40, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: theme.line },
  sectionText: { fontFamily: theme.mono, fontSize: 13, lineHeight: 20, color: theme.green, opacity: 0.75, marginTop: 6 },
  group: { marginTop: 24 },
  groupTitle: { fontFamily: theme.mono, fontSize: 11, color: theme.green, letterSpacing: 1.5, marginBottom: 10 },
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
