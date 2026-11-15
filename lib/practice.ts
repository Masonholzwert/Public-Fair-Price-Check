import asmPracticeFile from "../src/app/data/6502/practice.json";
import altairPracticeFile from "../src/app/data/altair/practice.json";
import cPracticeFile from "../src/app/data/c/practice.json";
import cobolPracticeFile from "../src/app/data/cobol/practice.json";
import fortranPracticeFile from "../src/app/data/fortran/practice.json";
import pascalPracticeFile from "../src/app/data/pascal/practice.json";
import practiceFile from "../src/app/data/practice.json";
import translationsFile from "../src/app/data/translations.json";
import type { Chapter, Course, QuestData } from "./course";
import { courseById } from "./courses";

// Practice challenges: small programs to write, per course
export type Challenge = QuestData & {
  id: string;
  unit: string; // unlocks when all lessons of this unit are done
  difficulty: 1 | 2 | 3;
  // Translations: a working program in another course's language, to rewrite in this one
  from?: string; // course id of the original
  source?: string;
  sourceOutput?: string; // what the original prints
  sourceNote?: string; // what the original leaves behind, when it prints nothing (6502)
};

// Translations belong to the course they're written in ("to"), and unlock with one of its units
const translations = (translationsFile.translations as unknown as (Challenge & { to: string })[]);

export function translationsFor(course: Course): Challenge[] {
  return translations.filter((t) => t.to === course.id);
}

const challengesByCourse: Record<string, Challenge[]> = {
  basic: practiceFile.challenges as Challenge[],
  "6502": asmPracticeFile.challenges as unknown as Challenge[],
  fortran: fortranPracticeFile.challenges as unknown as Challenge[],
  c: cPracticeFile.challenges as unknown as Challenge[],
  pascal: pascalPracticeFile.challenges as unknown as Challenge[],
  altair: altairPracticeFile.challenges as unknown as Challenge[],
  cobol: cobolPracticeFile.challenges as unknown as Challenge[],
};

export function challengesFor(course: Course): Challenge[] {
  return challengesByCourse[course.id] ?? [];
}

export function challengeIdsFor(course: Course): string[] {
  return challengesFor(course).map((c) => c.id);
}

// Everything in Practice that earns XP once: code challenges and translations
export function practiceIdsFor(course: Course): string[] {
  return [...challengesFor(course), ...translationsFor(course)].map((c) => c.id);
}

// Challenge ids are unique across all courses, so the quest screen can find one by id alone
export function findChallenge(id: string): { challenge: Challenge; course: Course } | null {
  const tr = translations.find((t) => t.id === id);
  if (tr) {
    const course = courseById(tr.to);
    return course ? { challenge: tr, course } : null;
  }
  for (const [courseId, list] of Object.entries(challengesByCourse)) {
    const challenge = list.find((c) => c.id === id);
    const course = courseById(courseId);
    if (challenge && course) return { challenge, course };
  }
  return null;
}

type Done = Record<string, unknown>;

const unitsOf = (course: Course) => course.chapters.flatMap((c) => c.units);

// A challenge opens once every lesson of its unit is finished
export function isChallengeUnlocked(course: Course, challenge: Challenge, done: Done, admin: boolean) {
  if (admin) return true;
  const unit = unitsOf(course).find((u) => u.id === challenge.unit);
  return !!unit && unit.lessons.length > 0 && unit.lessons.every((l) => done[l.id]);
}

export function unlockHint(course: Course, challenge: Challenge) {
  return `Finish the lessons of Unit ${course.unitNumber(challenge.unit)}`;
}

// Challenges grouped by the chapter their unit belongs to
export function challengesByChapter(course: Course): { chapter: Chapter; index: number; items: Challenge[] }[] {
  const list = challengesFor(course);
  return course.chapters
    .map((chapter, index) => ({
      chapter,
      index,
      items: list.filter((c) => chapter.units.some((u) => u.id === c.unit)),
    }))
    .filter((group) => group.items.length > 0);
}

// The lessons Quick Practice may use: every finished lesson of this course (all lessons in admin mode)
export function practiceLessonIds(course: Course, done: Done, admin: boolean): string[] {
  return unitsOf(course)
    .flatMap((u) => u.lessons)
    .filter((l) => admin || done[l.id])
    .map((l) => l.id);
}

export function difficultyStars(d: number) {
  return "★".repeat(d) + "☆".repeat(3 - d);
}
