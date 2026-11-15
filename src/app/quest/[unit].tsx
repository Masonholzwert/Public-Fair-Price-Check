import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Course, QuestData, RunResult } from "../../../lib/course";
import { courseById, courses } from "../../../lib/courses";
import { Challenge, difficultyStars, findChallenge } from "../../../lib/practice";
import { QuestCase, describeExpect, describeMemory, expectProblems } from "../../../lib/asm6502";
import { currentStreak, markDone } from "../../../lib/progress";
import { StreakCelebration, saveAndCheckStreak } from "../../../streak";
import { askOnceForReminders } from "../../../lib/reminders";
import { dailyBonus, dailyKey, dailyStreak, formatTime, startDailyClock, submitDaily } from "../../../lib/daily";
import { loadProgress } from "../../../lib/progress";
import { MachinePanel } from "../../../led";
import { StepView } from "../../../stepper";
import { go, goBack, useSound } from "../../../sounds";
import { TermButton, makeStyles, useGlow, useTheme } from "../../../theme";

// Unit quests and chapter projects come from each course, practice challenges from practice.json
function findQuest(id: string): { quest: QuestData; course: Course; challenge: Challenge | null } | null {
  const found = findChallenge(id);
  if (found) return { quest: found.challenge, course: found.course, challenge: found.challenge };
  for (const course of courses) {
    if (course.quests[id]) return { quest: course.quests[id], course, challenge: null };
  }
  return null;
}

// The iPhone keyboard turns " into “ ” and - into – on its own. BASIC only knows the plain ones.
const plainQuotes = (text: string) =>
  text.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'").replace(/[–—−]/g, "-");

// Compare outputs without caring about extra spaces or empty lines.
// With exact = true, spaces at the start of a line count (needed for drawings).
function normalize(text: string, exact = false) {
  return text
    .replace(/^\n+|\s+$/g, "")
    .split("\n")
    .map((line) => (exact ? line.replace(/\s+$/, "") : line.trim().replace(/\s+/g, " ")))
    .join("\n");
}

export default function QuestScreen() {
  // daily: "2026-11-14" when this is that day's daily challenge (opened from the Daily screen)
  const { unit, daily } = useLocalSearchParams<{ unit: string; daily?: string }>();
  const found = findQuest(unit);
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();

  const [code, setCode] = useState(found?.quest.starter ?? "");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [hintIndex, setHintIndex] = useState(-1); // -1 = no hint shown yet
  const [solved, setSolved] = useState(false);
  const [celebrateStreak, setCelebrateStreak] = useState(0); // the first quest of the day: big streak moment
  const [showExpected, setShowExpected] = useState(false);
  const [failedCase, setFailedCase] = useState<QuestCase | null>(null); // assembly: the test that went wrong
  const play = useSound();
  const [stepping, setStepping] = useState(false); // 6502: step mode instead of the editor

  // Daily challenge: a clock that started when you first opened it today, and how many RUNs and hints you used
  const [dailyStart, setDailyStart] = useState<number | null>(null);
  const [dailyAlreadySolved, setDailyAlreadySolved] = useState(false);
  const [now, setNow] = useState(Date.now());
  const runs = useRef(0);
  const hintsUsed = useRef(0);
  useEffect(() => {
    if (!daily) return;
    loadProgress().then((p) => {
      if (p.done[dailyKey(daily)]) setDailyAlreadySolved(true);
      else startDailyClock(daily).then(setDailyStart);
    });
  }, [daily]);
  const clockRunning = !!daily && dailyStart !== null && !solved && !dailyAlreadySolved;
  useEffect(() => {
    if (!clockRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [clockRunning]);

  // After RUN: the "running" sound first, then a sound for the result
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => play(message.ok ? "complete" : "wrong"), 350);
    return () => clearTimeout(timer);
  }, [message]);

  if (!found) return <Text>Quest not found</Text>;
  const { quest, course, challenge } = found;

  // Assembly quests check the registers and memory, sometimes in several tests with different starting values
  const cases: QuestCase[] | null = quest.cases ?? (quest.expect ? [{ expect: quest.expect }] : null);

  function run() {
    runs.current++;
    Keyboard.dismiss();
    play("run");
    setShowExpected(false);
    setFailedCase(null);
    if (cases) {
      runCases(cases);
      return;
    }
    const result = course.run(plainQuotes(code), quest.inputs ?? []);
    setRunResult(result);

    // 1. Did it run without errors?
    if (result.error) {
      setMessage({ text: "Your program stopped with an error. Fix it and RUN again.", ok: false });
      return;
    }
    // 2. Is the output right?
    if (normalize(result.output, quest.exact) !== normalize(quest.expectedOutput, quest.exact)) {
      setShowExpected(true);
      setMessage({
        text: quest.exact
          ? "The program ran, but the output doesn't match the expected output yet. Check the spaces at the start of each line too."
          : "The program ran, but the output doesn't match the expected output yet.",
        ok: false,
      });
      return;
    }
    checkStyle();
  }

  // Run the program once per test. Stop at the first test that goes wrong and show that one.
  function runCases(list: QuestCase[]) {
    for (let i = 0; i < list.length; i++) {
      const test = list[i];
      const result = course.run(plainQuotes(code), [], { memory: test.memory, keys: test.keys });
      setRunResult(result);
      // "Test 2 of 3 (starting with $0300 = $05)" when there are several tests
      const which =
        list.length > 1
          ? `Test ${i + 1} of ${list.length}${test.memory ? ` (starting with ${describeMemory(test.memory)})` : ""}${
              test.keys ? ` (keys ${test.keys.split("").join(" ")})` : ""
            }`
          : "";
      if (result.error) {
        setFailedCase(test);
        setMessage({ text: which ? `${which}: your program stopped with an error.` : "Your program stopped with an error.", ok: false });
        return;
      }
      const problems = expectProblems(result.machine, test.expect);
      // Teletype quests also compare what was printed
      const wantedOutput = test.output ?? quest.expectedOutput;
      if (wantedOutput !== "" && normalize(result.output) !== normalize(wantedOutput)) {
        problems.unshift("The teletype output doesn't match yet.");
      }
      if (problems.length > 0) {
        setFailedCase(test);
        setShowExpected(true);
        setMessage({ text: `${which ? `${which}: the` : "The"} result isn't right yet. ${problems[0]}`, ok: false });
        return;
      }
    }
    checkStyle();
  }

  // The result is right. Now: short enough, and solved the intended way?
  function checkStyle() {
    // Short enough? (forces loops instead of copy-paste)
    const lineCount = code.split("\n").filter((l) => l.trim() !== "").length;
    if (quest.maxLines && lineCount > quest.maxLines) {
      setMessage({
        text: `It works, but use at most ${quest.maxLines} lines. Try a loop instead of repeating lines.`,
        ok: false,
      });
      return;
    }
    // 3. Did they solve it the intended way?
    for (const req of quest.requirements) {
      if (!new RegExp(req.pattern, "im").test(code)) {
        setMessage({ text: req.message, ok: false });
        return;
      }
    }

    setSolved(true);
    const id = unit.endsWith("-project") || challenge ? unit : `${unit}-quest`;
    // Daily challenge: a bonus on top, and the time goes to today's leaderboard
    if (daily && dailyStart !== null && !dailyAlreadySolved) {
      const seconds = Math.round((Date.now() - dailyStart) / 1000);
      loadProgress().then((before) => {
        const bonus = dailyBonus(dailyStreak(before, daily));
        setMessage({ text: `Daily challenge solved in ${formatTime(seconds)}! +${quest.xp} XP · daily bonus +${bonus} XP`, ok: true });
        submitDaily(daily, unit, course.id, seconds, runs.current, hintsUsed.current).catch(() => {});
        saveAndCheckStreak(async () => {
          await markDone(id, quest.xp);
          await markDone(dailyKey(daily), bonus);
        }).then(({ progress, earned }) => {
          if (earned) setCelebrateStreak(currentStreak(progress));
        });
      });
      return;
    }
    setMessage({ text: `Quest complete! +${quest.xp} XP`, ok: true });
    // Projects and challenges are saved under their own id, unit quests as "u1-quest" etc.
    saveAndCheckStreak(() => markDone(id, quest.xp)).then(
      ({ progress, earned }) => {
        if (earned) setCelebrateStreak(currentStreak(progress));
      }
    );
  }

  function nextHint() {
    if (hintIndex < quest.hints.length - 1) hintsUsed.current++;
    setHintIndex((i) => Math.min(i + 1, quest.hints.length - 1));
  }

  const original = challenge?.source && challenge.from ? courseById(challenge.from) : undefined;
  const kind = daily
    ? "☀ DAILY CHALLENGE"
    : original
    ? `⇄ TRANSLATE · ${difficultyStars(challenge!.difficulty)}`
    : challenge
    ? `✦ CHALLENGE · ${difficultyStars(challenge.difficulty)}`
    : unit.endsWith("-project")
      ? "🏆 CHAPTER PROJECT"
      : "★ QUEST";

  return (
    <SafeAreaView style={s.screen}>
      {celebrateStreak > 0 && (
        <StreakCelebration
          streak={celebrateStreak}
          onDone={() => {
            setCelebrateStreak(0);
            askOnceForReminders();
          }}
        />
      )}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Top bar */}
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>
            {kind} · {quest.xp} XP
          </Text>
          {daily && dailyStart !== null && !dailyAlreadySolved && (
            <Text style={[s.label, { color: t.amber }]}>⏱ {formatTime(Math.max(0, Math.round((now - dailyStart) / 1000)))}</Text>
          )}
          <Pressable onPress={() => go("/reference")} hitSlop={12} style={{ marginLeft: "auto" }}>
            <Ionicons name="book-outline" size={19} color={t.dim} />
          </Pressable>
        </View>

        {stepping ? (
          <StepView
            code={plainQuotes(code)}
            memory={cases?.[0]?.memory}
            keys={cases?.[0]?.keys}
            onExit={() => setStepping(false)}
          />
        ) : (
        <>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {/* Story and task */}
          <Text style={[s.title, glow]}>{quest.title}</Text>
          {quest.story && <Text style={s.story}>{quest.story}</Text>}

          <View style={s.taskBox}>
            <Text style={s.label}>YOUR TASK</Text>
            <Text style={s.task}>{quest.task}</Text>
          </View>

          {/* Translations: the original program, and what it does */}
          {original && challenge?.source && (
            <View style={s.inputBox}>
              <Text style={s.label}>
                THE ORIGINAL · {original.title.toUpperCase()} ({original.year})
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text style={s.sourceCode}>{challenge.source}</Text>
              </ScrollView>
              {challenge.sourceOutput ? (
                <>
                  <Text style={[s.label, { marginTop: 10 }]}>IT PRINTS</Text>
                  <Text style={s.sourceCode}>{challenge.sourceOutput}</Text>
                </>
              ) : null}
              {challenge.sourceNote ? (
                <Text style={[s.label, { marginTop: 10 }]}>{challenge.sourceNote.toUpperCase()}</Text>
              ) : null}
            </View>
          )}

          {/* Assembly: the values the program is tested with */}
          {quest.cases && quest.cases.some((c) => c.memory || c.keys) && (
            <View style={s.inputBox}>
              <Text style={s.label}>TEST VALUES</Text>
              <Text style={s.task}>
                Your program runs {quest.cases.length} times, each time with other values:
              </Text>
              {quest.cases.map((c, i) => (
                <Text key={i} style={s.task}>
                  {i + 1}. {[c.memory && describeMemory(c.memory), c.keys && `keys typed: ${c.keys.split("").join(" ")}`]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              ))}
            </View>
          )}

          {/* Test inputs for programs that use INPUT */}
          {quest.inputs && quest.inputs.length > 0 && (
            <View style={s.inputBox}>
              {course.lineStyle === "card" || course.id === "cobol" ? (
                <>
                  <Text style={s.label}>{course.id === "cobol" ? "SYSIN CARDS" : "DATA CARDS"}</Text>
                  <Text style={s.task}>{course.id === "cobol" ? "These cards come after your job; each ACCEPT reads the next one:" : "These cards go into the reader behind your program, one per line:"}</Text>
                  {quest.inputs.map((card, i) => (
                    <Text key={i} style={[s.task, { fontFamily: t.mono }]}>
                      {String(card)}
                    </Text>
                  ))}
                </>
              ) : (
                course.id === "altair" ? (
                <>
                  <Text style={s.label}>SENSE SWITCHES</Text>
                  <Text style={s.task}>Each IN 377 reads the next setting: {quest.inputs.map(String).join(", ")}</Text>
                </>
              ) : (
                <>
                  <Text style={s.label}>TEST INPUT</Text>
                  <Text style={s.task}>When your program asks with INPUT, the app types: {quest.inputs.join(", ")}</Text>
                </>
              ))}
            </View>
          )}

          {/* Code editor */}
          <Text style={s.label}>PROGRAM</Text>
          <TextInput
            style={s.editor}
            value={code}
            onChangeText={(text: string) => setCode(plainQuotes(text))}
            multiline
            autoCapitalize={course.id === "c" || course.id === "pascal" || course.id === "altair" ? "none" : "characters"}
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
            placeholder={course.editorHint ?? "20 LET P = ..."}
            placeholderTextColor={t.dim}
          />

          {/* Hint */}
          {hintIndex >= 0 && (
            <View style={s.hintBox}>
              <Text style={s.label}>
                HINT {hintIndex + 1}/{quest.hints.length}
              </Text>
              <Text style={s.task}>{quest.hints[hintIndex]}</Text>
            </View>
          )}

          {/* Output console. Assembly programs print on the teletype, so it only shows when they printed something. */}
          {runResult && (!runResult.machine || runResult.output !== "" || runResult.error) && (
            <View style={s.console}>
              <Text style={s.label}>{runResult.machine ? "TELETYPE" : "OUTPUT"}</Text>
              {runResult.output !== "" && (
                <Text style={[s.consoleText, glow]}>{runResult.output.replace(/\n$/, "")}</Text>
              )}
              {runResult.error && <Text style={[s.consoleText, { color: t.red }]}>{runResult.error}</Text>}
              {!runResult.error && runResult.output === "" && <Text style={s.label}>(NO OUTPUT)</Text>}
            </View>
          )}

          {/* Assembly: the registers and memory after the program stopped */}
          {runResult?.machine && <MachinePanel machine={runResult.machine} />}

          {/* What the result should look like, shown when it doesn't match */}
          {showExpected && (
            <View style={s.console}>
              <Text style={s.label}>{cases ? "EXPECTED RESULT" : "EXPECTED OUTPUT"}</Text>
              {failedCase?.memory && (
                <Text style={[s.consoleText, { opacity: 0.75 }]}>Starting with {describeMemory(failedCase.memory)}:</Text>
              )}
              {failedCase?.keys && (
                <Text style={[s.consoleText, { opacity: 0.75 }]}>Keys typed: {failedCase.keys.split("").join(" ")}</Text>
              )}
              {(failedCase?.output ?? quest.expectedOutput) !== "" && (
                <Text style={[s.consoleText, { opacity: 0.75 }]}>{failedCase?.output ?? quest.expectedOutput}</Text>
              )}
              {failedCase && describeExpect(failedCase.expect).length > 0 && (
                <Text style={[s.consoleText, { opacity: 0.75 }]}>{describeExpect(failedCase.expect).join("\n")}</Text>
              )}
            </View>
          )}

          {/* Result message */}
          {message && (
            <Text style={[s.message, { color: message.ok ? t.green : t.red }, message.ok && glow]}>{message.text}</Text>
          )}
        </ScrollView>

        {/* Buttons */}
        <View style={s.footer}>
          {solved ? (
            <TermButton label="FINISH" onPress={() => router.back()} />
          ) : (
            <View style={s.buttonRow}>
              <View style={{ flex: 1 }}>
                <TermButton label="HINT" color={t.dim} onPress={nextHint} />
              </View>
              {course.canStep && (
                <View style={{ flex: 1 }}>
                  <TermButton
                    label="STEP"
                    color={t.dim}
                    onPress={() => {
                      Keyboard.dismiss();
                      setStepping(true);
                    }}
                  />
                </View>
              )}
              <View style={{ flex: 2 }}>
                <TermButton label="RUN" onPress={run} />
              </View>
            </View>
          )}
        </View>
        </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    topBar: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingTop: 8 },
    close: { fontSize: 20, color: t.dim },
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    body: { padding: 20, gap: 12 },
    title: { fontFamily: t.mono, fontSize: 24, fontWeight: "700", color: t.green },
    story: { fontFamily: t.mono, fontSize: 14, lineHeight: 21, color: t.green, opacity: 0.8 },
    taskBox: {
      backgroundColor: t.surface,
      borderRadius: t.soft,
      borderLeftWidth: 3,
      borderLeftColor: t.green,
      padding: 16,
      gap: 6,
      marginVertical: 6,
    },
    inputBox: {
      backgroundColor: t.amberFaint,
      borderRadius: t.soft,
      borderLeftWidth: 3,
      borderLeftColor: t.amber,
      padding: 14,
      gap: 6,
    },
    task: { fontFamily: t.mono, fontSize: 15, lineHeight: 22, color: t.green },
    editor: {
      minHeight: 180,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      padding: 14,
      fontFamily: t.mono,
      fontSize: 16,
      lineHeight: 24,
      color: t.green,
    },
    hintBox: { backgroundColor: t.faint, borderRadius: t.soft, padding: 14, gap: 6 },
    console: { backgroundColor: t.bg, borderRadius: t.soft, borderWidth: 1, borderColor: t.line, padding: 14, gap: 6 },
    consoleText: { fontFamily: t.mono, fontSize: 15, lineHeight: 22, color: t.green },
    sourceCode: { fontFamily: t.mono, fontSize: 13, lineHeight: 19, color: t.green, marginTop: 6 },
    message: { fontFamily: t.mono, fontSize: 15, fontWeight: "600", lineHeight: 22 },
    footer: { padding: 20, borderTopWidth: 1, borderTopColor: t.line },
    buttonRow: { flexDirection: "row", gap: 10 },
  })
);
