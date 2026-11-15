import { StyleSheet, Text, View } from "react-native";
import { makeStyles } from "./theme";

// Everyone signs in at the start now, so the online screens normally never show this.
// It's only a fallback, e.g. while the login is being refreshed.
export function SignInButtons({ why }: { why: string }) {
  const s = useStyles();
  return (
    <View style={s.box}>
      <Text style={s.title}>Not signed in</Text>
      <Text style={s.text}>{why}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    box: { backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: t.soft, padding: 16, gap: 10 },
    title: { fontFamily: t.mono, fontSize: 15, fontWeight: "700", color: t.green },
    text: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green, opacity: 0.85 },
  })
);
