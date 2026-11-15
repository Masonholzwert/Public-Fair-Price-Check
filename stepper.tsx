import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AsmMachine, MachineState, createMachine, describeMemory, toHex } from "./lib/asm6502";
import { MachinePanel } from "./led";
import { sound } from "./sounds";
import { TermButton, makeStyles, useTheme } from "./theme";

// Step mode: run a 6502 program one instruction at a time, like the KIM-1's single-step switch.
// The yellow line runs next, the note says what it will do, the LEDs show what just changed.
export function StepView({
  code,
  memory,
  keys,
  onExit,
}: {
  code: string;
  memory?: Record<string, number>;
  keys?: string;
  onExit: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const fresh = () => createMachine(code, { memory, keys });
  const machine = useRef<AsmMachine>(fresh());
  const [count, setCount] = useState(0); // steps taken, also forces a redraw
  const [changed, setChanged] = useState<string[]>([]);

  const m = machine.current;
  const state = m.state();
  const finished = m.result() !== null;
  const current = finished ? null : m.line();
  const lines = code.split("\n");

  // What changed between two states: registers and memory addresses
  function diff(before: MachineState | null, after: MachineState | null): string[] {
    if (!before || !after) return [];
    const out: string[] = [];
    if (before.a !== after.a) out.push("A");
    if (before.x !== after.x) out.push("X");
    if (before.y !== after.y) out.push("Y");
    for (const [addr, value] of Object.entries(after.mem)) if (before.mem[addr] !== value) out.push(addr);
    return out;
  }

  function step() {
    if (finished) return;
    const before = m.state().machine;
    const result = m.step();
    sound(result ? (result.error ? "wrong" : "complete") : "tap");
    setChanged(diff(before, m.state().machine));
    setCount((c) => c + 1);
  }

  function toEnd() {
    if (finished) return;
    const before = m.state().machine;
    let n = 0;
    while (!m.step()) n++;
    sound(m.result()?.error ? "wrong" : "run");
    setChanged(diff(before, m.state().machine));
    setCount((c) => c + n + 1);
  }

  function reset() {
    sound("back");
    machine.current = fresh();
    setChanged([]);
    setCount(0);
  }

  const note = useMemo(() => {
    const result = m.result();
    if (result?.error) return { title: "Stopped with an error", text: result.error, error: true };
    if (result) return { title: `Finished after ${count} step${count === 1 ? "" : "s"}`, text: "BRK or the last RTS ended the program. RESET to watch it again.", error: false };
    return { title: "Next", text: m.explain(), error: false };
  }, [count]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.header}>
          <Text style={s.label}>STEP MODE</Text>
          <Text style={s.label}>STEP {count}</Text>
        </View>
        {(memory || keys) && (
          <Text style={s.small}>
            Test 1{memory ? ` · ${describeMemory(memory)}` : ""}
            {keys ? ` · keys ${keys.split("").join(" ")}` : ""}
          </Text>
        )}

        {/* The program, with its addresses. The yellow line runs next. */}
        <View style={s.listing}>
          {lines.map((text, index) => {
            if (text.trim() === "") return null;
            const lineNo = index + 1;
            const address = m.addressOf(lineNo);
            const isCurrent = lineNo === current;
            return (
              <View key={index} style={[s.line, isCurrent && { backgroundColor: t.amber }]}>
                <Text style={[s.address, isCurrent && { color: t.keyText }]}>
                  {address !== null ? `$${toHex(address, 4)}` : ""}
                </Text>
                <Text style={[s.code, isCurrent && { color: t.keyText, fontWeight: "700" }]} numberOfLines={1}>
                  {isCurrent ? "▶ " : "  "}
                  {text.trim()}
                </Text>
              </View>
            );
          })}
        </View>

        {/* What happens next, in plain words */}
        <View style={[s.note, note.error && { borderLeftColor: t.red }]}>
          <Text style={[s.noteTitle, note.error && { color: t.red }]}>{note.title}</Text>
          <Text style={s.noteText}>{note.text}</Text>
        </View>

        {/* Teletype output so far */}
        {state.output !== "" && (
          <View style={s.teletype}>
            <Text style={s.label}>TELETYPE</Text>
            <Text style={s.code}>{state.output}</Text>
          </View>
        )}

        {state.machine && <MachinePanel machine={state.machine} pc={m.pc()} changed={changed} />}
      </ScrollView>

      <View style={s.footer}>
        <View style={{ flex: 1 }}>
          <TermButton label="RESET" color={t.dim} onPress={reset} />
        </View>
        <View style={{ flex: 1.6 }}>
          <TermButton label="STEP ▶" onPress={step} disabled={finished} />
        </View>
        <View style={{ flex: 1 }}>
          <TermButton label="END" color={t.dim} onPress={toEnd} disabled={finished} />
        </View>
      </View>
      <View style={s.exitRow}>
        <TermButton label="BACK TO EDITING" color={t.dim} onPress={onExit} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    body: { padding: 20, gap: 10 },
    header: { flexDirection: "row", justifyContent: "space-between" },
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    small: { fontFamily: t.mono, fontSize: 11, color: t.dim },
    listing: { backgroundColor: t.surface, borderRadius: t.soft, paddingVertical: 6 },
    line: { flexDirection: "row", gap: 10, paddingVertical: 3, paddingHorizontal: 10 },
    address: { fontFamily: t.mono, fontSize: 11, color: t.dim, width: 44, lineHeight: 20 },
    code: { flex: 1, fontFamily: t.mono, fontSize: 13, lineHeight: 20, color: t.green },
    note: { backgroundColor: t.amberFaint, borderLeftWidth: 3, borderLeftColor: t.amber, borderRadius: t.soft, padding: 12, gap: 4 },
    noteTitle: { fontFamily: t.mono, fontSize: 13, fontWeight: "700", color: t.green },
    noteText: { fontFamily: t.mono, fontSize: 13, lineHeight: 19, color: t.green },
    teletype: { backgroundColor: t.bg, borderRadius: t.soft, borderWidth: 1, borderColor: t.line, padding: 12, gap: 4 },
    footer: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line },
    exitRow: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  })
);
