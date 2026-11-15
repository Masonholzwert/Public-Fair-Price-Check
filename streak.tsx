import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./press";
import { Progress, currentStreak, dayKey, lastWeek, learnedToday, loadProgress } from "./lib/progress";
import { sound } from "./sounds";
import { makeStyles, useAmberGlow, useTheme } from "./theme";

// Red seven-segment LEDs for the circuit board look
const LED_ON = "#FF3B2F";
const LED_OFF = "#3A0E0B";
const LED_GLOW = { textShadowColor: "rgba(255, 59, 47, 0.8)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 };

// The day the celebration was last shown, so it plays once per day
const CELEBRATED_KEY = "basic-lingo-streak-celebrated";

// The streak symbol: the same lightning bolt in every course.
// Lit (amber) on days you learned, an outline when there's no streak yet.
// With `crackle`, a lit bolt flickers every few seconds, like electricity.
export function StreakMark({ size = 20, lit = true, onLight = false, crackle = false }: { size?: number; lit?: boolean; onLight?: boolean; crackle?: boolean }) {
  const t = useTheme();
  const color = onLight ? t.bg : lit ? t.amber : t.dim;
  const glow = useRef(new Animated.Value(1)).current;
  const zap = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!crackle || !lit) return;
    const flicker = (to: number, ms: number) => Animated.timing(glow, { toValue: to, duration: ms, useNativeDriver: true });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(2600),
        Animated.parallel([
          Animated.sequence([flicker(0.25, 50), flicker(1, 60), flicker(0.45, 40), flicker(1, 90)]),
          Animated.sequence([
            Animated.timing(zap, { toValue: 1.18, duration: 90, useNativeDriver: true }),
            Animated.spring(zap, { toValue: 1, friction: 4, useNativeDriver: true }),
          ]),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [crackle, lit]);
  const icon = <Ionicons name={lit ? "flash" : "flash-outline"} size={size} color={color} />;
  if (!crackle || !lit) return icon;
  return <Animated.View style={{ opacity: glow, transform: [{ scale: zap }] }}>{icon}</Animated.View>;
}

// The streak number: big glowing amber digits on the terminal, red LED digits on the circuit board
function StreakNumber({ value }: { value: number }) {
  const t = useTheme();
  const s = useStyles();
  const amberGlow = useAmberGlow();

  if (t.button === "key") {
    const digits = String(value).padStart(2, "0");
    return (
      <View style={s.ledGlass}>
        {/* Unlit 8s behind the digits, like a real LED display */}
        <Text style={[s.ledDigits, { color: LED_OFF }]}>{"8".repeat(digits.length)}</Text>
        <Text style={[s.ledDigits, s.ledLit, value > 0 ? LED_GLOW : { color: "#7A1E17" }]}>{digits}</Text>
      </View>
    );
  }
  return <Text style={[s.bigNumber, { color: value > 0 ? t.amber : t.dim }, value > 0 && amberGlow]}>{value}</Text>;
}

// Plays once per day, the first time the home screen shows that today's lesson is done
function useDailyCelebration(doneToday: boolean) {
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!doneToday) return;
    const today = dayKey();
    AsyncStorage.getItem(CELEBRATED_KEY)
      .then((last) => {
        if (last === today) return;
        setCelebrate(true);
        AsyncStorage.setItem(CELEBRATED_KEY, today).catch(() => {});
      })
      .catch(() => {});
  }, [doneToday]);
  return celebrate;
}

// Daily streak card for the home screen
export function StreakCard({ progress }: { progress: Progress }) {
  const t = useTheme();
  const s = useStyles();
  const amberGlow = useAmberGlow();
  const streak = currentStreak(progress);
  const doneToday = learnedToday(progress);
  const lit = streak > 0;
  const celebrate = useDailyCelebration(doneToday);

  // The celebration: today's bolt drops into its box, the number jumps,
  // a "+1 DAY" floats up, and the card flashes once
  const stamp = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const float = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!celebrate) return;
    stamp.setValue(0);
    float.setValue(0);
    const timer = setTimeout(() => sound("complete"), 350);
    Animated.sequence([
      Animated.delay(300),
      Animated.parallel([
        Animated.spring(stamp, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(pop, { toValue: 1.35, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(pop, { toValue: 1, friction: 3, useNativeDriver: true }),
        ]),
        Animated.timing(float, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 120, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 700, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
    return () => clearTimeout(timer);
  }, [celebrate]);

  const week = lastWeek(progress);
  const stampedStyle = {
    transform: [{ scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] }) }],
    opacity: stamp.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
  };

  return (
    <View style={[s.card, lit && s.cardLit, doneToday && s.cardDone]}>
      {/* The flash over the whole card */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.flash, { opacity: flash }]} />

      <View style={s.top}>
        <View>
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <StreakNumber value={streak} />
          </Animated.View>
          {celebrate && (
            <Animated.Text
              pointerEvents="none"
              style={[
                s.plusOne,
                t.button === "key" ? { color: LED_ON } : { color: t.amber },
                {
                  opacity: float.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -34] }) }],
                },
              ]}
            >
              +1 DAY
            </Animated.Text>
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={s.titleRow}>
            <StreakMark size={22} lit={lit} crackle />
            <Text style={[s.title, { color: lit ? t.amber : t.dim }, lit && amberGlow]}>
              DAY{streak === 1 ? "" : "S"} STREAK
            </Text>
          </View>
          <Text style={s.message}>
            {doneToday
              ? celebrate
                ? streak === 1
                  ? "Day one! Come back tomorrow to keep it going."
                  : `${streak} days in a row. Nice work!`
                : "Safe for today. See you tomorrow!"
              : lit
                ? "Finish a lesson today, or your streak resets."
                : "Finish a lesson to start your streak."}
          </Text>
        </View>
      </View>

      {/* The last 7 days */}
      <View style={s.week}>
        {week.map((day, i) => {
          const animateThis = celebrate && day.today && day.active;
          return (
            <View key={i} style={s.day}>
              <View style={[s.box, day.active && s.boxOn, day.today && !day.active && s.boxToday]}>
                {day.active && (
                  <Animated.View style={animateThis ? stampedStyle : undefined}>
                    <StreakMark size={18} onLight />
                  </Animated.View>
                )}
              </View>
              <Text style={[s.letter, day.today && { color: t.amber, fontWeight: "700" }]}>{day.letter}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    card: {
      marginTop: 20,
      borderWidth: 2,
      borderColor: t.line,
      borderRadius: t.radius + 2,
      backgroundColor: t.surface,
      padding: 16,
      gap: 16,
      overflow: "hidden",
    },
    cardLit: { borderColor: t.amber },
    cardDone: { backgroundColor: t.amberFaint },
    flash: { backgroundColor: t.button === "key" ? LED_ON : t.amber, borderRadius: t.radius },
    top: { flexDirection: "row", alignItems: "center", gap: 16 },

    // Terminal: big amber number
    bigNumber: { fontFamily: t.mono, fontSize: 56, fontWeight: "700", lineHeight: 64, minWidth: 48, textAlign: "center" },
    plusOne: { position: "absolute", top: -4, left: 0, right: 0, textAlign: "center", fontFamily: t.mono, fontSize: 12, fontWeight: "700", letterSpacing: 1 },

    // Circuit board: LED display
    ledGlass: {
      backgroundColor: "#1E0605",
      borderRadius: 6,
      borderWidth: 2,
      borderColor: "#000",
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    ledDigits: { fontFamily: t.mono, fontSize: 44, fontWeight: "700", fontStyle: "italic", letterSpacing: 3 },
    ledLit: { position: "absolute", left: 10, top: 4, color: LED_ON },

    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontFamily: t.mono, fontSize: 17, fontWeight: "700", letterSpacing: 2 },
    message: { fontFamily: t.mono, fontSize: 12, lineHeight: 17, color: t.green, opacity: 0.8 },

    week: { flexDirection: "row", justifyContent: "space-between" },
    day: { alignItems: "center", gap: 5 },
    box: {
      width: 32,
      height: 32,
      borderRadius: t.radius - 2,
      borderWidth: 1.5,
      borderColor: t.line,
      backgroundColor: t.bg,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: t.amber, borderColor: t.amber },
    boxToday: { borderColor: t.amber, borderStyle: "dashed", borderWidth: 2 },
    letter: { fontFamily: t.mono, fontSize: 11, color: t.dim },

    // The big celebration
    overlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.82)", alignItems: "center", justifyContent: "center", gap: 18 },
    boltArea: { width: 200, height: 200, alignItems: "center", justifyContent: "center" },
    spark: { position: "absolute" },
    bigDay: { fontFamily: t.mono, fontSize: 44, fontWeight: "700", color: t.amber, letterSpacing: 3 },
    bigSub: { fontFamily: t.mono, fontSize: 16, fontWeight: "700", color: "#FFFFFF", letterSpacing: 2, marginTop: 6 },
    tap: { fontFamily: t.mono, fontSize: 11, color: "rgba(255, 255, 255, 0.55)", letterSpacing: 1.5, marginTop: 26 },
  })
);

// ---------- The big moment: the first finished lesson or quest of the day ----------

// Save something (a finished lesson or quest) and find out whether it just secured today's streak
export async function saveAndCheckStreak(save: () => Promise<unknown>): Promise<{ progress: Progress; earned: boolean }> {
  const before = await loadProgress();
  const had = learnedToday(before);
  await save();
  const progress = await loadProgress();
  const earned = !had && learnedToday(progress);
  // The home screen doesn't need to celebrate again today
  if (earned) AsyncStorage.setItem(CELEBRATED_KEY, dayKey()).catch(() => {});
  return { progress, earned };
}

const SPARKS = 8;

// Full-screen celebration: a big bolt strikes, sparks fly out, and the new streak count pops up.
// Closes by itself after a few seconds, or with a tap.
export function StreakCelebration({ streak, onDone }: { streak: number; onDone: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const amberGlow = useAmberGlow();
  const fade = useRef(new Animated.Value(0)).current;
  const strike = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const sparks = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const flicker = useRef(new Animated.Value(1)).current;

  function close() {
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => onDone());
  }

  useEffect(() => {
    const zap = setTimeout(() => sound("correct"), 260);
    const f = (to: number, ms: number) => Animated.timing(flicker, { toValue: to, duration: ms, useNativeDriver: true });
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.parallel([
        // The bolt slams in from above
        Animated.spring(strike, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
        // A white-hot flash
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 70, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 450, useNativeDriver: true }),
        ]),
        // Sparks fly out
        Animated.timing(sparks, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        // Then the text
        Animated.sequence([Animated.delay(250), Animated.spring(text, { toValue: 1, friction: 5, useNativeDriver: true })]),
        // And the bolt crackles
        Animated.sequence([Animated.delay(500), f(0.3, 50), f(1, 60), f(0.5, 40), f(1, 100)]),
      ]),
    ]).start();
    const auto = setTimeout(close, 3200);
    return () => {
      clearTimeout(zap);
      clearTimeout(auto);
    };
  }, []);

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <Pressable style={{ flex: 1 }} onPress={close}>
        <Animated.View style={[s.overlay, { opacity: fade }]}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#FFF6D8", opacity: flash }]} />

          <View style={s.boltArea}>
            {/* Sparks: small bolts flying out in a ring */}
            {Array.from({ length: SPARKS }, (_, i) => {
              const angle = (i / SPARKS) * Math.PI * 2;
              return (
                <Animated.View
                  key={i}
                  style={[
                    s.spark,
                    {
                      opacity: sparks.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                      transform: [
                        { translateX: sparks.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 120] }) },
                        { translateY: sparks.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 120] }) },
                        { rotate: `${(angle * 180) / Math.PI + 90}deg` },
                      ],
                    },
                  ]}
                >
                  <Ionicons name="flash" size={18} color={t.amber} />
                </Animated.View>
              );
            })}
            <Animated.View
              style={{
                opacity: flicker,
                transform: [
                  { translateY: strike.interpolate({ inputRange: [0, 1], outputRange: [-260, 0] }) },
                  { scale: strike.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                ],
              }}
            >
              <Ionicons name="flash" size={120} color={t.amber} style={amberGlow} />
            </Animated.View>
          </View>

          <Animated.View
            style={{
              alignItems: "center",
              opacity: text,
              transform: [{ scale: text.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
            }}
          >
            <Text style={[s.bigDay, amberGlow]}>{streak === 1 ? "DAY 1" : `${streak} DAYS`}</Text>
            <Text style={s.bigSub}>{streak === 1 ? "STREAK STARTED!" : "STREAK EXTENDED!"}</Text>
            <Text style={s.tap}>TAP TO CONTINUE</Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
