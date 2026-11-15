import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ReactNode, useEffect, useState } from "react";
import { View } from "react-native";
import { AuthScreen } from "../../auth";
import { Onboarding } from "../../onboarding";
import { useOnboarded } from "../../lib/onboarding";
import { CourseProvider, useCourse } from "../../lib/active-course";
import { setUsageCourse, startUsageTracking } from "../../lib/usage";
import { startCloudSync } from "../../lib/cloud";
import { CONTENT_MAX, useWide } from "../../lib/layout";
import { startReminders } from "../../lib/reminders";
import { SideMenu, Sidebar } from "../../menu";
import { OpenMenuContext } from "../../rail";
import { useAuth } from "../../lib/supabase";
import { useSoundTheme } from "../../sounds";
import { useTheme } from "../../theme";

// Keep progress and sandbox programs the same on all devices signed in to one account
startCloudSync();
// Count the time spent in the app (for the profile)
startUsageTracking();

export default function RootLayout() {
  return (
    <CourseProvider>
      <ThemedStack />
    </CourseProvider>
  );
}

// The background and status bar follow the active course's theme
function ThemedStack() {
  const t = useTheme();
  useSoundTheme();
  const { course } = useCourse();
  useEffect(() => setUsageCourse(course.id), [course.id]);
  const wide = useWide();
  const { session, ready } = useAuth();
  const onboarding = useOnboarded(session?.user.id);
  // Daily reminders, once someone is signed in (phones only)
  useEffect(() => {
    if (session) startReminders();
  }, [session?.user.id]);

  // Everyone needs an account: until signed in, only the sign-in screen is shown.
  // (While the saved login is being read, just the background, so nothing flashes.)
  if (!ready) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!session) {
    return (
      <>
        <StatusBar style={t.statusBar} />
        <AuthScreen />
      </>
    );
  }

  // First time on this device: the short introduction (what the app is, pick a course, how it works)
  if (!onboarding.ready) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!onboarding.done) {
    return (
      <>
        <StatusBar style={t.statusBar} />
        <Onboarding />
      </>
    );
  }

  const stack = <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
  if (!wide) {
    return (
      <>
        <StatusBar style={t.statusBar} />
        <PhoneFrame>{stack}</PhoneFrame>
      </>
    );
  }
  // Big computer window: menu as a sidebar on the left, the screens next to it.
  // The screens use the full height, but stop growing at CONTENT_MAX so nothing gets stretched.
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.bg }}>
      <Sidebar />
      <View style={{ flex: 1, alignItems: "center" }}>
        <View style={{ flex: 1, width: "100%", maxWidth: CONTENT_MAX }}>{stack}</View>
      </View>
    </View>
  );
}

// On a phone: one slide-out menu for all screens. The rail that opens it is part of each menu screen
// (see WithRail), so it slides together with its screen and nothing changes size while a screen slides in.
function PhoneFrame({ children }: { children: ReactNode }) {
  const t = useTheme();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const active = pathname === "" ? "/" : pathname;
  return (
    <OpenMenuContext.Provider value={() => setMenuOpen(true)}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>{children}</View>
      <SideMenu visible={menuOpen} onClose={() => setMenuOpen(false)} active={active} />
    </OpenMenuContext.Provider>
  );
}
