import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { ReactNode, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Pressable } from "../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../lib/active-course";
import { signOutHere } from "../../lib/account";
import { Alert } from "../../lib/alert";
import { deleteAccount } from "../../lib/online";
import { resetOnboarding } from "../../lib/onboarding";
import { ReminderSettings, askForReminders, hasPermission, loadReminderSettings, remindersSupported, saveReminderSettings } from "../../lib/reminders";
import { supabase, useSession } from "../../lib/supabase";
import { go, goBack, isSoundOn, onSoundChange, setSoundOn, sound } from "../../sounds";
import { TermButton, makeStyles, useGlow, useTheme } from "../../theme";

const pad = (n: number) => String(n).padStart(2, "0");

// Everything to set up in one place: sound, the daily reminder, the course, the account
// The screen, with the rail on its left on phones
export default function Settings() {
  return (
    <WithRail path="/settings">
      <SettingsContent />
    </WithRail>
  );
}

function SettingsContent() {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const { course } = useCourse();
  const session = useSession();

  const [soundOn, setSound] = useState(isSoundOn());
  useEffect(() => onSoundChange(setSound), []);

  const [reminder, setReminder] = useState<ReminderSettings | null>(null);
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    loadReminderSettings().then(setReminder);
    hasPermission().then(setAllowed);
  }, []);

  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changeReminder(next: ReminderSettings) {
    if (next.enabled && !allowed) {
      const ok = await askForReminders();
      setAllowed(ok);
      if (!ok) {
        Alert.alert("Notifications are off", "Allow notifications for this app in the iPhone settings, then try again.");
        return;
      }
    }
    setReminder(next);
    saveReminderSettings(next);
  }

  // The time moves in steps of 15 minutes, and wraps around midnight
  function shiftTime(minutes: number) {
    if (!reminder) return;
    sound("tap");
    const total = (reminder.hour * 60 + reminder.minute + minutes + 24 * 60) % (24 * 60);
    changeReminder({ ...reminder, hour: Math.floor(total / 60), minute: total % 60 });
  }

  async function savePassword() {
    if (newPassword.length < 8) return setPasswordMessage({ text: "The password needs at least 8 characters.", ok: false });
    setBusy(true);
    const { error } = (await supabase?.auth.updateUser({ password: newPassword })) ?? { error: null };
    setBusy(false);
    if (error) return setPasswordMessage({ text: "Couldn't change the password. Check your internet connection.", ok: false });
    sound("complete");
    setNewPassword("");
    setPasswordMessage({ text: "Password changed.", ok: true });
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", "Your progress is saved in your account. Sign in again any time to continue.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", onPress: () => signOutHere() },
    ]);
  }

  function confirmDelete() {
    Alert.alert("Delete your account?", "Your account, progress, nickname, leaderboard entries and shared programs are deleted for good, on all devices.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const error = await deleteAccount();
          if (error) Alert.alert("Not deleted", error);
        },
      },
    ]);
  }

  const onColor = t.button === "bracket" ? t.green : t.keyFace;

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>SETTINGS</Text>
        </View>
        <Text style={[s.title, glow]}>Settings</Text>

        {/* Sound */}
        <Text style={s.section}>SOUND</Text>
        <View style={s.card}>
          <Row icon={soundOn ? "volume-high-outline" : "volume-mute-outline"} title="Sound effects" text="Clicks, beeps and the machine noises of each era.">
            <Switch
              value={soundOn}
              onValueChange={(on: boolean) => {
                setSoundOn(on);
                if (on) setTimeout(() => sound("toggle"), 0);
              }}
              trackColor={{ true: onColor, false: t.line }}
            />
          </Row>
        </View>

        {/* Daily reminder */}
        <Text style={s.section}>DAILY REMINDER</Text>
        <View style={s.card}>
          {!remindersSupported ? (
            <Text style={s.text}>Reminders are a phone feature. Turn them on in the app on your phone.</Text>
          ) : reminder ? (
            <>
              <Row icon="notifications-outline" title="Remind me" text="Only if you haven't learned yet that day.">
                <Switch value={reminder.enabled && allowed} onValueChange={(on: boolean) => changeReminder({ ...reminder, enabled: on })} trackColor={{ true: onColor, false: t.line }} />
              </Row>
              {reminder.enabled && allowed && (
                <View style={s.timeRow}>
                  <Pressable onPress={() => shiftTime(-15)} hitSlop={8} style={s.timeButton}>
                    <Ionicons name="remove" size={20} color={t.green} />
                  </Pressable>
                  <Text style={[s.time, glow]}>
                    {pad(reminder.hour)}:{pad(reminder.minute)}
                  </Text>
                  <Pressable onPress={() => shiftTime(15)} hitSlop={8} style={s.timeButton}>
                    <Ionicons name="add" size={20} color={t.green} />
                  </Pressable>
                </View>
              )}
              {!allowed && reminder.enabled && <Text style={[s.text, { color: t.red }]}>Notifications are turned off for this app in the iPhone settings.</Text>}
            </>
          ) : null}
        </View>

        {/* Course */}
        <Text style={s.section}>COURSE</Text>
        <View style={s.card}>
          <Pressable onPress={() => go("/courses")}>
            <Row icon="swap-horizontal" title={course.title} text={`${course.year} · ${course.machine}`}>
              <Ionicons name="chevron-forward" size={18} color={t.dim} />
            </Row>
          </Pressable>
          <View style={s.divider} />
          <Pressable
            onPress={() => {
              sound("open");
              resetOnboarding();
            }}
          >
            <Row icon="play-circle-outline" title="Show the introduction" text="The welcome tour from the first start.">
              <Ionicons name="chevron-forward" size={18} color={t.dim} />
            </Row>
          </Pressable>
        </View>

        {/* Account */}
        {session && (
          <>
            <Text style={s.section}>ACCOUNT</Text>
            <View style={s.card}>
              <Row icon="person-circle-outline" title="Signed in" text={session.user.email ?? ""} />
              <Text style={s.text}>Your progress, streak and sandbox programs are saved with this account, on every device you sign in.</Text>

              <View style={s.divider} />
              <Text style={s.fieldLabel}>NEW PASSWORD</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="AT LEAST 8 CHARACTERS"
                placeholderTextColor={t.dim}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                style={s.input}
              />
              <TermButton label={busy ? "…" : "CHANGE PASSWORD"} onPress={savePassword} disabled={busy || newPassword === ""} />
              {passwordMessage && <Text style={[s.text, { color: passwordMessage.ok ? t.green : t.red }]}>{passwordMessage.text}</Text>}

              <View style={s.divider} />
              <Pressable onPress={confirmSignOut} hitSlop={8}>
                <Text style={s.action}>SIGN OUT ON THIS DEVICE</Text>
              </Pressable>
              <Pressable onPress={confirmDelete} hitSlop={8}>
                <Text style={[s.action, { color: t.red }]}>DELETE ACCOUNT</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, title, text, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; text?: string; children?: ReactNode }) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={20} color={t.green} style={{ width: 24 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {text ? <Text style={s.rowText}>{text}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 20, paddingBottom: 60 },
    topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    close: { fontSize: 20, color: t.dim },
    label: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.6 },
    title: { fontFamily: t.mono, fontSize: 26, fontWeight: "700", color: t.green, marginTop: 14 },
    section: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5, marginTop: 26, marginBottom: 10 },
    card: { backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: t.soft, padding: 14, gap: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowTitle: { fontFamily: t.mono, fontSize: 14, fontWeight: "700", color: t.green },
    rowText: { fontFamily: t.mono, fontSize: 11, lineHeight: 16, color: t.dim, marginTop: 2 },
    text: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green, opacity: 0.85 },
    divider: { height: 1, backgroundColor: t.line },
    timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22 },
    timeButton: { borderWidth: 1.5, borderColor: t.line, borderRadius: t.soft, padding: 8 },
    time: { fontFamily: t.mono, fontSize: 32, fontWeight: "700", color: t.green, minWidth: 110, textAlign: "center" },
    fieldLabel: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.5 },
    input: {
      fontFamily: t.mono,
      fontSize: 15,
      color: t.green,
      backgroundColor: t.bg,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    action: { fontFamily: t.mono, fontSize: 11, fontWeight: "700", letterSpacing: 1, color: t.green, paddingVertical: 4 },
  })
);
