import AsyncStorage from "@react-native-async-storage/async-storage";
import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { ThemeContext } from "../theme";
import { basicCourse, courseById } from "./courses";
import type { Course } from "./course";

const KEY = "basic-lingo-active-course";

type CourseState = { course: Course; setCourseId: (id: string) => void };

const CourseContext = createContext<CourseState>({ course: basicCourse, setCourseId: () => {} });

// Remembers which course is open, and gives every screen that course's theme
export function CourseProvider({ children }: { children: ReactNode }) {
  const [courseId, setId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => setId(saved && courseById(saved)?.available ? saved : basicCourse.id))
      .catch(() => setId(basicCourse.id));
  }, []);

  function setCourseId(id: string) {
    setId(id);
    AsyncStorage.setItem(KEY, id).catch(() => {});
  }

  if (courseId === null) return null; // wait a moment until the saved course is loaded

  const course = courseById(courseId) ?? basicCourse;
  return (
    <CourseContext.Provider value={{ course, setCourseId }}>
      <ThemeContext.Provider value={course.theme}>{children}</ThemeContext.Provider>
    </CourseContext.Provider>
  );
}

export function useCourse() {
  return useContext(CourseContext);
}
