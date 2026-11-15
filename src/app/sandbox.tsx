import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../press";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { AltairPanel } from "../../altair-panel";
import { MachinePanel } from "../../led";
import { useCourse } from "../../lib/active-course";
import type { RunResult } from "../../lib/course";
import { STARTERS, SandboxProgram, loadPrograms, newId, savePrograms } from "../../lib/sandbox";
import { shareProgram } from "../../lib/online";
import { useSession } from "../../lib/supabase";
import { go, goBack, sound } from "../../sounds";
import { StepView } from "../../stepper";
import { TermButton, makeStyles, useGlow, useTheme } from "../../theme";

// The iPhone keyboard turns " into “ ” on its own. The computers only know the plain ones.
const plainQuotes = (text: string) =>
  text.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'").replace(/[–—−]/g, "-");

// BASIC INPUT answers: "7, 3, YES" -> [7, 3, "YES"]
function parseInputs(text: string): (number | string)[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => (Number.isNaN(Number(part)) ? part : Number(part)));
}

// Free programming: write anything, run it, save it. One list of programs per course.
export default function Sandbox() {
  const { course } = useCourse();
  const t = useTheme();
  const s = useStyles();
  const glow = useGlow();
  const asm = !!course.canStep;

  const [programs, setPrograms] = useState<SandboxProgram[]>([]);
  const [current, setCurrent] = useState<SandboxProgram | null>(null);
  const [showList, setShowList] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [stepping, setStepping] = useState(false);
  const [panel, setPanel] = useState(false); // the Altair front panel
  const loaded = useRef(false);
  const session = useSession();

  // Load the saved programs, or start with a first example
  useEffect(() => {
    loadPrograms(course.id).then((saved) => {
      if (saved.length === 0) {
        const starter = STARTERS[course.id] ?? STARTERS.basic;
        const first = { id: newId(), ...starter, updated: new Date().toISOString() };
        saved = [first];
        savePrograms(course.id, saved);
      }
      setPrograms(saved);
      setCurrent(saved[0]);
      loaded.current = true;
    });
  }, [course.id]);

  // Save a second after the last change
  useEffect(() => {
    if (!loaded.current || !current) return;
    const timer = setTimeout(() => {
      setPrograms((list) => {
        const next = [current, ...list.filter((p) => p.id !== current.id)];
        savePrograms(course.id, next);
        return next;
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [current]);

  function edit(change: Partial<SandboxProgram>) {
    setCurrent((p) => (p ? { ...p, ...change, updated: new Date().toISOString() } : p));
  }

  function run() {
    if (!current) return;
    Keyboard.dismiss();
    sound("run");
    const code = plainQuotes(current.code);
    const res = asm
      ? course.run(code, [], { keys: current.input })
      : course.id === "fortran" || course.id === "c" || course.id === "pascal" || course.id === "altair" || course.id === "cobol"
        ? course.run(code, current.input === "" ? [] : current.input.split("|"))
        : course.run(code, parseInputs(current.input));
    setResult(res);
  }

  // Publish the program in the community, so others can run and like it
  function share() {
    if (!current) return;
    if (!session) {
      Alert.alert("Join to share", "Pick a nickname under ☰ → Profile, then share your programs with everyone.");
      return;
    }
    Alert.alert(`Share "${current.name}"?`, "Everyone using the app can see, run and copy it. Your nickname is shown with it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Share",
        onPress: async () => {
          const error = await shareProgram(course.id, current.name, plainQuotes(current.code));
          sound(error ? "wrong" : "complete");
          if (error) Alert.alert("Not shared", error);
          else
            Alert.alert("Shared!", "Your program is now in the community.", [
              { text: "OK" },
              { text: "Open community", onPress: () => go("/community") },
            ]);
        },
      },
    ]);
  }

  // A finished program from somewhere else (like Kill the Bit from the Altair panel)
  function addProgram(name: string, code: string) {
    const program: SandboxProgram = { id: newId(), name, code, input: "", updated: new Date().toISOString() };
    setPrograms((list) => [program, ...list]);
    setCurrent(program);
    setResult(null);
  }

  function newProgram() {
    sound("open");
    const program: SandboxProgram = {
      id: newId(),
      name: `PROGRAM ${programs.length + 1}`,
      code: asm
        ? "; NEW PROGRAM\n\nBRK\n"
        : course.id === "fortran"
          ? "C     NEW PROGRAM\n\n      STOP\n      END\n"
          : course.id === "c"
            ? "#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n"
          : course.id === "pascal"
            ? "program NewProgram;\n\nbegin\n  \nend.\n"
          : course.id === "cobol"
            ? "      * NEW PROGRAM\n       IDENTIFICATION DIVISION.\n       PROGRAM-ID. NEWJOB.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n       PROCEDURE DIVISION.\n           \n           STOP RUN.\n"
          : course.id === "altair"
            ? "; NEW PROGRAM\n00 111 110   ; MVI A\n00 000 001   ; 1\n11 010 011   ; OUT\n11 111 111   ; the lights\n01 110 110   ; HLT\n"
          : "10 REM NEW PROGRAM\n100 END\n",
      input: "",
      updated: new Date().toISOString(),
    };
    setPrograms((list) => [program, ...list]);
    setCurrent(program);
    setResult(null);
    setShowList(false);
  }

  function openProgram(program: SandboxProgram) {
    sound("tap");
    setCurrent(program);
    setResult(null);
    setShowList(false);
  }

  function deleteProgram(program: SandboxProgram) {
    Alert.alert("Delete program?", `"${program.name}" will be gone for good.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          const rest = programs.filter((p) => p.id !== program.id);
          setPrograms(rest);
          savePrograms(course.id, rest);
          if (current?.id === program.id) {
            if (rest.length > 0) setCurrent(rest[0]);
            else newProgram();
          }
        },
      },
    ]);
  }

  if (!current) return <SafeAreaView style={s.screen} />;

  // Only show the input box when the program can use it
  const cLang = course.id === "c";
  const pascal = course.id === "pascal";
  const altair = course.id === "altair";
  const cobol = course.id === "cobol";
  const needsInput = asm
    ? /GETCH|\$1E5A/i.test(current.code)
    : cLang
      ? /\b(scanf|getchar)\s*\(|\bstdin\b/.test(current.code)
      : pascal
        ? /\b(read|readln)\b/i.test(current.code)
      : altair
        ? /^\s*(11\s*011\s*011|333)\b/m.test(current.code)
      : cobol
        ? /\bACCEPT\s+[A-Z0-9-]+(?!\s+FROM)/i.test(current.code)
      : /\b(INPUT|READ)\b/i.test(current.code);
  const fortran = course.id === "fortran";

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Top bar */}
        <View style={s.topBar}>
          <Pressable onPress={goBack} hitSlop={12}>
            <Text style={s.close}>✕</Text>
          </Pressable>
          <Text style={s.label}>SANDBOX · {course.title.toUpperCase()}</Text>
        </View>

        {showList ? (
          // ----- Saved programs -----
          <ScrollView contentContainerStyle={s.body}>
            <Pressable onPress={() => setShowList(false)} hitSlop={10}>
              <Text style={s.label}>‹ BACK TO THE EDITOR</Text>
            </Pressable>
            <Text style={[s.title, glow]}>My Programs</Text>
            <Text style={s.hint}>Saved on this phone. Tap one to open it, hold it to delete it.</Text>
            {programs.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => openProgram(p)}
                onLongPress={() => deleteProgram(p)}
                style={({ pressed }) => [s.programRow, p.id === current.id && s.programRowActive, pressed && { backgroundColor: t.faint }]}
              >
                <Ionicons name="document-text-outline" size={18} color={t.green} />
                <View style={{ flex: 1 }}>
                  <Text style={s.programName}>{p.name}</Text>
                  <Text style={s.hint}>
                    {p.code.split("\n").filter((l) => l.trim()).length} lines · {new Date(p.updated).toLocaleDateString()}
                  </Text>
                </View>
              </Pressable>
            ))}
            <TermButton label="NEW PROGRAM" onPress={newProgram} />
            <TermButton label="COMMUNITY PROGRAMS" color={t.dim} onPress={() => go("/community")} />
          </ScrollView>
        ) : panel ? (
          // ----- Front panel (Altair) -----
          <ScrollView contentContainerStyle={s.body}>
            <AltairPanel
              code={plainQuotes(current.code)}
              name={current.name}
              onExit={() => {
                sound("back");
                setPanel(false);
              }}
              onSave={(code) => edit({ code })}
              onDemo={addProgram}
            />
          </ScrollView>
        ) : stepping ? (
          // ----- Step mode (6502) -----
          <StepView code={plainQuotes(current.code)} keys={current.input || undefined} onExit={() => setStepping(false)} />
        ) : (
          // ----- Editor -----
          <>
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              <TextInput
                value={current.name}
                onChangeText={(name: string) => edit({ name: name.toUpperCase() })}
                style={[s.nameInput, glow]}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={24}
              />
              <Text style={s.hint}>
                This is your own space: tap the code to change it, or start fresh with NEW. Then press RUN.
              </Text>

              <TextInput
                style={s.editor}
                value={current.code}
                onChangeText={(code: string) => edit({ code: plainQuotes(code) })}
                multiline
                autoCapitalize={course.id === "c" || course.id === "pascal" || course.id === "altair" ? "none" : "characters"}
                autoCorrect={false}
                spellCheck={false}
                textAlignVertical="top"
                placeholder={course.editorHint ?? "10 PRINT ..."}
                placeholderTextColor={t.dim}
              />

              {/* INPUT answers (BASIC) or typed keys (6502), only for programs that ask for them */}
              {needsInput && (
              <View style={s.inputBox}>
                <Text style={s.label}>{asm ? "KEYS TO TYPE" : fortran ? "DATA CARDS" : altair ? "SENSE SWITCHES" : cobol ? "SYSIN CARDS" : cLang || pascal ? "KEYBOARD INPUT" : "ANSWERS FOR INPUT"}</Text>
                <Text style={s.hint}>
                  {asm
                    ? "Your program reads keys with GETCH. Type them here first; each GETCH takes the next one."
                    : fortran
                      ? "Your program READs data cards. Separate the cards with | ; each READ takes the next card."
                      : cLang
                        ? "Your program reads input (scanf, getchar or stdin). Type what it should read here; | starts a new line."
                      : pascal
                        ? "Your program reads with readln. Type what it should read here; | starts a new line (one line per readln)."
                      : cobol
                        ? "Your job reads cards with ACCEPT. Type them here, separated by |: each ACCEPT takes the next card."
                      : altair
                        ? "Your program reads the sense switches with IN 377. Set them here, one value per IN, separated by |, like 00010101|255."
                      : "Your program asks with INPUT. Type the answers here first, separated by commas. Each INPUT takes the next one."}
                </Text>
                <TextInput
                  value={current.input}
                  onChangeText={(input: string) => edit({ input: plainQuotes(input) })}
                  placeholder={asm ? "e.g. 385796" : cLang ? "e.g. 7 3|ADA" : pascal ? "e.g. Niklaus|7 3" : cobol ? "e.g. ADA|42" : "e.g. 7, 3, YES"}
                  placeholderTextColor={t.dim}
                  autoCapitalize={course.id === "c" || course.id === "pascal" || course.id === "altair" ? "none" : "characters"}
                  autoCorrect={false}
                  style={s.inputField}
                  returnKeyType="go"
                  onSubmitEditing={run}
                />
              </View>
              )}

              {/* Output */}
              {result && (!result.machine || result.output !== "" || result.error) && (
                <View style={s.console}>
                  <Text style={s.label}>{asm ? "TELETYPE" : "OUTPUT"}</Text>
                  {result.output !== "" && <Text style={[s.consoleText, glow]}>{result.output.replace(/\n$/, "")}</Text>}
                  {result.error && <Text style={[s.consoleText, { color: t.red }]}>{result.error}</Text>}
                  {!result.error && result.output === "" && <Text style={s.label}>(NO OUTPUT)</Text>}
                </View>
              )}
              {result?.machine && <MachinePanel machine={result.machine} />}
            </ScrollView>

            <View style={s.footer}>
              <Pressable
                onPress={() => {
                  sound("open");
                  setShowList(true);
                }}
                style={s.iconButton}
              >
                <Ionicons name="folder-open-outline" size={20} color={t.green} />
                <Text style={s.iconLabel}>MINE</Text>
              </Pressable>
              <Pressable onPress={newProgram} style={s.iconButton}>
                <Ionicons name="add" size={22} color={t.green} />
                <Text style={s.iconLabel}>NEW</Text>
              </Pressable>
              <Pressable onPress={share} style={s.iconButton}>
                <Ionicons name="share-outline" size={20} color={t.green} />
                <Text style={s.iconLabel}>SHARE</Text>
              </Pressable>
              {altair && (
                <View style={{ flex: 1 }}>
                  <TermButton
                    label="PANEL"
                    color={t.dim}
                    onPress={() => {
                      Keyboard.dismiss();
                      sound("open");
                      setPanel(true);
                    }}
                  />
                </View>
              )}
              {asm && (
                <View style={{ flex: 1 }}>
                  <TermButton
                    label="STEP"
                    color={t.dim}
                    onPress={() => {
                      Keyboard.dismiss();
                      sound("open");
                      setStepping(true);
                    }}
                  />
                </View>
              )}
              <View style={{ flex: 2 }}>
                <TermButton label="RUN" onPress={run} />
              </View>
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
    hint: { fontFamily: t.mono, fontSize: 11, color: t.dim },
    nameInput: { fontFamily: t.mono, fontSize: 22, fontWeight: "700", color: t.green, paddingVertical: 4 },
    editor: {
      minHeight: 240,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      padding: 14,
      fontFamily: t.mono,
      fontSize: 15,
      lineHeight: 23,
      color: t.green,
    },
    inputBox: { backgroundColor: t.amberFaint, borderRadius: t.soft, borderLeftWidth: 3, borderLeftColor: t.amber, padding: 12, gap: 6 },
    inputField: { fontFamily: t.mono, fontSize: 15, color: t.green, paddingVertical: 4 },
    console: { backgroundColor: t.bg, borderRadius: t.soft, borderWidth: 1, borderColor: t.line, padding: 14, gap: 6 },
    consoleText: { fontFamily: t.mono, fontSize: 15, lineHeight: 22, color: t.green },
    footer: { flexDirection: "row", alignItems: "center", gap: 10, padding: 20, borderTopWidth: 1, borderTopColor: t.line },
    iconButton: { alignItems: "center", gap: 2, paddingHorizontal: 4 },
    iconLabel: { fontFamily: t.mono, fontSize: 9, color: t.dim, letterSpacing: 1 },
    programRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: t.soft,
      padding: 14,
    },
    programRowActive: { borderColor: t.green },
    programName: { fontFamily: t.mono, fontSize: 15, fontWeight: "700", color: t.green },
  })
);
