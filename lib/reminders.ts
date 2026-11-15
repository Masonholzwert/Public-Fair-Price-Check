import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { currentStreak, learnedToday, loadProgress, onProgressSaved } from "./progress";

// Daily reminder: a local notification at a time you pick, like "Your 5-day streak ends at midnight".
// Everything happens on the phone: no server, no push service.
// The reminders for the next week are planned ahead, and today's is skipped once you've learned.

export type ReminderSettings = { enabled: boolean; hour: number; minute: number };

const SETTINGS_KEY = "basic-lingo-reminder";
const ASKED_KEY = "basic-lingo-reminder-asked";
const DEFAULT: ReminderSettings = { enabled: true, hour: 19, minute: 0 };
const DAYS_AHEAD = 7;

// The computer version has no phone notifications
export const remindersSupported = Platform.OS === "ios" || Platform.OS === "android";

// Show the reminder as a banner even when the app is open
if (remindersSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export async function saveReminderSettings(settings: ReminderSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  await planReminders();
}

export async function hasPermission(): Promise<boolean> {
  if (!remindersSupported) return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

// Ask once, after the first finished lesson of the first day: by then the streak means something
export async function askOnceForReminders(): Promise<void> {
  if (!remindersSupported) return;
  if ((await AsyncStorage.getItem(ASKED_KEY)) === "1") return;
  await AsyncStorage.setItem(ASKED_KEY, "1");
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === "granted") await planReminders();
}

// The introduction asked already: remember the answer, so the app doesn't ask again later
export async function setReminderChoice(on: boolean): Promise<boolean> {
  await AsyncStorage.setItem(ASKED_KEY, "1");
  const settings = await loadReminderSettings();
  if (!on) {
    await saveReminderSettings({ ...settings, enabled: false });
    return false;
  }
  const allowed = await askForReminders();
  await saveReminderSettings({ ...settings, enabled: allowed });
  return allowed;
}

// Ask from the settings screen (the switch was turned on). Returns whether it's allowed now.
export async function askForReminders(): Promise<boolean> {
  if (!remindersSupported) return false;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

const LATER_MESSAGES = [
  "Five minutes of code keep the streak alive. ⚡",
  "The card reader is waiting. One lesson today?",
  "READY. Your next lesson is one tap away.",
  "The 6502 is idling. Give it something to do!",
  "A quick lesson today keeps your streak going.",
];

// Plan the notifications for the next days. Called on start, after every lesson and when settings change.
export async function planReminders(testTime?: { hour: number; minute: number }) {
  if (!remindersSupported) return;
  try {
    // Only replace the daily reminders (test notifications keep running)
    const planned = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of planned) if (n.identifier.startsWith("daily-")) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    const saved = await loadReminderSettings();
    const settings = testTime ? { ...saved, ...testTime, enabled: true } : saved;
    if (!settings.enabled || !(await hasPermission())) return;

    const progress = await loadProgress();
    const streak = currentStreak(progress);
    const now = new Date();

    for (let day = 0; day < DAYS_AHEAD; day++) {
      const when = new Date(now);
      when.setDate(now.getDate() + day);
      when.setHours(settings.hour, settings.minute, 0, 0);
      if (when <= now) continue;
      if (day === 0 && learnedToday(progress)) continue; // already safe today

      let body: string;
      if (day === 0) body = streak > 0 ? `Your ${streak}-day streak ends at midnight. One lesson saves it!` : "A five-minute lesson is waiting for you.";
      else if (day === 1 && learnedToday(progress)) body = `Keep your ${streak}-day streak going with a lesson today.`;
      else body = LATER_MESSAGES[day % LATER_MESSAGES.length];

      await Notifications.scheduleNotificationAsync({
        identifier: `daily-${day}`,
        content: { title: "basic-lingo", body, sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
    }
  } catch (e) {
    console.warn("[reminders]", e);
  }
}

// Started once when the app opens: plan now, again after each saved lesson, and when the app comes back
let started = false;
export function startReminders() {
  if (started || !remindersSupported) return;
  started = true;
  planReminders();
  let timer: ReturnType<typeof setTimeout> | null = null;
  onProgressSaved(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(planReminders, 1500);
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active") planReminders();
  });
}

// Admin test: every kind of reminder, one every 6 seconds, starting in 5 seconds.
// Press the home button after starting it to see them as real banners.
export async function testAllReminders(): Promise<string | null> {
  if (!remindersSupported) return "Notifications only work in the phone app.";
  if (!(await hasPermission()) && !(await askForReminders())) return "Notifications are not allowed. Turn them on in the iPhone settings.";
  const streak = Math.max(1, currentStreak(await loadProgress()));
  const messages = [
    `Your ${streak}-day streak ends at midnight. One lesson saves it!`,
    "A five-minute lesson is waiting for you.",
    `Keep your ${streak}-day streak going with a lesson today.`,
    ...LATER_MESSAGES,
  ];
  for (let i = 0; i < messages.length; i++) {
    await Notifications.scheduleNotificationAsync({
      identifier: `test-${i}`,
      content: { title: "basic-lingo", body: messages[i], sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 + i * 6 },
    });
  }
  return null;
}

// Admin test: the real daily reminder (same planning, same message as tonight), but in one minute
export async function testDailyReminder(): Promise<string | null> {
  if (!remindersSupported) return "Notifications only work in the phone app.";
  if (!(await hasPermission()) && !(await askForReminders())) return "Notifications are not allowed. Turn them on in the iPhone settings.";
  const at = new Date(Date.now() + 60 * 1000);
  if (at.getSeconds() > 50) at.setMinutes(at.getMinutes() + 1); // leave enough time before it's due
  await planReminders({ hour: at.getHours(), minute: at.getMinutes() });
  const progress = await loadProgress();
  return learnedToday(progress)
    ? "You've already learned today, so today's reminder is skipped, just like the real one. Try it on a day you haven't learned yet."
    : null;
}

export type ReminderKind = "streak-ends" | "no-streak" | "keep-going" | "nudge";

// Admin test: one kind of reminder, exactly as it would look, in 5 seconds (works any time of day)
export async function testReminder(kind: ReminderKind): Promise<string | null> {
  if (!remindersSupported) return "Notifications only work in the phone app.";
  if (!(await hasPermission()) && !(await askForReminders())) return "Notifications are not allowed. Turn them on in the iPhone settings.";
  const streak = Math.max(1, currentStreak(await loadProgress()));
  const body =
    kind === "streak-ends"
      ? `Your ${streak}-day streak ends at midnight. One lesson saves it!`
      : kind === "no-streak"
        ? "A five-minute lesson is waiting for you."
        : kind === "keep-going"
          ? `Keep your ${streak}-day streak going with a lesson today.`
          : LATER_MESSAGES[Math.floor(Math.random() * LATER_MESSAGES.length)];
  await Notifications.scheduleNotificationAsync({
    identifier: `test-${kind}-${Date.now()}`,
    content: { title: "basic-lingo", body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
  return null;
}
