import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "./press";
import { showInPicture } from "./lib/cobol";
import { useSound } from "./sounds";
import { makeStyles, useTheme } from "./theme";

// COBOL's PIC exercise: build a picture from symbol keys until the field prints exactly what's asked.
// Any picture that prints the target text counts as right.
const DEFAULT_KEYS = ["9", "Z", "$", ",", ".", "*", "-", "CR"];

// What a value looks like in a picture, or null if the picture isn't valid
export function tryPicture(pic: string, value: string): string | null {
  if (!pic) return null;
  try {
    return showInPicture(pic, value);
  } catch {
    return null;
  }
}

export function PictureBuilder({
  value,
  target,
  pic,
  onChange,
  keys,
  disabled = false,
  result,
}: {
  value: string; // the number that goes into the field, like "1234.5"
  target: string; // what the statement must show, like "$1,234.50"
  pic: string;
  onChange?: (pic: string) => void;
  keys?: string[];
  disabled?: boolean;
  result?: "right" | "wrong";
}) {
  const t = useTheme();
  const s = useStyles();
  const play = useSound();
  const shown = tryPicture(pic, value);

  function press(k: string) {
    if (disabled || !onChange) return;
    play("tap");
    if (k === "DEL") onChange(pic.endsWith("CR") || pic.endsWith("DB") ? pic.slice(0, -2) : pic.slice(0, -1));
    else if (pic.length < 20) onChange(pic + k);
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        <Text style={s.label}>THE FIELD MUST SHOW · VALUE {value}</Text>
        <View style={s.boxes}>
          {target.split("").map((ch, i) => (
            <View key={i} style={s.box}>
              <Text style={s.boxText}>{ch === " " ? "·" : ch}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={s.label}>YOUR PICTURE</Text>
        <View style={[s.field, result === "right" && { borderColor: t.green }, result === "wrong" && { borderColor: t.red }]}>
          <Text style={[s.fieldText, { color: t.dim }]}>PIC </Text>
          <Text style={s.fieldText}>{pic}</Text>
          {!disabled && <View style={[s.cursor, { backgroundColor: t.green }]} />}
        </View>
        <Text style={s.hint}>
          {pic === "" ? "Tap the symbols below." : shown === null ? "That isn't a valid picture yet." : `Shows now: [${shown}]`}
        </Text>
      </View>

      {onChange && (
        <View style={s.keys}>
          {[...(keys ?? DEFAULT_KEYS), "DEL"].map((k) => (
            <Pressable
              key={k}
              disabled={disabled}
              onPress={() => press(k)}
              style={({ pressed }) => [s.key, k === "DEL" && { borderColor: t.red }, pressed && { backgroundColor: t.faint }, disabled && { opacity: 0.4 }]}
            >
              <Text style={[s.keyText, k === "DEL" && { color: t.red, fontSize: 13 }]}>{k}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    hint: { fontFamily: t.mono, fontSize: 12, color: t.dim },
    boxes: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
    box: { minWidth: 26, paddingVertical: 8, borderWidth: 1, borderColor: t.line, alignItems: "center" },
    boxText: { fontFamily: t.mono, fontSize: 17, color: t.green },
    field: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: t.line, backgroundColor: t.surface, padding: 14 },
    fieldText: { fontFamily: t.mono, fontSize: 19, color: t.green },
    cursor: { width: 10, height: 20, marginLeft: 2 },
    keys: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    key: { width: "22%", minHeight: 50, borderWidth: 1.5, borderColor: t.line, alignItems: "center", justifyContent: "center" },
    keyText: { fontFamily: t.mono, fontSize: 20, color: t.green },
  })
);
