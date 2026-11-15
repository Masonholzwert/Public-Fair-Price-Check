import { router, useLocalSearchParams } from "expo-router";
import { memo, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { Course, Exercise, RunResult, fixMistakesId, shuffle } from "../../../lib/course";
import { findLessonAnywhere } from "../../../lib/courses";
import { Ionicons } from "@expo/vector-icons";
import { currentStreak, loadProgress, markDone, recordAnswer } from "../../../lib/progress";
import { go, goBack, useSound } from "../../../sounds";
import { Cursor, TermButton, makeStyles, useGlow, useTheme } from "../../../theme";
import { StreakCelebration, StreakMark, saveAndCheckStreak } from "../../../streak";
import { askOnceForReminders } from "../../../lib/reminders";
import { SwitchPanel } from "../../../switches";
import { PictureBuilder, tryPicture } from "../../../picture-builder";

const BAR_LENGTH = 16;

// "30 PRINT X" -> "PRINT X": hides the line numbers that would give away the order
const withoutNumber = (line: string) => line.replace(/^\d+\s+/, "");

// Programs with jumps (GOTO 20, GOSUB 100, THEN 80) need their numbers, or the jumps can't be followed.
// Assembly programs with branches or JMP (BNE LOOP) count as jumps too: there, only the exact order is accepted,
// because many shuffled versions would end the same by accident.
const usesLineNumbers = (lines: string[]) =>
  lines.some(
    (line) =>
      /\b(GOTO|GOSUB|THEN)\s*\d+/i.test(line) ||
      /\b(GO\s*TO\s*\(?\d|DO\s*\d+\s*[A-Z])|\bIF\s*\(.*\)\s*\d+\s*,|\bCALL\b/i.test(line) || // FORTRAN
      /^\s*([A-Z_]\w*:\s*)?(B(EQ|NE|CS|CC|MI|PL|VS|VC)|JMP|JSR)\b/i.test(line)
  );

export default function Lesson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const found = findLessonAnywhere(id);
  const lesson = found?.lesson;
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();

  const [showIntro, setShowIntro] = useState(true); // intro screen before the exercises
  const [index, setIndex] = useState(0); // which exercise we're on
  const [selected, setSelected] = useState<number | null>(null); // tapped option
  const [picked, setPicked] = useState<number[]>([]); // order_lines: tapped lines, in order
  const [checked, setChecked] = useState(false); // has CHECK been pressed?
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]); // exercises answered wrong in this round
  const [orderResult, setOrderResult] = useState<"exact" | "works" | "wrong">("wrong"); // order_lines result
  const [bits, setBits] = useState(0); // switches: the value set on the front panel
  const [pic, setPic] = useState(""); // picture: the PIC clause built so far
  const [streak, setStreak] = useState(0); // daily streak, shown on the finished screen
  const [celebrate, setCelebrate] = useState(false); // the first lesson of the day: big streak moment
  const play = useSound();

  // Save progress once the last exercise is done
  useEffect(() => {
    if (lesson && index >= lesson.exercises.length) {
      play("complete");
      saveAndCheckStreak(() => markDone(lesson.id, lesson.xp, correctCount, lesson.exercises.length)).then(({ progress, earned }) => {
        setStreak(currentStreak(progress));
        if (earned) setCelebrate(true);
      });
    }
  }, [index]);

  // Shuffle the answers once per exercise (a new order every time the lesson is played)
  const prepared = useMemo(
    () => (lesson && index < lesson.exercises.length ? prepareExercise(lesson.exercises[index]) : null),
    [lesson?.id, index]
  );

  if (!lesson) return <Text>Lesson not found</Text>;
  const exercises = lesson.exercises;

  // ----- Intro screen -----
  if (showIntro) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>
            LESSON · {exercises.length} EXERCISES · {lesson.xp} XP
          </Text>
          <Pressable onPress={() => go("/reference")} hitSlop={12} style={{ marginLeft: "auto" }}>
            <Ionicons name="book-outline" size={19} color={t.dim} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.body}>
          <Text style={[s.introTitle, glow]}>{lesson.title}</Text>
          {lesson.intro.map((paragraph, i) => (
            <Text key={i} style={s.introText}>
              {paragraph}
            </Text>
          ))}

          {lesson.example && (
            <>
              <Text style={[s.label, { marginTop: 10 }]}>EXAMPLE</Text>
              <View style={s.codeBox}>
                {lesson.example.code.map((line, i) => (
                  <Text key={i} style={[s.code, glow]}>
                    {line}
                  </Text>
                ))}
              </View>
              {lesson.example.inputs && lesson.example.inputs.length > 0 && (
                <>
                  <Text style={s.label}>{found?.course.lineStyle === "card" ? "DATA CARDS (BEHIND THE PROGRAM)" : found?.course.id === "cobol" ? "SYSIN CARDS (FOR ACCEPT)" : "INPUT"}</Text>
                  <View style={s.codeBox}>
                    {lesson.example.inputs.map((value, i) => (
                      <Text key={i} style={s.code}>
                        {String(value)}
                      </Text>
                    ))}
                  </View>
                </>
              )}
              <Text style={s.label}>OUTPUT</Text>
              <View style={s.outputBox}>
                {lesson.example.output.map((line, i) => (
                  <Text key={i} style={s.code}>
                    {line}
                  </Text>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <View style={s.footer}>
          <TermButton label="START" onPress={() => setShowIntro(false)} />
        </View>
      </SafeAreaView>
    );
  }

  // ----- Finished screen -----
  if (index >= exercises.length) {
    return (
      <SafeAreaView style={s.done}>
        {celebrate && (
          <StreakCelebration
            streak={streak}
            onDone={() => {
              setCelebrate(false);
              askOnceForReminders(); // after the first streak day: offer the daily reminder
            }}
          />
        )}
        <Text style={s.label}>RUN COMPLETE</Text>
        <Text style={[s.doneTitle, glow]}>{lesson.title}</Text>
        <View style={s.doneCard}>
          <Text style={s.doneText}>
            {correctCount}/{exercises.length} correct
          </Text>
          <Text style={[s.doneXp, glow]}>+{lesson.xp} XP</Text>
          {streak > 0 && (
            <View style={s.streakRow}>
              <StreakMark size={18} crackle />
              <Text style={s.streakText}>
                {streak} DAY STREAK
              </Text>
            </View>
          )}
        </View>
        <View style={s.readyRow}>
          <Text style={[s.doneText, glow]}>{t.prompt} </Text>
          <Cursor size={16} />
        </View>
        {wrongIds.length > 0 ? (
          <View style={{ gap: 10 }}>
            <TermButton
              label={`RETRY ${wrongIds.length} MISTAKE${wrongIds.length === 1 ? "" : "S"}`}
              onPress={() => router.replace(`/lesson/${fixMistakesId(wrongIds)}`)}
            />
            <TermButton label="CONTINUE" color={t.dim} onPress={() => router.back()} />
          </View>
        ) : (
          <TermButton label="CONTINUE" onPress={() => router.back()} />
        )}
      </SafeAreaView>
    );
  }

  const ex = exercises[index];
  const isOrder = ex.type === "order_lines";
  const isSwitches = ex.type === "switches"; // Altair: set the toggle switches to a value
  const isPicture = ex.type === "picture"; // COBOL: build a PIC that prints the target text
  const pictureRight = isPicture && tryPicture(pic, ex.value ?? "0") === ex.target;
  // Machine code lines (00 111 110) start with digits, but they aren't line numbers
  const machineCode = found?.course.lineStyle === "octal";

  // Options (shuffled, except for find_bug) and which one is correct
  const options = prepared?.options ?? [];
  const correctIndex = prepared?.correctIndex ?? -1;

  // order_lines: the lines in the order the player tapped them
  const lines = prepared?.lines ?? [];
  const pickedLines = picked.map((i) => lines[i]);
  // Line numbers stay hidden while building. After CHECK, the program is numbered in the player's order.
  // Line numbers are blurred while building (except when reading them is the task) and sharp after CHECK.
  // Programs with jumps keep their real numbers, the others are numbered in the player's order.
  const clearNumbers = !!ex.showNumbers || machineCode;
  const jumps = usesLineNumbers(ex.lines ?? []);
  // Assembly lines have no numbers at all, so they stay as they are
  const lineAfterCheck = (line: string, position: number) =>
    jumps || machineCode || !/^\d+\s/.test(line) ? line : `${(position + 1) * 10} ${withoutNumber(line)}`;

  const isCorrect = isOrder ? orderResult !== "wrong" : isSwitches ? bits === ex.answer : isPicture ? pictureRight : selected === correctIndex;
  const canCheck = isOrder ? picked.length === lines.length : isSwitches ? true : isPicture ? pic !== "" : selected !== null;
  const unsupported = !isOrder && !isSwitches && !isPicture && options.length === 0;
  const showCode = ex.code && ex.type !== "find_bug";

  // Progress bar made of blocks in two shades
  const filled = Math.round((index / exercises.length) * BAR_LENGTH);

  function check() {
    if (!canCheck) return;
    let correct = isSwitches ? bits === ex.answer : isPicture ? pictureRight : selected === correctIndex;
    if (isOrder) {
      const result = checkOrder(found?.course, pickedLines, ex.answer as string[], clearNumbers || jumps);
      setOrderResult(result);
      correct = result !== "wrong";
    }
    setChecked(true);
    play(correct ? "correct" : "wrong");
    recordAnswer(ex.id, correct); // remembered for "Fix your mistakes"
    if (correct) setCorrectCount((c) => c + 1);
    else setWrongIds((w) => (w.includes(ex.id) ? w : [...w, ex.id]));
  }

  function next() {
    setIndex((i) => i + 1);
    setSelected(null);
    setPicked([]);
    setChecked(false);
    setOrderResult("wrong");
    setBits(0);
    setPic("");
  }

  // Tap a line to add it to the program, tap it again to remove it
  function togglePick(lineIndex: number) {
    if (checked) return;
    play("tap");
    setPicked((p) => (p.includes(lineIndex) ? p.filter((x) => x !== lineIndex) : [...p, lineIndex]));
  }

  // Option box and text style per state
  const optionBox = {
    idle: { borderColor: t.line, backgroundColor: t.surface },
    selected: { borderColor: t.green, backgroundColor: t.faint },
    right: { borderColor: t.green, backgroundColor: t.faint },
    wrong: { borderColor: t.red, backgroundColor: t.redFaint },
  };
  const optionText = {
    idle: { color: t.green },
    selected: { color: t.green },
    right: { color: t.green, fontWeight: "700" as const },
    wrong: { color: t.red },
  };

  return (
    <SafeAreaView style={s.screen}>
      {/* Top bar: close + progress */}
      <View style={s.topBar}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={s.close}>✕</Text>
        </Pressable>
        <Text style={s.bar} numberOfLines={1}>
          <Text style={{ color: t.green }}>{"█".repeat(filled)}</Text>
          <Text style={{ color: t.line }}>{"█".repeat(BAR_LENGTH - filled)}</Text>
        </Text>
        <Text style={s.counter}>
          {index + 1}/{exercises.length}
        </Text>
        <Pressable onPress={() => go("/reference")} hitSlop={12}>
          <Ionicons name="book-outline" size={19} color={t.dim} />
        </Pressable>
      </View>

      {/* Question */}
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.label}>{ex.type.replace("_", " ").toUpperCase()}</Text>
        <Text style={s.prompt}>{ex.prompt}</Text>

        {showCode && (
          <View style={s.codeBox}>
            {ex.code!.map((line, i) => (
              <Text key={i} style={[s.code, glow]}>
                {line}
              </Text>
            ))}
          </View>
        )}

        {isOrder ? (
          <>
            {/* The program being built */}
            <Text style={s.label}>YOUR PROGRAM</Text>
            <View style={[s.programBox, checked && { borderColor: isCorrect ? t.green : t.red }]}>
              {picked.length === 0 ? (
                <Text style={s.programHint}>Tap the lines below in the right order.</Text>
              ) : (
                picked.map((lineIndex, position) => (
                  <Pressable
                    key={lineIndex}
                    disabled={checked}
                    onPress={() => togglePick(lineIndex)}
                    style={s.programLine}
                  >
                    {clearNumbers || checked ? (
                      <Text style={[s.code, glow]}>
                        {clearNumbers ? lines[lineIndex] : lineAfterCheck(lines[lineIndex], position)}
                      </Text>
                    ) : (
                      <BlurredNumberLine line={lines[lineIndex]} style={[s.code, glow]} />
                    )}
                  </Pressable>
                ))
              )}
            </View>

            {/* Lines to choose from; used ones leave an empty slot */}
            <Text style={s.label}>AVAILABLE LINES</Text>
            <View style={s.chips}>
              {lines.map((line, i) => {
                const used = picked.includes(i);
                return (
                  <Pressable
                    key={i}
                    disabled={used || checked}
                    onPress={() => togglePick(i)}
                    style={[s.chip, used && s.chipUsed]}
                  >
                    {clearNumbers ? (
                      <Text style={[s.chipText, used && { opacity: 0 }]}>{line}</Text>
                    ) : (
                      <BlurredNumberLine line={line} style={[s.chipText, used && { opacity: 0 }]} hidden={used} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : isSwitches ? (
          <>
            <SwitchPanel value={bits} onChange={setBits} disabled={checked} result={checked ? (isCorrect ? "right" : "wrong") : undefined} />
            {checked && !isCorrect && (
              <>
                <Text style={[s.label, { textAlign: "center" }]}>THE RIGHT SETTING</Text>
                <SwitchPanel value={ex.answer as number} />
              </>
            )}
          </>
        ) : isPicture ? (
          <>
            <PictureBuilder
              value={ex.value ?? "0"}
              target={ex.target ?? ""}
              pic={pic}
              onChange={setPic}
              keys={ex.keys}
              disabled={checked}
              result={checked ? (isCorrect ? "right" : "wrong") : undefined}
            />
            {checked && !isCorrect && (
              <Text style={s.programHint}>
                A RIGHT PICTURE: PIC {String(ex.answer)} shows [{ex.target}]
              </Text>
            )}
          </>
        ) : unsupported ? (
          <Text style={s.programHint}>This exercise type isn't supported yet.</Text>
        ) : (
          options.map((opt, i) => {
            const state = checked
              ? i === correctIndex
                ? "right"
                : selected === i
                  ? "wrong"
                  : "idle"
              : selected === i
                ? "selected"
                : "idle";
            return (
              <Pressable
                key={i}
                disabled={checked}
                onPress={() => {
                  play("tap");
                  setSelected(i);
                }}
                style={[s.option, optionBox[state]]}
              >
                <Text style={[s.optionText, optionText[state]]}>{opt}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Bottom: feedback + button */}
      <View style={[s.footer, checked && { backgroundColor: isCorrect ? t.faint : t.redFaint }]}>
        {checked && (
          <>
            <View style={s.feedbackRow}>
              <Text style={[s.feedbackTitle, { color: isCorrect ? t.green : t.red }]}>
                {isCorrect ? "✓ Correct" : "✗ Not quite"}
              </Text>
              <Text style={[s.feedbackTag, { color: isCorrect ? t.dim : t.red }]}>
                {isCorrect ? t.prompt : t.errorTag}
              </Text>
            </View>
            {isOrder && orderResult === "works" && (
              <Text style={s.feedbackNote}>Different order, same result. That works too.</Text>
            )}
            <Text style={s.feedbackText}>{ex.explanation}</Text>

            {/* For a wrong order, show the correct program */}
            {isOrder && !isCorrect && (
              <View style={s.answerBox}>
                {(ex.answer as string[]).map((line, i) => (
                  <Text key={i} style={s.answerText}>
                    {line}
                  </Text>
                ))}
              </View>
            )}
          </>
        )}

        {unsupported ? (
          <TermButton label="SKIP" onPress={next} />
        ) : !checked ? (
          <TermButton label="CHECK" onPress={check} disabled={!canCheck} />
        ) : (
          <TermButton label="CONTINUE" onPress={next} color={isCorrect ? t.green : t.red} />
        )}
      </View>
    </SafeAreaView>
  );
}

// A program line whose line number is blurred: you can see that a number is there, but not read it.
// The number is drawn 48 times, very transparent, spread over a small disc (a sunflower spiral).
// The copies add up to a soft blur with faded edges. Unlike real blur effects, this looks the same on every phone.
const BLUR_COPIES = 48;
const BLUR_RADIUS = 7; // how far the copies spread, in points
const BLUR_STRENGTH = 0.2; // opacity of the copies in the middle; they fade out towards the edge

const BLUR_OFFSETS = Array.from({ length: BLUR_COPIES }, (_, i) => {
  const r = BLUR_RADIUS * Math.sqrt((i + 0.5) / BLUR_COPIES);
  const angle = i * Math.PI * (3 - Math.sqrt(5)); // golden angle: spreads the copies evenly
  const sigma = BLUR_RADIUS / 2;
  return {
    left: Math.cos(angle) * r,
    top: Math.sin(angle) * r,
    opacity: BLUR_STRENGTH * Math.exp(-(r * r) / (2 * sigma * sigma)),
  };
});

const BlurredNumberLine = memo(
  function BlurredNumberLine({ line, style, hidden = false }: { line: string; style: any; hidden?: boolean }) {
    const match = line.match(/^(\d+)(\s+)([\s\S]*)$/);
    if (!match) return <Text style={style}>{line}</Text>;
    return (
      <View style={[blurStyles.row, hidden && { opacity: 0 }]}>
        <View>
          {/* Invisible copy that gives the number its normal width */}
          <Text style={[style, blurStyles.invisible]}>{match[1]}</Text>
          {BLUR_OFFSETS.map((o, i) => (
            <Text key={i} style={[style, blurStyles.copy, o]}>
              {match[1]}
            </Text>
          ))}
        </View>
        <Text style={[style, { flexShrink: 1 }]}> {match[3]}</Text>
      </View>
    );
  },
  // Only redraw when the line or its visibility changes (keeps tapping fast)
  (a, b) => a.line === b.line && a.hidden === b.hidden
);

const blurStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  invisible: { opacity: 0 },
  copy: { position: "absolute", textShadowRadius: 0 },
});

// ---------- Checking "order the lines" ----------

// Answers for programs with INPUT while checking
const TEST_INPUTS = [7, 3, 5, 2, 9];

// While checking, RND gives the same "random" numbers in both runs, so dice programs can be compared
function withFixedRandom<T>(run: () => T, startSeed = 12345): T {
  const original = Math.random;
  let seed = startSeed;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  try {
    return run();
  } finally {
    Math.random = original;
  }
}

// "exact": same order as the answer. "works": different order, but the program does exactly the same.
function checkOrder(
  course: Course | undefined,
  picked: string[],
  answer: string[],
  keepNumbers: boolean
): "exact" | "works" | "wrong" {
  if (JSON.stringify(picked) === JSON.stringify(answer)) return "exact";
  // With visible numbers (jumps), the order of the lines is the point, so only the exact order counts
  if (keepNumbers || !course) return "wrong";
  // Comments (REM) don't change what a program does, but they belong where they were written
  const isRem = (line: string) => /^(REM\b|;)/i.test(withoutNumber(line).trim()) || /^[C*](\s|$)/.test(line); // FORTRAN: C in column 1
  if (answer.some((line, i) => isRem(line) && picked[i] !== line)) return "wrong";

  // Number the lines in the tapped order (10, 20, 30 …) and run both programs.
  // Assembly has no line numbers: there the lines run in the order they're listed.
  const hasNumbers = answer.every((l) => /^\d+\s/.test(l));
  const numbered = (lines: string[]) =>
    lines.map((l, i) => (hasNumbers ? `${(i + 1) * 10} ${withoutNumber(l)}` : l)).join("\n");
  // Assembly: registers, flags and memory must end up the same too, once with the carry at 0 and once at 1
  // Only the carry counts among the flags: N and Z just describe whichever instruction happened to run last.
  const machine = (r: RunResult) =>
    JSON.stringify(r.machine ? { ...r.machine, steps: 0, flags: { c: r.machine.flags.c } } : null);
  for (const powerOn of [0, 1]) {
    // A different seed per round, so the leftover bytes in memory are different too
    const seed = powerOn === 0 ? 12345 : 98765;
    const mine = withFixedRandom(() => course.run(numbered(picked), TEST_INPUTS, { powerOn }), seed);
    const theirs = withFixedRandom(() => course.run(numbered(answer), TEST_INPUTS, { powerOn }), seed);
    // A snippet that doesn't run on its own (a piece of a C function, say) can't be compared: only the exact order counts
    if (theirs.error) return "wrong";
    if (mine.output !== theirs.output || mine.error !== theirs.error || machine(mine) !== machine(theirs)) return "wrong";
  }
  return "works";
}

// Prepare an exercise for display: shuffled answers, with the correct one tracked by its text
function prepareExercise(ex: Exercise) {
  const none: string[] = [];

  if (ex.type === "multiple_choice" || ex.type === "fill_blank") {
    const original = ex.options ?? [];
    const correctText = ex.type === "multiple_choice" ? original[ex.answer as number] : (ex.answer as string);
    const options = shuffle(original);
    return { options, correctIndex: options.indexOf(correctText), lines: none };
  }

  if (ex.type === "find_bug") {
    // Code lines must stay in their real order
    return { options: ex.code ?? [], correctIndex: ex.answer as number, lines: none };
  }

  if (ex.type === "order_lines") {
    const original = ex.lines ?? [];
    let lines = shuffle(original);
    // Make sure the lines don't already start in the right order
    for (let tries = 0; tries < 10 && JSON.stringify(lines) === JSON.stringify(ex.answer); tries++) {
      lines = shuffle(original);
    }
    return { options: none, correctIndex: -1, lines };
  }

  return { options: none, correctIndex: -1, lines: none };
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    topBar: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingTop: 8 },
    close: { fontSize: 20, color: t.dim },
    bar: { flex: 1, fontFamily: t.mono, fontSize: 12, letterSpacing: -1 },
    counter: { fontFamily: t.mono, fontSize: 13, color: t.dim },
    body: { padding: 20, gap: 10 },
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },

    // Intro
    introTitle: { fontFamily: t.mono, fontSize: 26, fontWeight: "700", color: t.green, marginBottom: 6 },
    introText: { fontFamily: t.mono, fontSize: 15, lineHeight: 23, color: t.green, opacity: 0.9, marginBottom: 4 },
    outputBox: {
      backgroundColor: t.bg,
      borderRadius: t.soft,
      borderWidth: 1,
      borderColor: t.line,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },

    // Exercise
    prompt: { fontFamily: t.mono, fontSize: 17, lineHeight: 25, fontWeight: "600", color: t.green, marginBottom: 8 },
    codeBox: {
      backgroundColor: t.surface,
      borderRadius: t.soft,
      borderLeftWidth: 3,
      borderLeftColor: t.green,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 10,
    },
    code: { fontFamily: t.mono, fontSize: 15, lineHeight: 23, color: t.green },
    option: { borderWidth: 1.5, borderRadius: t.soft, paddingVertical: 15, paddingHorizontal: 16 },
    optionText: { fontFamily: t.mono, fontSize: 15 },

    // Order the lines
    programBox: {
      minHeight: 120,
      backgroundColor: t.bg,
      borderRadius: t.soft,
      borderWidth: 1.5,
      borderColor: t.line,
      borderStyle: "dashed",
      padding: 10,
      gap: 6,
      marginBottom: 10,
    },
    programLine: { backgroundColor: t.surface, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
    programHint: { fontFamily: t.mono, fontSize: 13, color: t.dim, textAlign: "center", marginTop: 40 },
    chips: { gap: 8 },
    chip: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    chipUsed: { backgroundColor: "transparent", borderStyle: "dashed" },
    chipText: { fontFamily: t.mono, fontSize: 15, color: t.green },

    // Feedback
    footer: { padding: 20, borderTopWidth: 1, borderTopColor: t.line },
    feedbackRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
    feedbackTitle: { fontFamily: t.mono, fontSize: 18, fontWeight: "700" },
    feedbackTag: { fontFamily: t.mono, fontSize: 12, letterSpacing: 1 },
    feedbackNote: { fontFamily: t.mono, fontSize: 13, color: t.green, marginBottom: 6 },
    feedbackText: { fontFamily: t.mono, fontSize: 14, lineHeight: 21, color: t.green, opacity: 0.8, marginBottom: 16 },
    answerBox: { backgroundColor: t.bg, borderRadius: 8, padding: 12, marginTop: -6, marginBottom: 16 },
    answerText: { fontFamily: t.mono, fontSize: 13, lineHeight: 20, color: t.green },

    // Finished
    done: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: t.bg },
    doneTitle: { fontFamily: t.mono, fontSize: 26, fontWeight: "700", color: t.green, marginTop: 6, marginBottom: 20 },
    doneCard: { backgroundColor: t.surface, borderRadius: t.soft, borderWidth: 1, borderColor: t.line, padding: 20, gap: 6 },
    doneText: { fontFamily: t.mono, fontSize: 16, color: t.green },
    streakRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    streakText: { fontFamily: t.mono, fontSize: 14, fontWeight: "700", color: t.amber, letterSpacing: 1 },
    doneXp: { fontFamily: t.mono, fontSize: 28, fontWeight: "700", color: t.green },
    readyRow: { flexDirection: "row", alignItems: "center", marginTop: 24, marginBottom: 24 },
  })
);
