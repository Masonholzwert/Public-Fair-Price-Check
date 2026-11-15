import { Ionicons } from "@expo/vector-icons";
import { WithRail } from "../../rail";
import { goBack, sound } from "../../sounds";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../press";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCourse } from "../../lib/active-course";
import type { Course } from "../../lib/course";
import { courses } from "../../lib/courses";
import { Progress, earnedXp, loadAdminMode, loadProgress } from "../../lib/progress";
import { CourseCard } from "../../course-card";
import { makeStyles } from "../../theme";

// Pick a course. Every card is drawn in its own course's design, like a window into its era.
// How much of a course is done: finished lessons, quests and projects out of all of them.
// Rounded down, so 100% only shows once everything is finished.
function percentDone(progress: Progress, ids: string[]) {
  if (ids.length === 0) return 0;
  return Math.floor((100 * ids.filter((id) => progress.done[id]).length) / ids.length);
}

// The screen, with the rail on its left on phones
export default function CoursesScreen() {
  return (
    <WithRail path="/courses">
      <CoursesScreenContent />
    </WithRail>
  );
}

function CoursesScreenContent() {
  const { course: active, setCourseId } = useCourse();
  const s = useStyles();
  const [progress, setProgress] = useState<Progress>({ done: {} });
  const [admin, setAdmin] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadProgress().then(setProgress);
      loadAdminMode().then(setAdmin);
    }, [])
  );

  function choose(course: Course) {
    setCourseId(course.id);
    sound("toggle");
    router.back();
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={s.back}>‹ BACK</Text>
        </Pressable>
        <Text style={[s.label, { marginTop: 20 }]}>COURSES</Text>
        <Text style={s.title}>Choose a language</Text>
        <Text style={s.subtitle}>Each course looks like the computers of its time.</Text>

        {courses.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            active={course.id === active.id}
            xp={earnedXp(progress, course.allStepIds())}
            percent={percentDone(progress, course.allStepIds())}
            // Admin mode can open courses before their lessons exist, to preview the design
            selectable={course.available || admin}
            onPress={() => choose(course)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 20, paddingBottom: 60 },
    back: { fontFamily: t.mono, fontSize: 13, color: t.dim, letterSpacing: 1 },
    label: { fontFamily: t.mono, fontSize: 11, color: t.dim, letterSpacing: 1.5 },
    title: { fontFamily: t.mono, fontSize: 26, fontWeight: "700", color: t.green, marginTop: 6 },
    subtitle: { fontFamily: t.mono, fontSize: 14, lineHeight: 22, color: t.green, opacity: 0.75, marginTop: 8, marginBottom: 8 },
  })
);
