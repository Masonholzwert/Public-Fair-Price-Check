import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./press";
import { SafeAreaView } from "react-native-safe-area-context";
import { createAccount, resetPassword, sendResetCode, signIn } from "./lib/account";
import { sound } from "./sounds";
import { Cursor, TermButton, makeStyles, useGlow, useTheme } from "./theme";

type Mode = "signin" | "create" | "forgot";

// The first screen: sign in, or create an account. Everyone needs one,
// so the progress is saved and the same on every device.
export function AuthScreen() {
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const [mode, setMode] = useState<Mode>("signin");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function switchTo(next: Mode) {
    sound("tap");
    setMode(next);
    setError(null);
    setNote(null);
    setCodeSent(false);
    setCode("");
    setPassword("");
  }

  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await task();
    setBusy(false);
    if (result === null) sound("complete"); // signed in: the app opens by itself
    return result;
  }

  async function submit() {
    if (busy) return;
    if (mode === "signin") {
      const err = await run(() => signIn(email, password));
      if (err) {
        sound("wrong");
        setError(err);
      }
    } else if (mode === "create") {
      const result = await run(() => createAccount(nickname, email, password));
      if (result === "confirm") {
        setMode("signin");
        setNote(`Almost done: we sent an e-mail to ${email.trim()}. Open the link in it, then sign in here.`);
      } else if (result) {
        sound("wrong");
        setError(result);
      }
    } else if (!codeSent) {
      const err = await run(() => sendResetCode(email));
      if (err) setError(err);
      else {
        setCodeSent(true);
        setNote(`We sent a code to ${email.trim()}. It can take a minute, check the spam folder too.`);
      }
    } else {
      const err = await run(() => resetPassword(email, code, password));
      if (err) {
        sound("wrong");
        setError(err);
      }
    }
  }

  const buttonLabel = busy
    ? "…"
    : mode === "signin"
      ? "SIGN IN"
      : mode === "create"
        ? "CREATE ACCOUNT"
        : codeSent
          ? "SAVE NEW PASSWORD"
          : "SEND CODE";

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.column}>
            <Text style={s.label}>{t.bootLine}</Text>
            <Text style={[s.title, glow]}>BASIC-LINGO</Text>
            <View style={s.readyRow}>
              <Text style={[s.ready, glow]}>{mode === "create" ? "NEW USER" : mode === "forgot" ? "RESET PASSWORD" : "LOGIN"}</Text>
              <Cursor size={14} />
            </View>
            <Text style={s.intro}>
              {mode === "create"
                ? "Your account keeps your progress, streak and sandbox programs safe, and the same on your phone and computer."
                : mode === "forgot"
                  ? "Type your e-mail. We'll send you a code to set a new password."
                  : "Sign in to continue learning."}
            </Text>

            {mode !== "forgot" && (
              <View style={s.tabs}>
                {(["signin", "create"] as const).map((m) => (
                  <Pressable key={m} onPress={() => switchTo(m)} style={[s.tab, mode === m && s.tabOn]}>
                    <Text style={[s.tabText, mode === m && { color: t.button === "bracket" ? t.bg : t.keyText }]}>
                      {m === "signin" ? "SIGN IN" : "NEW ACCOUNT"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {mode === "create" && (
              <>
                <Text style={s.field}>NICKNAME</Text>
                <TextInput
                  value={nickname}
                  onChangeText={(text: string) => setNickname(text.toUpperCase().replace(/[^A-Z0-9 _.-]/g, ""))}
                  placeholder="SHOWN ON THE LEADERBOARDS"
                  placeholderTextColor={t.dim}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={16}
                  style={s.input}
                />
              </>
            )}

            <Text style={s.field}>E-MAIL</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              editable={!(mode === "forgot" && codeSent)}
              placeholder="you@example.com"
              placeholderTextColor={t.dim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              style={[s.input, mode === "forgot" && codeSent && { opacity: 0.6 }]}
            />

            {mode === "forgot" && codeSent && (
              <>
                <Text style={s.field}>CODE FROM THE E-MAIL</Text>
                <TextInput
                  value={code}
                  onChangeText={(text: string) => setCode(text.replace(/[^0-9]/g, ""))}
                  placeholder="123456"
                  placeholderTextColor={t.dim}
                  keyboardType="number-pad"
                  maxLength={10}
                  style={[s.input, { letterSpacing: 6 }]}
                />
              </>
            )}

            {(mode !== "forgot" || codeSent) && (
              <>
                <Text style={s.field}>{mode === "forgot" ? "NEW PASSWORD" : "PASSWORD"}</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === "signin" ? "" : "AT LEAST 8 CHARACTERS"}
                  placeholderTextColor={t.dim}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType={mode === "signin" ? "password" : "newPassword"}
                  autoComplete={mode === "signin" ? "password" : "new-password"}
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  style={s.input}
                />
              </>
            )}

            <View style={{ marginTop: 18 }}>
              <TermButton label={buttonLabel} onPress={submit} disabled={busy} />
            </View>

            {error && <Text style={[s.message, { color: t.red }]}>{error}</Text>}
            {note && <Text style={[s.message, { color: t.amber }]}>{note}</Text>}

            <View style={s.links}>
              {mode === "signin" && (
                <Pressable onPress={() => switchTo("forgot")} hitSlop={8}>
                  <Text style={s.link}>FORGOT PASSWORD?</Text>
                </Pressable>
              )}
              {mode === "forgot" && (
                <Pressable onPress={() => switchTo("signin")} hitSlop={8}>
                  <Text style={s.link}>‹ BACK TO SIGN IN</Text>
                </Pressable>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { flexGrow: 1, justifyContent: "center", padding: 24, paddingBottom: 60 },
    column: { width: "100%", maxWidth: 440, alignSelf: "center" },
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    title: { fontFamily: t.mono, fontSize: 30, fontWeight: "700", color: t.green, marginTop: 6 },
    readyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    ready: { fontFamily: t.mono, fontSize: 16, color: t.green },
    intro: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green, opacity: 0.8, marginTop: 14 },
    tabs: { flexDirection: "row", gap: 6, marginTop: 22, marginBottom: 4 },
    tab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: t.soft, borderWidth: 1.5, borderColor: t.line },
    tabOn: { backgroundColor: t.button === "bracket" ? t.green : t.keyFace, borderColor: t.button === "bracket" ? t.green : t.keyFace },
    tabText: { fontFamily: t.mono, fontSize: 11, fontWeight: "700", letterSpacing: 1, color: t.green },
    field: { fontFamily: t.mono, fontSize: 10, color: t.dim, letterSpacing: 1.5, marginTop: 16, marginBottom: 6 },
    input: {
      fontFamily: t.mono,
      fontSize: 16,
      color: t.green,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      paddingVertical: 11,
      paddingHorizontal: 12,
    },
    message: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, marginTop: 12 },
    links: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
    link: { fontFamily: t.mono, fontSize: 11, letterSpacing: 1, color: t.dim, paddingVertical: 4 },
  })
);
