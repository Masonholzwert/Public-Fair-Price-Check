import { createContext, useContext, useEffect, useState } from "react";
import { Platform, StyleSheet, Text, TextStyle } from "react-native";
import { Pressable } from "./press";

// Every course has its own look, matching the computers of its time.
// Screens never use fixed colors: they ask for the active theme with useTheme() or makeStyles().
export type Theme = {
  id: string;
  bg: string; // screen background
  surface: string; // cards and option boxes
  green: string; // main text and accent color (green on the BASIC terminal, white on the circuit board)
  dim: string; // secondary text
  line: string; // borders and dividers
  faint: string; // highlighted background
  red: string; // errors
  redFaint: string; // background for wrong answers
  doneBg: string; // background for finished lessons
  amber: string; // quests and projects
  amberFaint: string; // quest background
  radius: number;
  soft: number; // the rounder corners of the smooth look: cards, buttons, menus
  mono: string;
  glowColor: string | null; // soft CRT glow around text, or null for none
  amberGlowColor: string | null;
  button: "bracket" | "key" | "solid"; // [ CHECK ] terminal buttons, keypad keys, or solid IBM-blue buttons
  deep: string; // a darker background for menus and bars
  keyFace: string; // keypad key colors (only used when button = "key")
  keyText: string;
  keyEdge: string;
  bootLine: string; // small line at the top of the home screen
  prompt: string; // the computer's "ready" message, also shown for correct answers
  errorTag: string; // shown small next to wrong answers
  statusBar: "light" | "dark";
};

const mono = Platform.select({ ios: "Menlo", default: "monospace" }) as string;

// Dartmouth BASIC, 1964: green phosphor terminal
export const basicTheme: Theme = {
  id: "basic",
  bg: "#0B110D",
  surface: "#111A14",
  green: "#6FE89A",
  dim: "#4E8A64",
  line: "#1F3427",
  faint: "#15281C",
  red: "#FF6B6B",
  redFaint: "#2A1416",
  doneBg: "#143021",
  amber: "#FFB547",
  amberFaint: "#241B0D",
  radius: 10,
  soft: 22,
  mono,
  glowColor: "rgba(111, 232, 154, 0.35)",
  amberGlowColor: "rgba(255, 181, 71, 0.4)",
  button: "bracket",
  deep: "#0F1812",
  keyFace: "#6FE89A",
  keyText: "#0B110D",
  keyEdge: "#4E8A64",
  bootLine: "DARTMOUTH TIME-SHARING SYSTEM",
  prompt: "READY.",
  errorTag: "?SYNTAX ERROR",
  statusBar: "light",
};

// 6502 assembly, 1976: single-board computer with red LEDs and a hex keypad
export const kimTheme: Theme = {
  id: "kim",
  bg: "#0E3A28",
  surface: "#124631",
  green: "#EDF2E9",
  dim: "#8DB59D",
  line: "#23593F",
  faint: "#17503A",
  red: "#FF4A3D",
  redFaint: "#3D1714",
  doneBg: "#1E5E40",
  amber: "#F0C35A",
  amberFaint: "#30401F",
  radius: 6,
  soft: 16,
  mono,
  glowColor: null,
  amberGlowColor: null,
  button: "key",
  deep: "#0A2A1C",
  keyFace: "#E9E2C6",
  keyText: "#1C1A12",
  keyEdge: "#A99F7B",
  bootLine: "6502 TRAINER · 1 KB RAM",
  prompt: "READY",
  errorTag: "ERR",
  statusBar: "light",
};

// FORTRAN, 1957: IBM punch cards and a line printer
const courier = Platform.select({ ios: "Courier", default: "monospace" }) as string;
export const ibmTheme: Theme = {
  id: "ibm",
  bg: "#D9CFB4", // the manila of a card deck
  surface: "#F3EAD0", // a single card
  green: "#24211A", // main text: printer ink
  dim: "#8A6D3B",
  line: "#B9AB86",
  faint: "#E8DDBF",
  red: "#B5524A", // the red column numbers on the cards
  redFaint: "#F2D6CF",
  doneBg: "#CBD8EA", // finished: a pale IBM blue
  amber: "#8A5A00",
  amberFaint: "#F7E3A1",
  radius: 3,
  soft: 10,
  mono: courier,
  glowColor: null,
  amberGlowColor: null,
  button: "solid",
  deep: "#CDBF9C",
  keyFace: "#2F4F7F", // IBM blue
  keyText: "#FFFFFF",
  keyEdge: "#1D3354",
  bootLine: "IBM 704 · CARD READER READY",
  prompt: "JOB DONE",
  errorTag: "*ERROR*",
  statusBar: "dark",
};

// C, 1972: Unix on a PDP-11, amber phosphor terminal
export const unixTheme: Theme = {
  id: "unix",
  bg: "#120C02",
  surface: "#1B1305",
  green: "#FFB000", // main text: amber phosphor
  dim: "#A0700A",
  line: "#3A2900",
  faint: "#261A04",
  red: "#FF5A3C",
  redFaint: "#2E1208",
  doneBg: "#2C1F04",
  amber: "#FFE29A", // quests: a brighter, paler amber
  amberFaint: "#2A2108",
  radius: 4,
  soft: 12,
  mono,
  glowColor: "rgba(255, 176, 0, 0.45)",
  amberGlowColor: "rgba(255, 226, 154, 0.45)",
  button: "bracket",
  deep: "#0C0801",
  keyFace: "#FFB000",
  keyText: "#120C02",
  keyEdge: "#A0700A",
  bootLine: "PDP-11/45 · UNIX V6 · TTY0",
  prompt: "$",
  errorTag: "core dumped",
  statusBar: "light",
};

// Pascal, 1970, as most people met it: Turbo Pascal on an IBM PC (1983). Blue editor screen,
// yellow text, cyan highlights and green dialog buttons, in the 16 colors of a CGA card.
export const turboTheme: Theme = {
  id: "turbo",
  bg: "#0000A8",
  surface: "#0A0AB4",
  green: "#FFFF55", // main text: bright yellow, like the Turbo Pascal editor
  dim: "#A8A8D8",
  line: "#3A3AC8",
  faint: "#1414C0",
  red: "#FF5555",
  redFaint: "#3A1060",
  doneBg: "#00508A",
  amber: "#55FFFF", // quests and projects: bright cyan
  amberFaint: "#0A2E9A",
  radius: 2,
  soft: 8,
  mono,
  glowColor: null,
  amberGlowColor: null,
  button: "solid",
  deep: "#00007A",
  keyFace: "#00A800", // the green [ OK ] buttons of the Turbo Pascal dialogs
  keyText: "#000000",
  keyEdge: "#005400",
  bootLine: "TURBO PASCAL 3.0 · IBM PC · MS-DOS",
  prompt: "Compiled OK.",
  errorTag: "Error 85",
  statusBar: "light",
};

// COBOL, 1959, as it ran for decades: on an IBM System/370 mainframe, typed at a 3270 terminal.
// Black screen, green text, turquoise labels and yellow highlights, from the 3279 color terminal.
export const cobolTheme: Theme = {
  id: "cobol",
  bg: "#000000",
  surface: "#050C0C",
  green: "#4FE36A", // main text: the 3270's green
  dim: "#4FC7C7", // labels: turquoise, like the protected fields on the screen
  line: "#1F5C5C",
  faint: "#0B2B2B",
  red: "#FF5A5A",
  redFaint: "#2A0C0C",
  doneBg: "#0A2412",
  amber: "#F5E14B", // quests and projects: the yellow of highlighted fields
  amberFaint: "#262108",
  radius: 0,
  soft: 8,
  mono,
  glowColor: null,
  amberGlowColor: null,
  button: "solid",
  deep: "#000000",
  keyFace: "#4FE36A",
  keyText: "#000000",
  keyEdge: "#2A8A3C",
  bootLine: "IBM SYSTEM/370 · OS/VS COBOL · 3270",
  prompt: "RC=0000",
  errorTag: "ABEND",
  statusBar: "light",
};

// Machine code, 1975: the MITS Altair 8800. A black front panel with white lettering,
// red lights and silver toggle switches, and the blue stripe across the top.
export const altairTheme: Theme = {
  id: "altair",
  bg: "#15171B",
  surface: "#1E2228",
  green: "#ECEFF2", // main text: the white lettering on the panel
  dim: "#8C96A3",
  line: "#2E343C",
  faint: "#262C34",
  red: "#FF4B3E", // the red LEDs
  redFaint: "#3A1714",
  doneBg: "#22303F",
  amber: "#6FA8FF", // quests and projects: the Altair's blue stripe
  amberFaint: "#1A2536",
  radius: 4,
  soft: 12,
  mono,
  glowColor: null,
  amberGlowColor: null,
  button: "key",
  deep: "#0F1114",
  keyFace: "#E8E6DF", // silver paddle switches
  keyText: "#15171B",
  keyEdge: "#9C998F",
  bootLine: "MITS ALTAIR 8800 · INTEL 8080 · 256 BYTES",
  prompt: "RUN",
  errorTag: "WAIT",
  statusBar: "light",
};

// ---------- Theme context ----------

export const ThemeContext = createContext<Theme>(basicTheme);

export function useTheme() {
  return useContext(ThemeContext);
}

// Styles that depend on the theme. Created once per theme and then reused.
export function makeStyles<T>(factory: (t: Theme) => T) {
  const cache = new Map<string, T>();
  return function useStyles(): T {
    const t = useTheme();
    if (!cache.has(t.id)) cache.set(t.id, factory(t));
    return cache.get(t.id)!;
  };
}

// Soft glow around text, like on an old CRT screen (empty for themes without glow)
export function glowOf(color: string | null): TextStyle {
  if (!color) return {};
  return { textShadowColor: color, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 4 };
}

export function useGlow(): TextStyle {
  return glowOf(useTheme().glowColor);
}

export function useAmberGlow(): TextStyle {
  return glowOf(useTheme().amberGlowColor);
}

// ---------- Shared components ----------

// Blinking block cursor
export function Cursor({ size = 18 }: { size?: number }) {
  const t = useTheme();
  const glow = useGlow();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(timer);
  }, []);

  return <Text style={[{ color: t.green, fontFamily: t.mono, fontSize: size, opacity: visible ? 1 : 0 }, glow]}>█</Text>;
}

// The main button. On terminals it looks like [ LABEL ], on the circuit board like a keypad key.
// color: the default accent, t.red for "wrong", t.dim for a secondary button.
export function TermButton({
  label,
  onPress,
  disabled = false,
  color,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  const t = useTheme();
  const accent = color ?? t.green;

  if (t.button === "key") {
    const variant = accent === t.red ? "red" : accent === t.dim ? "dark" : "light";
    const face = variant === "red" ? "#C8372D" : variant === "dark" ? "#2B2B2B" : t.keyFace;
    const edge = variant === "red" ? "#7D1D16" : variant === "dark" ? "#000000" : t.keyEdge;
    const text = variant === "light" ? t.keyText : "#FFF6EE";
    return (
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          buttonStyles.key,
          { backgroundColor: face, borderBottomColor: edge, borderRadius: t.soft },
          pressed && { borderBottomWidth: 1, marginTop: 3 },
          disabled && { opacity: 0.4 },
        ]}
      >
        <Text style={[buttonStyles.keyText, { color: text, fontFamily: t.mono }]}>{label}</Text>
      </Pressable>
    );
  }

  // Solid IBM-blue buttons. Secondary ones are outlined, "wrong" ones red.
  if (t.button === "solid") {
    const variant = accent === t.red ? "red" : accent === t.dim ? "outline" : "blue";
    const face = variant === "red" ? t.red : variant === "outline" ? "transparent" : t.keyFace;
    const text = variant === "outline" ? t.keyFace : t.keyText;
    return (
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          buttonStyles.solid,
          { backgroundColor: face, borderColor: variant === "red" ? t.red : t.keyFace, borderRadius: t.soft },
          pressed && { opacity: 0.75 },
          disabled && { opacity: 0.35 },
        ]}
      >
        <Text style={[buttonStyles.solidText, { color: text, fontFamily: t.mono }]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        buttonStyles.button,
        { borderRadius: t.soft },
        disabled
          ? { borderColor: t.line, backgroundColor: t.surface }
          : { borderColor: accent, backgroundColor: pressed ? accent : t.faint },
      ]}
    >
      {({ pressed }) => (
        <Text style={[buttonStyles.text, { fontFamily: t.mono, color: disabled ? t.dim : pressed ? t.bg : accent }]}>
          [ {label} ]
        </Text>
      )}
    </Pressable>
  );
}

const buttonStyles = StyleSheet.create({
  button: { borderWidth: 1.5, paddingVertical: 15, alignItems: "center" },
  text: { fontSize: 16, fontWeight: "600", letterSpacing: 1 },
  key: { borderBottomWidth: 4, paddingVertical: 14, alignItems: "center" },
  solid: { borderWidth: 2, paddingVertical: 14, alignItems: "center" },
  solidText: { fontSize: 15, fontWeight: "700", letterSpacing: 3 },
  keyText: { fontSize: 15, fontWeight: "700", letterSpacing: 1.5 },
});
