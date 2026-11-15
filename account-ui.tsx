import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "./press";
import { signOutHere } from "./lib/account";
import { useSession } from "./lib/supabase";
import { sound } from "./sounds";
import { makeStyles, useTheme } from "./theme";

// Shown in the profile: which account you're signed in with, and signing out
export function AccountBox() {
  const t = useTheme();
  const s = useStyles();
  const session = useSession();
  if (!session) return null;
  return (
    <View style={s.box}>
      <Text style={s.title}>✓ Signed in as {session.user.email}</Text>
      <Text style={s.text}>
        Your progress, streak and sandbox programs are saved with this account. Sign in with the same e-mail on your phone or
        computer and you'll see the same thing.
      </Text>
      <Pressable
        onPress={() => {
          sound("back");
          signOutHere();
        }}
        hitSlop={8}
      >
        <Text style={[s.link, { color: t.dim }]}>SIGN OUT ON THIS DEVICE</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    box: { backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: t.soft, padding: 16, gap: 10 },
    title: { fontFamily: t.mono, fontSize: 14, fontWeight: "700", color: t.green },
    text: { fontFamily: t.mono, fontSize: 12, lineHeight: 18, color: t.green, opacity: 0.85 },
    link: { fontFamily: t.mono, fontSize: 11, letterSpacing: 1, paddingVertical: 4 },
  })
);
