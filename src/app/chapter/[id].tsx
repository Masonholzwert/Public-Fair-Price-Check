import { Ionicons } from "@expo/vector-icons";
import { go, goBack } from "../../../sounds";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../../lib/active-course";
import {
  FIX_XP,
  REVIEW_XP,
  chapterStepIds,
  fixMistakesId,
  isUnitUnlocked,
  questId,
  reviewId,
  unitMistakeIds,
  unitStepIds,
  unitTotalXp,
} from "../../../lib/course";
import { Progress, earnedXp, loadAdminMode, loadProgress } from "../../../lib/progress";
import { makeStyles, useAmberGlow, useGlow, useTheme } from "../../../theme";
import { SmoothBar, LockOverlay } from "../../../ui";

export default function ChapterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { course } = useCourse();
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const amberGlow = useAmberGlow();
  const chapterIndex = course.chapters.findIndex((c) => c.id === id);
  const chapter = course.chapters[chapterIndex];

  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [admin, setAdmin] = useState(false);

  // Reload whenever we come back from a lesson or quest
  useFocusEffect(
    useCallback(() => {
      loadProgress().then(setProgress);
      loadAdminMode().then(setAdmin);
    }, [])
  );

  if (!chapter) return <Text>Chapter not found</Text>;

  const done = progress.done;
  const chapterUnlocked = course.isChapterUnlocked(chapterIndex, done, admin);
  const nextId = chapterStepIds(chapter).find((stepId) => !done[stepId]);
  const allUnitsDone = chapter.units.every((u) => !u.comingSoon && unitStepIds(u).every((x) => done[x]));

  // Running line number for this chapter: 10, 20, 30 like BASIC lines,
  // or memory addresses ($0200, $0210 …) for assembly. There, every unit gets its own page of memory.
  const addresses = course.lineStyle === "address";
  let line = 0;
  const startUnit = (unitNumber: number) => {
    if (addresses) line = 0x0200 + (unitNumber - 1) * 0x100 - 0x10;
  };
  const cards = course.lineStyle === "card"; // FORTRAN: card sequence numbers, 00010, 00020 …
  const editor = course.lineStyle === "editor"; // C: line numbers like in the ed editor, 1, 2, 3 …
  const octal = course.lineStyle === "octal"; // Altair: memory addresses in octal, 000, 001, 002 …
  const cobolSeq = course.lineStyle === "cobol"; // COBOL: sequence numbers in columns 1-6, 000100, 000200 …
  const nextLine = (): string => {
    if (octal) return (line++).toString(8).padStart(3, "0");
    line += addresses ? 0x10 : editor ? 1 : cobolSeq ? 100 : 10;
    if (cobolSeq) return String(line).padStart(6, "0");
    if (editor) return String(line).padStart(3, " ");
    if (cards) return String(line).padStart(5, "0");
    return addresses ? "$" + line.toString(16).toUpperCase().padStart(4, "0") : String(line);
  };

  // Score for a finished lesson or review, e.g. "6/6"
  const score = (stepId: string) => {
    const d = done[stepId];
    return d?.correct !== undefined ? `${d.correct}/${d.total}` : "DONE";
  };

  const project = chapter.project;
  const projectDone = project ? !!done[project.id] : false;
  const projectOpen = !!project && project.available && (admin || (chapterUnlocked && allUnitsDone));

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={s.back}>‹ ALL CHAPTERS</Text>
        </Pressable>

        {/* Chapter header */}
        <Text style={[s.label, { marginTop: 20 }]}>CHAPTER {chapterIndex + 1}</Text>
        <Text style={[s.title, glow]}>{chapter.title}</Text>
        <Text style={s.subtitle}>{chapter.subtitle}</Text>
        <View style={s.headerDivider} />

        {chapter.units.map((unit, unitIndex) => {
          const n = course.unitNumber(unit.id);
          startUnit(n);

          // Planned unit without lessons yet
          if (unit.comingSoon) {
            return (
              <View key={unit.id} style={s.unitWrap}>
                <View style={s.unitHeader}>
                  <Text style={s.label}>UNIT {n}</Text>
                  <Text style={[s.unitTitle, { color: t.dim }]}>{unit.title}</Text>
                </View>
                <View style={[s.row, s.rowSoon]}>
                  <Ionicons name="time-outline" size={16} color={t.dim} />
                  <Text style={[s.stepTitle, { color: t.dim }]}>Coming soon</Text>
                </View>
              </View>
            );
          }

          const unitUnlocked = isUnitUnlocked(chapter, unitIndex, chapterUnlocked, done, admin);
          const ids = unitStepIds(unit);
          const doneCount = ids.filter((x) => done[x]).length;
          const unitComplete = doneCount === ids.length;
          const isOpen = (k: number) => admin || (unitUnlocked && (k === 0 || !!done[ids[k - 1]]));
          const reviewIndex = unit.lessons.length;
          const questIndex = reviewIndex + 1;
          const mistakeIds = unitMistakeIds(unit, progress.mistakes);

          return (
            <View key={unit.id} style={s.unitWrap}>
              <View style={!unitUnlocked && s.lockedContent}>
                {/* Unit header with progress */}
                <View style={s.unitHeader}>
                  <Text style={s.label}>
                    UNIT {n} · {earnedXp(progress, ids)}/{unitTotalXp(unit)} XP
                  </Text>
                  <Text style={[s.unitTitle, glow]}>{unit.title}</Text>
                  <View style={{ marginTop: 8 }}>
                    <SmoothBar value={doneCount} total={ids.length} />
                  </View>
                </View>

                {/* Unit briefing: what you'll learn (hidden once the unit is finished) */}
                {!unitComplete && (
                  <View style={s.briefing}>
                    <View style={s.briefingHeader}>
                      <Ionicons name="book-outline" size={13} color={t.bg} />
                      <Text style={s.briefingHeaderText}>UNIT BRIEFING</Text>
                    </View>
                    <View style={s.briefingBody}>
                      <Text style={s.label}>YOU'LL LEARN</Text>
                      {unit.learn.map((item, i) => (
                        <View key={i} style={s.learnRow}>
                          <Ionicons name="chevron-forward" size={14} color={t.green} style={{ marginTop: 3 }} />
                          <Text style={s.learnItem}>{item}</Text>
                        </View>
                      ))}
                      <View style={s.goalBox}>
                        <Ionicons name="flag-outline" size={16} color={t.green} style={{ marginTop: 1 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.label}>GOAL</Text>
                          <Text style={s.goalText}>{unit.goal}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}

                {/* Lessons */}
                {unit.lessons.map((lesson, k) => (
                  <StepRow
                    key={lesson.id}
                    variant="lesson"
                    lineNo={nextLine()}
                    title={lesson.title}
                    xp={lesson.xp}
                    done={!!done[lesson.id]}
                    doneText={score(lesson.id)}
                    open={isOpen(k)}
                    isNext={isOpen(k) && lesson.id === nextId}
                    onPress={() => go(`/lesson/${lesson.id}`)}
                  />
                ))}

                {/* Review */}
                <Text style={s.reviewLabel}>↻ PRACTICE</Text>
                <StepRow
                  variant="review"
                  lineNo={nextLine()}
                  title="Unit Review"
                  xp={REVIEW_XP}
                  done={!!done[reviewId(unit.id)]}
                  doneText={score(reviewId(unit.id))}
                  open={isOpen(reviewIndex)}
                  isNext={isOpen(reviewIndex) && reviewId(unit.id) === nextId}
                  onPress={() => go(`/lesson/${reviewId(unit.id)}`)}
                />

                {/* Mistakes: every question of this unit that was answered wrong and not fixed yet */}
                {unitUnlocked && mistakeIds.length > 0 && (
                  <Pressable
                    onPress={() => go(`/lesson/${fixMistakesId(mistakeIds)}`)}
                    style={({ pressed }) => [s.row, s.rowFix, pressed && s.rowPressed]}
                  >
                    <Ionicons name="refresh" size={18} color={t.red} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.stepTitle, { color: t.green }]}>Fix your mistakes</Text>
                      <Text style={s.fixMeta}>
                        {mistakeIds.length} QUESTION{mistakeIds.length === 1 ? "" : "S"} TO RETAKE · +{FIX_XP} XP
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={t.dim} />
                  </Pressable>
                )}

                {/* Quest */}
                {unit.quest && (
                  <>
                    <Text style={s.questLabel}>★ BONUS QUEST</Text>
                    <StepRow
                      variant="quest"
                      lineNo={nextLine()}
                      title={unit.quest.title}
                      xp={unit.quest.xp}
                      done={!!done[questId(unit.id)]}
                      doneText="SOLVED"
                      open={isOpen(questIndex)}
                      isNext={isOpen(questIndex) && questId(unit.id) === nextId}
                      onPress={() => go(`/quest/${unit.id}`)}
                    />
                  </>
                )}
              </View>

              {!unitUnlocked && <LockOverlay text={`Finish Unit ${n - 1} to unlock`} inset={-8} />}
            </View>
          );
        })}

        {/* Chapter project */}
        {project && (
          <>
            <View style={s.projectLabelRow}>
              <Ionicons name="trophy-outline" size={12} color={t.amber} />
              <Text style={s.projectLabel}>CHAPTER PROJECT</Text>
            </View>
            <Pressable
              disabled={!projectOpen}
              onPress={() => go(`/quest/${project.id}`)}
              style={({ pressed }) => [
                s.row,
                s.rowProject,
                !projectOpen && s.rowLocked,
                pressed && s.rowQuestPressed,
              ]}
            >
              <Text style={[s.lineNo, addresses && s.lineAddress, { color: t.amber }]}>{nextLine()}</Text>
              <Text style={[s.stepTitle, { color: t.amber }, amberGlow]}>{project.title}</Text>
              <Text style={[s.xp, { color: t.amber }]}>
                {!project.available ? "SOON" : projectDone ? "DONE" : `${project.xp} XP`}
              </Text>
            </Pressable>
            {!projectOpen && (
              <Text style={s.projectHint}>
                {!project.available
                  ? "Coming soon: a bigger program that uses everything from this chapter."
                  : "Finish all units of this chapter to start the project."}
              </Text>
            )}
          </>
        )}

        {/* The chapter ends like a program */}
        <View style={[s.row, s.rowEnd]}>
          <Text style={[s.lineNo, addresses && s.lineAddress]}>{nextLine()}</Text>
          <Text style={[s.stepTitle, { color: t.dim }]}>{course.closingLine ?? (addresses ? "BRK" : editor ? "}" : "END")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- One row: lesson, review or quest ----------

function StepRow({
  variant,
  lineNo,
  title,
  xp,
  done,
  doneText,
  open,
  isNext,
  onPress,
}: {
  variant: "lesson" | "review" | "quest";
  lineNo: string;
  title: string;
  xp: number;
  done: boolean;
  doneText: string;
  open: boolean;
  isNext: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const amberGlow = useAmberGlow();
  const quest = variant === "quest";
  const color = quest ? t.amber : t.green;

  return (
    <Pressable
      disabled={!open}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        variant === "review" && s.rowReview,
        quest && s.rowQuest,
        done && (quest ? s.rowQuestDone : s.rowDone),
        isNext && !quest && s.rowNext,
        !open && s.rowLocked,
        pressed && (quest ? s.rowQuestPressed : s.rowPressed),
      ]}
    >
      {done ? (
        <View style={[s.badge, { backgroundColor: color }]}>
          <Text style={s.badgeText}>✓</Text>
        </View>
      ) : (
        <Text style={[s.lineNo, (lineNo.startsWith("$") || lineNo.length === 5) && s.lineAddress, quest && { color }]}>{lineNo}</Text>
      )}

      <Text style={[s.stepTitle, { color: open || quest ? color : t.dim }, quest ? amberGlow : isNext && glow]}>
        {isNext ? "> " : ""}
        {title}
      </Text>

      {done ? (
        <Text style={[s.doneTag, { color }]}>{doneText}</Text>
      ) : !open ? (
        <Ionicons name="lock-closed-outline" size={16} color={quest ? t.amber : t.dim} />
      ) : (
        <Text style={[s.xp, quest && { color }]}>{xp} XP</Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 20, paddingBottom: 60 },
    back: { fontFamily: t.mono, fontSize: 13, color: t.dim, letterSpacing: 1 },
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    title: { fontFamily: t.mono, fontSize: 26, fontWeight: "700", color: t.green, marginTop: 6 },
    subtitle: { fontFamily: t.mono, fontSize: 14, lineHeight: 22, color: t.green, opacity: 0.75, marginTop: 8 },
    headerDivider: { height: 1, backgroundColor: t.line, marginTop: 20 },

    // Units
    unitWrap: { marginTop: 44 },
    unitHeader: { marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: t.line },
    unitTitle: { fontFamily: t.mono, fontSize: 20, fontWeight: "700", color: t.green, marginTop: 4 },
    lockedContent: { opacity: 0.6 },

    // Unit briefing
    briefing: { borderRadius: t.soft, borderWidth: 1.5, borderColor: t.dim, overflow: "hidden", marginBottom: 24 },
    briefingHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: t.dim,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    briefingHeaderText: { fontFamily: t.mono, fontSize: 11, fontWeight: "700", color: t.bg, letterSpacing: 2 },
    briefingBody: { backgroundColor: t.faint, padding: 16, gap: 8 },
    learnRow: { flexDirection: "row", gap: 6 },
    learnItem: { flex: 1, fontFamily: t.mono, fontSize: 13, lineHeight: 20, color: t.green },
    goalBox: {
      flexDirection: "row",
      gap: 10,
      backgroundColor: t.bg,
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: t.green,
      padding: 12,
      marginTop: 6,
    },
    goalText: { fontFamily: t.mono, fontSize: 13, lineHeight: 19, color: t.green, marginTop: 4 },

    // Rows
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      paddingVertical: 18,
      paddingHorizontal: 16,
      marginBottom: 10,
    },
    rowDone: { backgroundColor: t.doneBg, borderColor: t.green },
    rowNext: { borderColor: t.green },
    rowPressed: { backgroundColor: t.faint, borderColor: t.green },
    rowLocked: { opacity: 0.5 },
    rowReview: { borderStyle: "dashed" },
    rowFix: { backgroundColor: t.redFaint, borderColor: t.red, paddingVertical: 14 },
    fixMeta: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1, marginTop: 4 },
    rowSoon: { backgroundColor: "transparent", borderStyle: "dashed", gap: 10 },
    rowQuest: { backgroundColor: t.amberFaint, borderColor: t.amber, borderStyle: "dashed", paddingVertical: 22 },
    rowQuestDone: { borderStyle: "solid" },
    rowQuestPressed: { opacity: 0.8 },
    rowProject: { backgroundColor: t.amberFaint, borderColor: t.amber, borderWidth: 2, paddingVertical: 26 },
    rowEnd: { backgroundColor: "transparent", borderStyle: "dashed", borderWidth: 1, marginTop: 36 },

    // Labels above special rows
    reviewLabel: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5, marginTop: 14, marginBottom: 8 },
    questLabel: { fontFamily: t.mono, fontSize: 11, color: t.amber, letterSpacing: 1.5, marginTop: 14, marginBottom: 8 },
    projectLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 44, marginBottom: 8 },
    projectLabel: { fontFamily: t.mono, fontSize: 11, color: t.amber, letterSpacing: 1.5 },
    projectHint: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.dim },

    // Row content
    lineNo: { fontFamily: t.mono, fontSize: 14, color: t.dim, width: 28 },
    lineAddress: { width: 50, fontSize: 13 },
    badge: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
    badgeText: { color: t.bg, fontSize: 16, fontWeight: "900" },
    stepTitle: { flex: 1, fontFamily: t.mono, fontSize: 16, fontWeight: "600" },
    xp: { fontFamily: t.mono, fontSize: 12, color: t.dim },
    doneTag: { fontFamily: t.mono, fontSize: 13, fontWeight: "700" },
  })
);
