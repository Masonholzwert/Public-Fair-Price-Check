import { StyleSheet, Text, View } from "react-native";
import type { MachineState } from "./lib/asm6502";
import { toHex } from "./lib/asm6502";
import { makeStyles, useTheme } from "./theme";

// Red seven-segment LEDs, like the display of a KIM-1
const LED_ON = "#FF3B2F";
const LED_OFF = "#3A0E0B";
const LED_GLOW = { textShadowColor: "rgba(255, 59, 47, 0.75)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 };

// Two hex digits behind dark red glass
function LedDigits({ value, label, digits = 2, changed = false }: { value: number; label: string; digits?: number; changed?: boolean }) {
  const s = useStyles();
  const t = useTheme();
  const small = digits > 2;
  return (
    <View style={s.register}>
      <View style={[s.glass, changed && { borderColor: t.amber, borderWidth: 2 }]}>
        {/* Unlit "88" behind the digits, so it looks like a real LED display */}
        <Text style={[s.digits, small && s.digitsSmall, { color: LED_OFF }]}>{"8".repeat(digits)}</Text>
        <Text style={[s.digits, small && s.digitsSmall, s.lit, LED_GLOW]}>{toHex(value, digits)}</Text>
      </View>
      <Text style={s.silk}>{label}</Text>
    </View>
  );
}

// One small round LED per flag
function FlagLed({ on, label }: { on: boolean; label: string }) {
  const s = useStyles();
  return (
    <View style={s.flag}>
      <View style={[s.dot, on ? s.dotOn : s.dotOff]} />
      <Text style={s.flagLabel}>{label}</Text>
    </View>
  );
}

// Registers, flags and the memory the program changed
// pc: show the program counter too (step mode). changed: registers that just changed get a yellow frame.
export function MachinePanel({ machine, pc, changed = [] }: { machine: MachineState; pc?: number; changed?: string[] }) {
  const s = useStyles();
  const t = useTheme();
  const f = machine.flags;
  const mem = Object.entries(machine.mem);
  return (
    <View style={s.panel}>
      <Text style={s.title}>REGISTERS</Text>
      <View style={s.registers}>
        <LedDigits value={machine.a} label="A" changed={changed.includes("A")} />
        <LedDigits value={machine.x} label="X" changed={changed.includes("X")} />
        <LedDigits value={machine.y} label="Y" changed={changed.includes("Y")} />
        {pc !== undefined && (
          <View style={{ marginLeft: "auto" }}>
            <LedDigits value={pc} label="PC" digits={4} />
          </View>
        )}
      </View>

      <View style={s.flags}>
        <FlagLed on={f.n} label="N" />
        <FlagLed on={f.v} label="V" />
        <FlagLed on={f.d} label="D" />
        <FlagLed on={f.i} label="I" />
        <FlagLed on={f.z} label="Z" />
        <FlagLed on={f.c} label="C" />
      </View>

      <Text style={[s.title, { marginTop: 14 }]}>MEMORY</Text>
      {mem.length === 0 ? (
        <Text style={s.memEmpty}>Nothing stored.</Text>
      ) : (
        <View style={s.memGrid}>
          {mem.slice(0, 24).map(([addr, value]) => (
            <View key={addr} style={[s.memCell, changed.includes(addr) && { borderColor: t.amber, borderWidth: 1.5 }]}>
              <Text style={s.memAddr}>${addr}</Text>
              <Text style={[s.memValue, LED_GLOW]}>{toHex(value)}</Text>
            </View>
          ))}
          {mem.length > 24 && <Text style={[s.memEmpty, { color: t.dim }]}>+{mem.length - 24} more</Text>}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    panel: {
      backgroundColor: "#141414",
      borderRadius: t.radius,
      borderWidth: 1,
      borderColor: "#000",
      padding: 14,
    },
    title: { fontFamily: t.mono, fontSize: 10, letterSpacing: 2, color: "#8C8C8C", marginBottom: 8 },
    registers: { flexDirection: "row", gap: 14 },
    register: { alignItems: "center", gap: 4 },
    glass: {
      backgroundColor: "#1E0605",
      borderRadius: 4,
      borderWidth: 1,
      borderColor: "#000",
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    digits: { fontFamily: t.mono, fontSize: 30, fontWeight: "700", fontStyle: "italic", letterSpacing: 2 },
    digitsSmall: { fontSize: 19, lineHeight: 36 },
    lit: { position: "absolute", left: 8, top: 2, color: LED_ON },
    silk: { fontFamily: t.mono, fontSize: 12, fontWeight: "700", color: "#E9E2C6" },
    flags: { flexDirection: "row", gap: 12, marginTop: 14 },
    flag: { alignItems: "center", gap: 4 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    dotOn: {
      backgroundColor: LED_ON,
      shadowColor: LED_ON,
      shadowOpacity: 0.9,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 0 },
    },
    dotOff: { backgroundColor: LED_OFF },
    flagLabel: { fontFamily: t.mono, fontSize: 10, color: "#E9E2C6" },
    memGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    memCell: {
      flexDirection: "row",
      gap: 6,
      backgroundColor: "#1E0605",
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    memAddr: { fontFamily: t.mono, fontSize: 12, color: "#8C8C8C" },
    memValue: { fontFamily: t.mono, fontSize: 12, fontWeight: "700", color: LED_ON },
    memEmpty: { fontFamily: t.mono, fontSize: 12, color: "#8C8C8C" },
  })
);
