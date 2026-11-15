import { Pressable as RNPressable } from "react-native";
import { soundCount, tap } from "./click";

// Pressable with a click: every tap makes the course's tap sound, unless the button
// already plays its own (opening a screen, a right or wrong answer, a switch).
// Use it everywhere instead of React Native's Pressable, so no button is ever silent.
type Props = Parameters<typeof RNPressable>[0] & { silent?: boolean }; // a button that makes its own sound later can be silent

export function Pressable({ onPress, silent, ...rest }: Props) {
  return (
    <RNPressable
      {...rest}
      onPress={
        onPress
          ? (e: Parameters<NonNullable<Props["onPress"]>>[0]) => {
              const before = soundCount();
              onPress(e);
              if (!silent && soundCount() === before) tap();
            }
          : undefined
      }
    />
  );
}
