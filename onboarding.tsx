import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Pressable } from "./press";
import { SafeAreaView } from "react-native-safe-area-context";
import { CourseCard } from "./course-card";
import { useCourse } from "./lib/active-course";
import { courses } from "./lib/courses";
import { finishOnboarding } from "./lib/onboarding";
import { remindersSupported, setReminderChoice } from "./lib/reminders";
import { loadName } from "./lib/stats";
import { sound } from "./sounds";
import { Cursor, TermButton, makeStyles, useGlow, useTheme } from "./theme";

// The first-start introduction, right after creating an account:
// 1. what the app is, 2. pick the first machine, 3. how learning works (and the daily reminder)
export function Onboarding() {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const { course, setCourseId } = useCourse();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [remind, setRemind] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadName().then(setName);
  }, []);

  function next() {
    sound("open");
    setStep((n) => n + 1);
  }

  async function start() {
    setBusy(true);
    if (remindersSupported) await setReminderChoice(remind);
    sound("complete");
    await finishOnboarding();
  }

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.column}>
          {/* Step dots */}
          <View style={s.dots}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[s.dot, i === step && s.dotOn, i < step && s.dotDone]} />
            ))}
          </View>

          {step === 0 && (
            <>
              <Text style={s.label}>WELCOME{name ? `, ${name}` : ""}</Text>
              <Text style={[s.title, glow]}>Learn to code the way it began.</Text>
              <Text style={s.text}>
                basic-lingo teaches real programming languages from computer history. Every course looks, sounds and works like the
                machine it ran on: punch cards, a teletype, a circuit board with LEDs.
              </Text>

              {/* A little timeline of the three courses */}
              <View style={s.timeline}>
                {[...courses]
                  .sort((a, b) => a.year - b.year)
                  .map((c, i, list) => (
                    <View key={c.id} style={s.timelineRow}>
                      <View style={s.timelineLeft}>
                        <View style={[s.timelineDot, { backgroundColor: c.theme.button === "key" ? "#FF3B2F" : t.amber }]} />
                        {i < list.length - 1 && <View style={s.timelineLine} />}
                      </View>
                      <View style={{ flex: 1, paddingBottom: 14 }}>
                        <Text style={s.timelineYear}>{c.year}</Text>
                        <Text style={s.timelineTitle}>{c.title}</Text>
                        <Text style={s.timelineText}>{c.machine}</Text>
                      </View>
                    </View>
                  ))}
              </View>

              <Text style={s.text}>The ideas you learn here are the same ones inside every modern language.</Text>
              <View style={{ marginTop: 22 }}>
                <TermButton label="NEXT" onPress={next} />
              </View>
            </>
          )}

          {step === 1 && (
            <>
              <Text style={s.label}>STEP 2 OF 3</Text>
              <Text style={[s.title, glow]}>Where do you want to start?</Text>
              <Text style={s.text}>You can switch any time from the menu. Your progress in each course is kept.</Text>
              {courses
                .filter((c) => c.available)
                .map((c) => (
                  <CourseCard
                    key={c.id}
                    course={c}
                    active={c.id === course.id}
                    xp={0}
                    selectable
                    note={c.id === "basic" ? "★ NEW TO PROGRAMMING? START HERE." : undefined}
                    onPress={() => {
                      setCourseId(c.id);
                      sound("toggle");
                    }}
                  />
                ))}
              <View style={{ marginTop: 22 }}>
                <TermButton label={`START WITH ${course.title.toUpperCase()}`} onPress={next} />
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.label}>STEP 3 OF 3</Text>
              <Text style={[s.title, glow]}>How it works</Text>

              {[
                { icon: "book-outline" as const, title: "Lessons", text: "A few minutes each: a short story, an example, then exercises." },
                { icon: "refresh-outline" as const, title: "Review", text: "After each unit, the questions you got wrong come back." },
                { icon: "trophy-outline" as const, title: "Quests & projects", text: "Write a real program that the app runs and checks." },
                { icon: "flash" as const, title: "Daily streak", text: "One lesson a day keeps your streak going." },
                { icon: "code-slash-outline" as const, title: "Sandbox", text: "Write anything you like, and share it with others." },
              ].map((item) => (
                <View key={item.title} style={s.howRow}>
                  <View style={s.howIcon}>
                    <Ionicons name={item.icon} size={18} color={t.button === "bracket" ? t.bg : t.keyText} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.howTitle}>{item.title}</Text>
                    <Text style={s.howText}>{item.text}</Text>
                  </View>
                </View>
              ))}

              {remindersSupported && (
                <Pressable onPress={() => setRemind(!remind)} style={s.remindBox}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.howTitle}>Daily reminder</Text>
                    <Text style={s.howText}>A short note at 19:00 if you haven't learned yet that day. Change it later in the settings.</Text>
                  </View>
                  <Switch value={remind} onValueChange={setRemind} trackColor={{ true: t.amber, false: t.line }} />
                </Pressable>
              )}

              <View style={{ marginTop: 22 }}>
                <TermButton label={busy ? "…" : "LET'S GO"} onPress={start} disabled={busy} />
              </View>
              <View style={s.readyRow}>
                <Text style={[s.ready, glow]}>{t.prompt} </Text>
                <Cursor size={14} />
              </View>
            </>
          )}

          {step > 0 && (
            <Pressable onPress={() => setStep((n) => n - 1)} hitSlop={8} style={{ alignSelf: "center", marginTop: 16 }}>
              <Text style={s.back}>‹ BACK</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { flexGrow: 1, justifyContent: "center", padding: 24, paddingBottom: 60 },
    column: { width: "100%", maxWidth: 520, alignSelf: "center" },
    dots: { flexDirection: "row", gap: 6, marginBottom: 22 },
    dot: { width: 22, height: 4, borderRadius: 2, backgroundColor: t.line },
    dotOn: { backgroundColor: t.amber, width: 34 },
    dotDone: { backgroundColor: t.green },
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    title: { fontFamily: t.mono, fontSize: 26, fontWeight: "700", color: t.green, marginTop: 8, lineHeight: 34 },
    text: { fontFamily: t.mono, fontSize: 13, lineHeight: 20, color: t.green, opacity: 0.85, marginTop: 14 },

    timeline: { marginTop: 22 },
    timelineRow: { flexDirection: "row", gap: 14 },
    timelineLeft: { alignItems: "center", width: 14 },
    timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
    timelineLine: { width: 2, flex: 1, backgroundColor: t.line, marginTop: 2 },
    timelineYear: { fontFamily: t.mono, fontSize: 11, color: t.amber, letterSpacing: 1.5 },
    timelineTitle: { fontFamily: t.mono, fontSize: 17, fontWeight: "700", color: t.green, marginTop: 2 },
    timelineText: { fontFamily: t.mono, fontSize: 12, color: t.dim, marginTop: 2 },

    howRow: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginTop: 16 },
    howIcon: {
      width: 34,
      height: 34,
      borderRadius: t.soft,
      backgroundColor: t.button === "bracket" ? t.green : t.keyFace,
      alignItems: "center",
      justifyContent: "center",
    },
    howTitle: { fontFamily: t.mono, fontSize: 14, fontWeight: "700", color: t.green },
    howText: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green, opacity: 0.8, marginTop: 2 },
    remindBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 22,
      padding: 14,
      borderWidth: 1.5,
      borderColor: t.amber,
      borderRadius: t.soft,
      backgroundColor: t.surface,
    },
    readyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 16 },
    ready: { fontFamily: t.mono, fontSize: 14, color: t.green },
    back: { fontFamily: t.mono, fontSize: 12, color: t.dim, letterSpacing: 1 },
  })
);
