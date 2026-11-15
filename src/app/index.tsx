import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../press";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../lib/active-course";
import { useWide } from "../../lib/layout";
import { resetOnboarding } from "../../lib/onboarding";
import { testAllReminders, testDailyReminder, testReminder } from "../../lib/reminders";
import { onSynced, syncNow } from "../../lib/cloud";
import { Chapter, Course, chapterHasContent, chapterStepIds, chapterTotalXp, questId, reviewId, unitStepIds } from "../../lib/course";
import { resetDaily } from "../../lib/daily";
import { loadName } from "../../lib/stats";
import {
  Progress,
  currentStreak,
  earnedXp,
  loadAdminMode,
  loadProgress,
  resetProgress,
  setAdminMode,
} from "../../lib/progress";
import { Cursor, makeStyles, useGlow, useTheme } from "../../theme";
import { menuStats } from "../../menu";
import { go, sound as sound_ } from "../../sounds";
import { StreakCard, StreakCelebration } from "../../streak";
import { LockOverlay, ProgressDots, SmoothBar, boxGlow, softRadius } from "../../ui";

// The hidden admin menu (long-press the title) only exists in development builds.
// Set this to true if you ever want it in a tester build.
const ADMIN_MENU = __DEV__;

// The screen, with the rail on its left on phones
export default function Home() {
  return (
    <WithRail path="/">
      <HomeContent />
    </WithRail>
  );
}

function HomeContent() {
  const { course } = useCourse();
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [admin, setAdmin] = useState(false);
  const [name, setName] = useState("");
  const [testCelebration, setTestCelebration] = useState(false); // admin: play the streak animation on demand
  // Big computer window: the menu is a sidebar, and cards sit side by side
  const wide = useWide();

  // Reload progress and admin mode every time the home screen comes back into view
  useFocusEffect(
    useCallback(() => {
      loadProgress().then(setProgress);
      loadAdminMode().then(setAdmin);
      loadName().then(setName);
      syncNow(); // fetch what you did on your other devices
    }, [])
  );
  // When progress from another device arrives, show it right away
  useEffect(() => onSynced(() => loadProgress().then(setProgress)), []);

  const stats = menuStats(course, progress, name);
  const next = nextStep(course, progress.done, admin);

  async function reset() {
    await resetProgress();
    setProgress(await loadProgress());
  }

  async function toggleAdmin() {
    await setAdminMode(!admin);
    setAdmin(!admin);
  }

  // Admin: try every kind of reminder. Each one arrives after 5 seconds, so go to the iPhone home screen.
  function openReminderTests() {
    const run = (task: () => Promise<string | null>, done: string) => async () => {
      const error = await task();
      Alert.alert("Reminder test", error ?? done);
    };
    const soon = "Arrives in 5 seconds. Swipe up to the iPhone home screen to see the banner.";
    Alert.alert("Test reminders", "Which reminder do you want to see?", [
      { text: "Streak ends tonight", onPress: run(() => testReminder("streak-ends"), soon) },
      { text: "No streak yet", onPress: run(() => testReminder("no-streak"), soon) },
      { text: "Day after learning", onPress: run(() => testReminder("keep-going"), soon) },
      { text: "Random nudge", onPress: run(() => testReminder("nudge"), soon) },
      { text: "All of them (every 6 s)", onPress: run(testAllReminders, "8 reminders, one every 6 seconds, starting in 5 seconds.") },
      {
        text: "Real daily reminder in 1 min",
        onPress: run(testDailyReminder, "Today's real reminder comes in about a minute. Opening the app again sets it back to 19:00."),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function openAdminMenu() {
    if (!ADMIN_MENU) return;
    Alert.alert("Admin", admin ? "Admin mode is ON. Everything is unlocked." : "Admin mode is OFF.", [
      { text: admin ? "Turn admin mode off" : "Unlock everything (admin)", onPress: toggleAdmin },
      { text: "Play streak animation", onPress: () => setTestCelebration(true) },
      { text: "Test reminders…", onPress: openReminderTests },
      { text: "Show introduction again", onPress: () => resetOnboarding() },
      {
        text: "Play today's daily challenge again",
        // Removes today's daily result and restarts its clock on this device (the leaderboard keeps the first time)
        onPress: () => resetDaily().then(() => loadProgress().then(setProgress)),
      },
      { text: "Reset progress", style: "destructive", onPress: reset },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={{ flex: 1 }}>
        {/* The rail on the left (phones) and the sidebar (big windows) come from the layout */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.content, !wide && s.contentWithRail]}>
          {testCelebration && (
            <StreakCelebration streak={Math.max(1, currentStreak(progress))} onDone={() => setTestCelebration(false)} />
          )}

          {/* Course switcher */}
          <Pressable onPress={() => go("/courses")} style={({ pressed }) => [s.switcher, pressed && s.pressed]}>
            <View style={[s.switcherDot, boxGlow(t, t.green, 0.9)]} />
            <Text style={s.switcherText}>
              {course.title.toUpperCase()} · {course.year}
            </Text>
            <Text style={s.switcherChange}>›</Text>
          </Pressable>

          {/* Boot header (long-press the title for the admin menu), with how much of the course is done */}
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{t.bootLine}</Text>
              <Pressable onLongPress={openAdminMenu} delayLongPress={600}>
                <Text style={[s.title, glow]}>{course.title}</Text>
              </Pressable>
              <View style={s.readyRow}>
                <Text style={[s.ready, glow]}>{t.prompt} </Text>
                <Cursor size={16} />
              </View>
            </View>
            {course.available && <ProgressDots percent={stats.percent} />}
          </View>
          <Text style={[s.label, { marginTop: 10 }]}>TOTAL · {stats.xp} XP</Text>
          {admin && <Text style={s.adminBadge}>ADMIN MODE · ALL UNLOCKED</Text>}

          {/* Daily streak: days in a row with at least one finished lesson, quest or practice round */}
          <StreakCard progress={progress} />

          {/* Straight to the next step */}
          {next && (
            <Pressable
              onPress={() => go(next.path)}
              style={({ pressed }) => [s.continueButton, boxGlow(t, continueBg(t), 0.35), pressed && { opacity: 0.85 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.continueLabel, { color: continueFg(t) }]}>CONTINUE</Text>
                <Text style={[s.continueTitle, { color: continueFg(t) }]} numberOfLines={1}>
                  {next.title}
                </Text>
                <Text style={[s.continueSub, { color: continueFg(t) }]} numberOfLines={1}>
                  {next.sub}
                </Text>
              </View>
              <View style={[s.continuePlay, { backgroundColor: continueFg(t) }]}>
                <Ionicons name="play" size={16} color={continueBg(t)} />
              </View>
            </Pressable>
          )}

          <Text style={s.sectionLabel}>CHAPTERS</Text>

          {!course.available && (
            <View style={s.card}>
              <Text style={s.cardSubtitle}>The lessons for this course are on the way.</Text>
            </View>
          )}

          <View style={[{ gap: 14 }, wide && s.grid]}>
            {course.chapters.map((chapter, index) => (
              <ChapterCard
                key={chapter.id}
                chapter={chapter}
                index={index}
                unlocked={course.isChapterUnlocked(index, progress.done, admin)}
                done={progress.done}
                current={next?.chapterId === chapter.id}
                currentStep={next?.stepId}
                wide={wide}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

type Done = Progress["done"];

// The next thing to do: the first unfinished step of the first open chapter
function nextStep(course: Course, done: Done, admin: boolean) {
  for (let index = 0; index < course.chapters.length; index++) {
    const chapter = course.chapters[index];
    if (!chapterHasContent(chapter) || !course.isChapterUnlocked(index, done, admin)) continue;
    const stepId = chapterStepIds(chapter).find((id) => !done[id]);
    if (!stepId) continue;
    const base = { chapterId: chapter.id, stepId };
    if (chapter.project && stepId === chapter.project.id) {
      return { ...base, path: `/quest/${stepId}`, title: chapter.project.title, sub: `Chapter ${index + 1} project` };
    }
    for (const unit of chapter.units) {
      const unitTitle = `Unit ${course.unitNumber(unit.id)}: ${unit.title}`;
      const k = unit.lessons.findIndex((l) => l.id === stepId);
      if (k >= 0) return { ...base, path: `/lesson/${stepId}`, title: unitTitle, sub: `Lesson ${k + 1} · ${unit.lessons[k].title}` };
      if (stepId === reviewId(unit.id)) return { ...base, path: `/lesson/${stepId}`, title: unitTitle, sub: "Unit Review" };
      if (stepId === questId(unit.id) && unit.quest) return { ...base, path: `/quest/${unit.id}`, title: unitTitle, sub: `Quest · ${unit.quest.title}` };
    }
  }
  return null;
}

// The CONTINUE button's colors: the course's main color, a keypad key on the circuit boards
const continueBg = (t: ReturnType<typeof useTheme>) => (t.button === "key" ? t.keyFace : t.green);
const continueFg = (t: ReturnType<typeof useTheme>) => (t.button === "key" ? t.keyText : t.bg);

// One chapter: open ones show their units and progress, locked ones are a slim row
function ChapterCard({
  chapter,
  index,
  unlocked,
  done,
  current,
  currentStep,
  wide,
}: {
  chapter: Chapter;
  index: number;
  unlocked: boolean;
  done: Done;
  current: boolean; // the chapter with the next step
  currentStep?: string;
  wide: boolean;
}) {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const { course } = useCourse();
  const hasContent = chapterHasContent(chapter);
  const ids = chapterStepIds(chapter);
  const doneCount = ids.filter((id) => done[id]).length;
  const complete = ids.length > 0 && doneCount === ids.length && chapter.units.every((u) => !u.comingSoon);
  const percent = ids.length ? Math.round((doneCount / ids.length) * 100) : 0;

  const open = unlocked && hasContent;
  return (
    <View style={wide && s.cardWide}>
    <Pressable
      disabled={!open}
      onPress={() => go(`/chapter/${chapter.id}`)}
      style={({ pressed }) => [
        s.card,
        complete && s.cardDone,
        current && [s.cardCurrent, boxGlow(t, t.green, 0.25)],
        pressed && s.pressed,
      ]}
    >
      <View style={s.cardTop}>
        <Text style={s.label}>CHAPTER {index + 1}</Text>
        <Text style={s.label}>
          {earnedXp({ done }, ids)} / {chapterTotalXp(chapter)} XP
        </Text>
      </View>
      <Text style={[s.cardTitle, glow]}>{chapter.title}</Text>
      <Text style={s.cardSubtitle}>{chapter.subtitle}</Text>

      {/* Units in this chapter, with the same progress as inside the chapter:
          ✓ finished (lessons, review and quest), ◉ started or next, ○ not started yet */}
      <View style={s.unitList}>
        {chapter.units.map((unit) => {
          const unitIds = unitStepIds(unit);
          const unitDoneCount = unitIds.filter((id) => done[id]).length;
          const unitDone = unitIds.length > 0 && unitDoneCount === unitIds.length;
          const here = !!currentStep && unitIds.includes(currentStep);
          const started = unitDoneCount > 0 || here;
          return (
            <View key={unit.id} style={s.unitRow}>
              {unitDone ? (
                <View style={[s.unitMark, { backgroundColor: t.green, borderColor: t.green }]}>
                  <Ionicons name="checkmark" size={12} color={t.bg} />
                </View>
              ) : (
                <View style={[s.unitMark, started && { borderColor: t.green }]}>
                  {started && <View style={s.unitHere} />}
                </View>
              )}
              <Text
                style={[s.unitLine, here && s.unitLineHere, unit.comingSoon && { color: t.dim }]}
                numberOfLines={1}
              >
                Unit {course.unitNumber(unit.id)}: {unit.title}
                {unit.comingSoon ? " (soon)" : ""}
              </Text>
              {!unit.comingSoon && (
                <Text style={[s.unitCount, unitDone && { color: t.green }]}>
                  {unitDoneCount}/{unitIds.length}
                </Text>
              )}
            </View>
          );
        })}
        {chapter.project && (
          <View style={s.unitRow}>
            <View style={[s.unitMark, { borderColor: t.amber }, done[chapter.project.id] && { backgroundColor: t.amber }]}>
              <Ionicons name={done[chapter.project.id] ? "trophy" : "trophy-outline"} size={10} color={done[chapter.project.id] ? t.bg : t.amber} />
            </View>
            <Text style={s.projectText} numberOfLines={1}>
              {chapter.project.title}
            </Text>
          </View>
        )}
      </View>

      {/* Progress */}
      {hasContent && (
        <View style={s.progressRow}>
          <View style={{ flex: 1 }}>
            <SmoothBar value={doneCount} total={ids.length} />
          </View>
          <Text style={s.percent}>{percent}%</Text>
        </View>
      )}
    </Pressable>

    {/* Locked chapters: the whole card, blurred, with why it's locked */}
    {!hasContent ? (
      <LockOverlay title="COMING SOON" text="New units are on the way" icon="time-outline" />
    ) : !unlocked ? (
      <LockOverlay text={`Finish Chapter ${index} to unlock`} />
    ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => {
  const r = softRadius(t);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 20, paddingBottom: 60 },
    contentWithRail: { paddingLeft: 12, paddingRight: 18, paddingTop: 8 },

    // Big computer window
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
    cardWide: { width: "48.5%" },
    label: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.5 },
    title: { fontFamily: t.mono, fontSize: 30, fontWeight: "700", color: t.green, marginTop: 4 },
    readyRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
    ready: { fontFamily: t.mono, fontSize: 15, color: t.green },
    adminBadge: { fontFamily: t.mono, fontSize: 11, color: t.amber, letterSpacing: 1.5, marginTop: 6 },
    pressed: { backgroundColor: t.faint, borderColor: t.green },
    sectionLabel: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.6, marginTop: 30, marginBottom: 12 },

    // Course switcher: a pill with a lit dot
    switcher: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "flex-start",
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 999,
      paddingVertical: 9,
      paddingHorizontal: 14,
    },
    switcherDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.green },
    switcherText: { fontFamily: t.mono, fontSize: 11, color: t.green, letterSpacing: 1.2 },
    switcherChange: { fontFamily: t.mono, fontSize: 11, color: t.dim },

    headerRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 24 },

    // Continue
    continueButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 14,
      backgroundColor: continueBg(t),
      borderRadius: r - 2,
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    continueLabel: { fontFamily: t.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1.4, opacity: 0.75 },
    continueTitle: { fontFamily: t.mono, fontSize: 15, fontWeight: "700", marginTop: 3 },
    continueSub: { fontFamily: t.mono, fontSize: 11, marginTop: 2, opacity: 0.8 },
    continuePlay: { width: 40, height: 40, borderRadius: Math.min(20, r), alignItems: "center", justifyContent: "center" },

    // Chapter cards
    card: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: r, padding: 18, gap: 6 },
    cardCurrent: { borderColor: t.green, borderWidth: 1.5 },
    cardDone: { backgroundColor: t.doneBg, borderColor: t.green },
    cardTop: { flexDirection: "row", justifyContent: "space-between" },
    cardTitle: { fontFamily: t.mono, fontSize: 19, fontWeight: "700", color: t.green },
    cardSubtitle: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green, opacity: 0.75 },
    unitList: { marginTop: 10, gap: 8 },
    unitRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    unitMark: { width: 18, height: 18, borderRadius: Math.min(9, r / 2), borderWidth: 1.5, borderColor: t.line, alignItems: "center", justifyContent: "center" },
    unitHere: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.green },
    unitLine: { flex: 1, fontFamily: t.mono, fontSize: 12, color: t.green },
    unitLineHere: { fontWeight: "700" },
    unitCount: { fontFamily: t.mono, fontSize: 10, color: t.dim },
    projectText: { flex: 1, fontFamily: t.mono, fontSize: 12, color: t.amber },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
    percent: { fontFamily: t.mono, fontSize: 11, fontWeight: "700", color: t.green },

  });
});
