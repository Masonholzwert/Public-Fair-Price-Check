import { type ReactNode, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Pressable } from "./press";
import { Alert } from "./lib/alert";
import { CPU, listing, mnemonic, oct3, parseProgram } from "./lib/altair";
import { sound } from "./sounds";
import { TermButton, makeStyles, useTheme } from "./theme";

// The real front panel of the Altair 8800, for the sandbox.
// Like in 1975: toggle a program in with the switches, byte by byte, then flip RUN and watch the lights.
//
//   EXAMINE       jump to the address set on switches A7–A0
//   EXAMINE NEXT  go to the next address
//   DEPOSIT       store the byte on switches A7–A0 at the current address
//   DEPOSIT NEXT  go to the next address and store the byte there
//   RESET         back to address 000 (memory stays)      CLR  clears the Teletype and the output lights
//   RUN / STOP    run from the current address, or stop
//   SINGLE STEP   run one instruction
//
// Switches A15–A8 are the sense switches: the running program reads them with IN 377, live.

const FAST_STEPS = 10_000; // instructions per tick: about 250,000 a second, near the real 2 MHz 8080
const FAST_TICK = 40;
const SLOW_TICK = 250; // 4 instructions a second, so you can follow the address lights

// Kill the Bit (Dean McDaniel, 1975): the most famous Altair game, made smaller for 256 bytes
const KILL_THE_BIT = [
  0o076, 0o001, // MVI A,1      one lit bit
  0o107, //        MOV B,A
  0o170, //        loop: MOV A,B
  0o323, 0o377, // OUT 377      show it
  0o016, 0o200, // MVI C,200    how long to wait (smaller = faster)
  0o026, 0o000, // wait: MVI D,0
  0o025, //        DCR D
  0o302, 0o012, 0o000, // JNZ 012
  0o015, //        DCR C
  0o302, 0o010, 0o000, // JNZ 010
  0o333, 0o377, // IN 377       read the sense switches
  0o250, //        XRA B        a switch that is up flips the bit under it
  0o007, //        RLC          move one place to the left
  0o107, //        MOV B,A
  0o303, 0o003, 0o000, // JMP loop
];
const KILL_THE_BIT_HEADER =
  "; KILL THE BIT (Dean McDaniel, 1975)\n" +
  "; RUN it on the PANEL. A light runs along the OUT 377 row.\n" +
  "; Flip the sense switch under the light up and straight back down\n" +
  "; to kill it. Miss, and you get an extra bit. Kill them all to win.\n" +
  "; Address 007 sets the speed: smaller is faster.\n";

// Columns from left to right: A15 … A0. A little gap before each octal group, like the real panel.
const COLUMNS = Array.from({ length: 16 }, (_, i) => 15 - i);
const groupStart = (bit: number) => bit === 14 || bit === 11 || bit === 8 || bit === 5 || bit === 2;

const PANEL = "#1D2027";
const STRIPE = "#5E8FC9";
const SILK = "#E6E9EE";
const SILK_DIM = "#8C96A3";

function Led({ on, size }: { on: boolean; size: number }) {
  const s = useStyles();
  return <View style={[s.led, { width: size, height: size, borderRadius: size / 2 }, on ? s.ledOn : s.ledOff]} />;
}

// A momentary control switch: push it up or down, and it springs back to the middle
function Paddle({ up, down, onUp, onDown }: { up: string; down: string; onUp: () => void; onDown?: () => void }) {
  const s = useStyles();
  const [pos, setPos] = useState<"mid" | "up" | "down">("mid");
  function press(dir: "up" | "down") {
    sound("toggle");
    setPos(dir);
    setTimeout(() => setPos("mid"), 160);
    if (dir === "down" && onDown) onDown();
    else onUp();
  }
  return (
    <View style={s.paddleColumn}>
      <Text style={s.paddleLabel} numberOfLines={2}>
        {up}
      </Text>
      <View style={[s.paddleSlot, { justifyContent: pos === "up" ? "flex-start" : pos === "down" ? "flex-end" : "center" }]}>
        <View style={s.paddleLever} />
      </View>
      <Text style={s.paddleLabel} numberOfLines={2}>
        {down}
      </Text>
      {/* The top half pushes up, the bottom half pushes down */}
      <Pressable style={[s.half, { top: 0 }]} onPress={() => press("up")} />
      <Pressable style={[s.half, { bottom: 0 }]} onPress={() => press("down")} />
    </View>
  );
}

export function AltairPanel({
  code,
  name,
  onExit,
  onSave,
  onDemo,
}: {
  code: string;
  name: string;
  onExit: () => void;
  onSave: (code: string) => void;
  onDemo: (name: string, code: string) => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();

  const cpu = useRef<CPU>(newCpu());
  const loadedLength = useRef(0);
  const [switches, setSwitches] = useState(0); // bit 15 … bit 0
  const switchesRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [fast, setFast] = useState(true);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  function newCpu() {
    const c = new CPU([], []);
    c.sense = () => (switchesRef.current >> 8) & 255;
    c.maxSteps = Infinity;
    return c;
  }

  // Put bytes into a fresh machine at address 000
  function loadBytes(bytes: number[]) {
    const c = newCpu();
    bytes.forEach((b, i) => (c.mem[i] = b));
    cpu.current = c;
    loadedLength.current = bytes.length;
    setRunning(false);
  }

  function loadFromProgram(source: string, label: string) {
    try {
      const { bytes } = parseProgram(source);
      loadBytes(bytes);
      setMessage({ text: `${label}: ${bytes.length} byte${bytes.length === 1 ? "" : "s"} at 000–${oct3(Math.max(0, bytes.length - 1))}. Flip RUN.` });
    } catch (e) {
      loadBytes([]);
      setMessage({ text: `Couldn't load the program: ${(e as Error).message} Memory is empty; toggle bytes in by hand.`, error: true });
    }
    refresh();
  }

  // Load the open program when the panel opens
  useEffect(() => {
    loadFromProgram(code, `Loaded ${name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The run loop: a batch of instructions per tick, then redraw the lights
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => {
        const c = cpu.current;
        const steps = fast ? FAST_STEPS : 1;
        try {
          for (let i = 0; i < steps; i++) {
            c.step();
            if (c.halted) {
              setRunning(false);
              setMessage({ text: `HLT at ${oct3(c.opAddr)}. The HLTA light is on. Press RESET (or EXAMINE an address), then RUN again.` });
              sound("complete");
              break;
            }
          }
        } catch (e) {
          c.pc = c.opAddr;
          setRunning(false);
          setMessage({ text: (e as Error).message, error: true });
          sound("wrong");
        }
        refresh();
      },
      fast ? FAST_TICK : SLOW_TICK
    );
    return () => clearInterval(timer);
  }, [running, fast]);

  function flip(bit: number) {
    sound("toggle");
    const next = switches ^ (1 << bit);
    switchesRef.current = next;
    setSwitches(next);
  }

  // ----- Control switches -----
  const c = cpu.current;
  const low = switches & 255;

  function needsStop(): boolean {
    if (running) setMessage({ text: "STOP the machine first." });
    return running;
  }
  function examine() {
    if (needsStop()) return;
    c.pc = low;
    c.halted = false;
    setMessage({ text: `EXAMINE ${oct3(low)}: the data lights show what is stored there.` });
    refresh();
  }
  function examineNext() {
    if (needsStop()) return;
    c.pc = (c.pc + 1) & 255;
    c.halted = false;
    setMessage(null);
    refresh();
  }
  function deposit() {
    if (needsStop()) return;
    c.mem[c.pc & 255] = low;
    loadedLength.current = Math.max(loadedLength.current, (c.pc & 255) + 1);
    setMessage({ text: `DEPOSIT: ${oct3(low)} stored at ${oct3(c.pc)}.` });
    refresh();
  }
  function depositNext() {
    if (needsStop()) return;
    c.pc = (c.pc + 1) & 255;
    c.halted = false;
    c.mem[c.pc] = low;
    loadedLength.current = Math.max(loadedLength.current, c.pc + 1);
    setMessage({ text: `DEPOSIT NEXT: ${oct3(low)} stored at ${oct3(c.pc)}.` });
    refresh();
  }
  function reset() {
    c.pc = 0;
    c.halted = false;
    setMessage({ text: "RESET: back to address 000. Memory is still there." });
    refresh();
  }
  function clear() {
    c.output = "";
    c.port377 = 0;
    setMessage(null);
    refresh();
  }
  function run() {
    if (running) return;
    if (c.halted) {
      setMessage({ text: "The machine is halted. Press RESET (or EXAMINE an address) first." });
      return;
    }
    sound("run");
    setMessage({ text: fast ? "Running. Flip STOP to stop." : "Running slowly: watch the address lights. Flip STOP to stop." });
    setRunning(true);
  }
  function stop() {
    if (!running) return;
    setRunning(false);
    setMessage({ text: `Stopped at ${oct3(c.pc)}.` });
  }
  function singleStep() {
    if (running) return;
    if (c.halted) {
      setMessage({ text: "The machine is halted. Press RESET (or EXAMINE an address) first." });
      return;
    }
    const at = c.pc;
    const op = c.mem[at & 255];
    try {
      c.step();
      setMessage({ text: c.halted ? `HLT at ${oct3(at)}.` : `Ran ${oct3(at)}: ${mnemonic(op)}.` });
    } catch (e) {
      c.pc = c.opAddr;
      setMessage({ text: (e as Error).message, error: true });
    }
    refresh();
  }

  function save() {
    let last = -1;
    for (let i = 255; i >= 0; i--)
      if (c.mem[i] !== 0) {
        last = i;
        break;
      }
    const length = Math.max(loadedLength.current, last + 1);
    if (length === 0) {
      setMessage({ text: "Memory is empty: nothing to save yet.", error: true });
      return;
    }
    Alert.alert(`Save to ${name}?`, `The program's code is replaced by the ${length} bytes in memory (000–${oct3(length - 1)}), with new comments.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: () => {
          onSave(`; ${name}, saved from the front panel\n` + listing(c.mem, length));
          sound("complete");
          setMessage({ text: `Saved ${length} bytes to ${name}.` });
        },
      },
    ]);
  }

  function killTheBit() {
    setRunning(false);
    onDemo("KILL THE BIT", KILL_THE_BIT_HEADER + listing(KILL_THE_BIT, KILL_THE_BIT.length));
    loadBytes(KILL_THE_BIT);
    switchesRef.current = 0;
    setSwitches(0);
    setFast(true);
    setMessage({ text: "Kill the Bit is loaded (and saved as a new program). Flip RUN, then knock out the light with the sense switches A15–A8." });
    refresh();
  }

  // ----- What the lights show -----
  const pc = c.pc & 0xffff;
  const data = pc < 256 ? c.mem[pc] : 0;
  const lit = (value: number, bit: number) => ((value >> bit) & 1) === 1;
  const status: [string, boolean][] = [
    ["INTE", false],
    ["PROT", false],
    ["MEMR", true],
    ["INP", c.lastIO === "in"],
    ["M1", !running],
    ["OUT", c.lastIO === "out"],
    ["HLTA", c.halted],
    ["STACK", false],
    ["WO", true],
    ["INT", false],
    ["WAIT", !running],
    ["HLDA", false],
  ];

  // Size the columns so all 16 switches fit the screen
  const col = Math.max(14, Math.min(22, Math.floor((Math.min(width, 520) - 40 - 20 - 5 * 6) / 16)));
  const ledSize = Math.min(11, col - 5);

  const row = (render: (bit: number) => ReactNode) => (
    <View style={s.row}>
      {COLUMNS.map((bit) => (
        <View key={bit} style={[{ width: col, alignItems: "center" }, groupStart(bit) && { marginLeft: 6 }]}>
          {render(bit)}
        </View>
      ))}
    </View>
  );
  const caption = (left: string, right: string) => (
    <View style={s.captionRow}>
      <Text style={s.caption}>{left}</Text>
      <Text style={s.caption}>{right}</Text>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <Pressable onPress={onExit} hitSlop={10}>
        <Text style={s.back}>‹ BACK TO THE LISTING</Text>
      </Pressable>

      <View style={s.panel}>
        {/* The blue stripe with the name, like the real case */}
        <View style={s.stripe}>
          <Text style={s.brand}>ALTAIR 8800</Text>
          <Text style={s.maker}>MITS · COMPUTER</Text>
        </View>

        <View style={s.inner}>
          {/* Status lights */}
          <View style={s.statusRow}>
            {status.map(([label, on]) => (
              <View key={label} style={s.statusItem}>
                <Led on={on} size={ledSize - 1} />
                <Text style={s.tiny}>{label}</Text>
              </View>
            ))}
          </View>

          {/* Output lights (port 377) and data lights */}
          {caption("OUT 377", "DATA")}
          {row((bit) => (
            <>
              <Led on={bit >= 8 ? lit(c.port377, bit - 8) : lit(data, bit)} size={ledSize} />
              <Text style={s.tiny}>{bit >= 8 ? bit - 8 : `D${bit}`}</Text>
            </>
          ))}

          {/* Address lights */}
          {caption("ADDRESS", "")}
          {row((bit) => (
            <>
              <Led on={lit(pc, bit)} size={ledSize} />
              <Text style={s.tiny}>A{bit}</Text>
            </>
          ))}

          {/* Toggle switches */}
          {caption("SENSE · IN 377", "ADDRESS / DATA")}
          {row((bit) => {
            const on = lit(switches, bit);
            return (
              <Pressable onPress={() => flip(bit)} hitSlop={3} style={{ alignItems: "center", gap: 3 }}>
                <View style={[s.slot, { width: col - 4, justifyContent: on ? "flex-start" : "flex-end" }]}>
                  <View style={[s.lever, { width: col - 9 }]} />
                </View>
                <Text style={s.tiny}>{bit}</Text>
              </Pressable>
            );
          })}

          {/* A readout in words, for learners */}
          <Text style={s.readout}>
            ADDRESS {oct3(pc)} · DATA {oct3(data)} {mnemonic(data) !== "?" ? `(${mnemonic(data)})` : ""} · SWITCHES {oct3(low)}
          </Text>
          <Text style={s.readoutDim}>
            A {oct3(c.r[7])}  B {oct3(c.r[0])}  C {oct3(c.r[1])}  D {oct3(c.r[2])}  E {oct3(c.r[3])}  H {oct3(c.r[4])}  L {oct3(c.r[5])}
          </Text>

          {/* Control switches */}
          <View style={s.controls}>
            <Paddle up="STOP" down="RUN" onUp={stop} onDown={run} />
            <Paddle up="SINGLE STEP" down="" onUp={singleStep} />
            <Paddle up="EXAMINE" down="EXAMINE NEXT" onUp={examine} onDown={examineNext} />
            <Paddle up="DEPOSIT" down="DEPOSIT NEXT" onUp={deposit} onDown={depositNext} />
            <Paddle up="RESET" down="CLR" onUp={reset} onDown={clear} />
          </View>
        </View>
      </View>

      {/* Speed */}
      <View style={s.speedRow}>
        <Text style={s.speedLabel}>SPEED</Text>
        {[
          ["FULL", true],
          ["SLOW", false],
        ].map(([label, value]) => (
          <Pressable
            key={String(label)}
            onPress={() => {
              sound("tap");
              setFast(value as boolean);
            }}
            style={[s.chip, fast === value && { borderColor: t.amber, backgroundColor: t.amberFaint }]}
          >
            <Text style={[s.chipText, fast === value && { color: t.amber }]}>{label as string}</Text>
          </Pressable>
        ))}
      </View>

      {message && <Text style={[s.message, message.error && { color: t.red }]}>{message.text}</Text>}

      {/* Teletype */}
      {c.output !== "" && (
        <View style={s.teletype}>
          <Text style={[s.caption, { color: "#6B6658" }]}>TELETYPE · OUT 001</Text>
          <Text style={s.teletypeText}>{c.output.replace(/\n$/, "")}</Text>
        </View>
      )}

      <View style={s.help}>
        <Text style={s.helpTitle}>HOW TO USE THE PANEL</Text>
        <Text style={s.helpText}>
          {"• Up is 1. Switches A7–A0 hold an address or a byte.\n" +
            "• Set an address, then EXAMINE: the data lights show what is stored there.\n" +
            "• Toggling a program in: EXAMINE 000, set the first byte, DEPOSIT. Then for each next byte: set it, DEPOSIT NEXT.\n" +
            "• RESET, then RUN. SINGLE STEP runs one instruction at a time.\n" +
            "• A15–A8 are the sense switches. A running program reads them with IN 377, and its OUT 377 shows on the top-left lights."}
        </Text>
      </View>

      <TermButton label="SAVE MEMORY TO PROGRAM" onPress={save} />
      <TermButton label={`LOAD ${name} AGAIN`} color={t.dim} onPress={() => loadFromProgram(code, `Loaded ${name}`)} />
      <TermButton label="PLAY KILL THE BIT" color={t.dim} onPress={killTheBit} />
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    back: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    panel: { backgroundColor: PANEL, borderRadius: 6, borderWidth: 1, borderColor: "#353B45", overflow: "hidden" },
    stripe: { backgroundColor: STRIPE, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6 },
    brand: { fontFamily: t.mono, fontSize: 16, fontWeight: "700", color: "#0E1626", letterSpacing: 2 },
    maker: { fontFamily: t.mono, fontSize: 9, color: "#0E1626", letterSpacing: 1.5 },
    inner: { padding: 10, gap: 6, alignItems: "center" },
    statusRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginBottom: 4 },
    statusItem: { alignItems: "center", gap: 2, minWidth: 22 },
    row: { flexDirection: "row", alignItems: "flex-start" },
    captionRow: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch", marginTop: 6, paddingHorizontal: 2 },
    caption: { fontFamily: t.mono, fontSize: 9, color: SILK, letterSpacing: 1.2, fontWeight: "700" },
    tiny: { fontFamily: t.mono, fontSize: 7, color: SILK_DIM, marginTop: 2 },
    led: { borderWidth: 1 },
    ledOn: {
      backgroundColor: "#FF3B26",
      borderColor: "#FF8A75",
      shadowColor: "#FF3B26",
      shadowOpacity: 0.9,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 0 },
    },
    ledOff: { backgroundColor: "#3A1410", borderColor: "#521C16" },
    slot: { height: 32, borderRadius: 3, backgroundColor: "#2A2E34", borderWidth: 1, borderColor: "#3C424A", alignItems: "center", paddingVertical: 2 },
    lever: { height: 15, borderRadius: 2, backgroundColor: "#E8E6DF", borderWidth: 1, borderColor: "#9C998F" },
    readout: { fontFamily: t.mono, fontSize: 10, color: SILK, marginTop: 8, textAlign: "center" },
    readoutDim: { fontFamily: t.mono, fontSize: 9, color: SILK_DIM, textAlign: "center" },
    controls: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#353B45" },
    paddleColumn: { width: 58, alignItems: "center", gap: 4 },
    paddleLabel: { fontFamily: t.mono, fontSize: 7.5, color: SILK, textAlign: "center", height: 20, letterSpacing: 0.5 },
    paddleSlot: { width: 22, height: 46, borderRadius: 4, backgroundColor: "#2A2E34", borderWidth: 1, borderColor: "#3C424A", alignItems: "center", paddingVertical: 2 },
    paddleLever: { width: 16, height: 18, borderRadius: 3, backgroundColor: "#E8E6DF", borderWidth: 1, borderColor: "#9C998F" },
    half: { position: "absolute", left: 0, right: 0, height: "50%" },
    speedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    speedLabel: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5, marginRight: 4 },
    chip: { borderWidth: 1.5, borderColor: t.line, borderRadius: t.radius, paddingHorizontal: 12, paddingVertical: 6 },
    chipText: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1 },
    message: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green },
    teletype: { backgroundColor: "#ECE7D6", borderRadius: t.radius, padding: 12, gap: 6 },
    teletypeText: { fontFamily: t.mono, fontSize: 14, lineHeight: 20, color: "#1E1E1E" },
    help: { backgroundColor: t.amberFaint, borderRadius: t.radius, borderLeftWidth: 3, borderLeftColor: t.amber, padding: 12, gap: 6 },
    helpTitle: { fontFamily: t.mono, fontSize: 11, color: t.amber, letterSpacing: 1.5, fontWeight: "700" },
    helpText: { fontFamily: t.mono, fontSize: 11, lineHeight: 17, color: t.green },
  })
);
