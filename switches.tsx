import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "./press";
import { useSound } from "./sounds";
import { makeStyles, useTheme } from "./theme";

// The Altair 8800 front panel: a row of red lights with a toggle switch under each one.
// Switch 7 is on the left (worth 128), switch 0 on the right (worth 1). Up means 1.
// Like on the real panel, the switches are grouped in threes from the right (2 + 3 + 3),
// because programmers read them as octal digits.
export function SwitchPanel({
  value,
  onChange,
  disabled = false,
  bits = 8,
  result,
}: {
  value: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  bits?: number;
  result?: "right" | "wrong";
}) {
  const t = useTheme();
  const s = useStyles();
  const play = useSound();
  const positions = Array.from({ length: bits }, (_, i) => bits - 1 - i); // 7 … 0

  function flip(bit: number) {
    if (disabled || !onChange) return;
    play("toggle");
    onChange(value ^ (1 << bit));
  }

  return (
    <View style={[s.panel, result === "right" && { borderColor: t.green }, result === "wrong" && { borderColor: t.red }]}>
      <View style={s.row}>
        {positions.map((bit) => {
          const on = (value >> bit) & 1;
          const gap = bit === 5 || bit === 2; // a little space before each group of three
          return (
            <Pressable key={bit} onPress={() => flip(bit)} disabled={disabled || !onChange} style={[s.column, gap && s.groupGap]} hitSlop={4}>
              {/* LED */}
              <View style={[s.led, on ? s.ledOn : s.ledOff]} />
              <Text style={s.label}>D{bit}</Text>
              {/* Toggle switch: the paddle points up for 1 */}
              <View style={[s.slot, { justifyContent: on ? "flex-start" : "flex-end" }]}>
                <View style={s.paddle} />
              </View>
              <Text style={s.weight}>{1 << bit}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    panel: {
      alignSelf: "center",
      backgroundColor: "#121417",
      borderRadius: t.radius + 4,
      borderWidth: 1.5,
      borderColor: t.line,
      paddingVertical: 14,
      paddingHorizontal: 10,
      marginVertical: 8,
    },
    row: { flexDirection: "row", alignItems: "flex-start" },
    column: { alignItems: "center", width: 36, gap: 5 },
    groupGap: { marginRight: 10 },
    led: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
    ledOn: {
      backgroundColor: "#FF3B26",
      borderColor: "#FF8A75",
      shadowColor: "#FF3B26",
      shadowOpacity: 0.9,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
    },
    ledOff: { backgroundColor: "#3A1410", borderColor: "#521C16" },
    label: { fontFamily: t.mono, fontSize: 9, color: "#B9C0C8", letterSpacing: 0.5 },
    slot: {
      width: 18,
      height: 40,
      borderRadius: 4,
      backgroundColor: "#2A2E34",
      borderWidth: 1,
      borderColor: "#3C424A",
      alignItems: "center",
      paddingVertical: 2,
    },
    paddle: { width: 12, height: 20, borderRadius: 3, backgroundColor: "#E8E6DF", borderWidth: 1, borderColor: "#9C998F" },
    weight: { fontFamily: t.mono, fontSize: 9, color: "#6F7883" },
  })
);
