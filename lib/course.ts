import type { Theme } from "../theme";
import type { MachineExpect, MachineState, QuestCase } from "./asm6502";

// ---------- Types ----------

export type Exercise = {
  id: string;
  type: string;
  prompt: string;
  code?: string[];
  options?: string[];
  lines?: string[];
  answer: number | string | string[];
  explanation: string;
  showNumbers?: boolean; // order_lines: keep line numbers visible (when the numbers are the point)
  value?: string; // picture (COBOL): the number that goes into the field
  target?: string; // picture: the exact text the field must show
  keys?: string[]; // picture: the symbol keys offered
};

export type LessonData = {
  id: string;
  title: string;
  xp: number;
  intro: string[];
  example?: { code: string[]; output: string[]; inputs?: (number | string)[] };
  exercises: Exercise[];
};

// A quest, chapter project or practice challenge: write a program that produces the expected output
export type QuestData = {
  title: string;
  xp: number;
  story?: string;
  task: string;
  starter: string;
  expectedOutput: string;
  maxLines?: number;
  inputs?: (number | string)[]; // fixed answers for INPUT, so the program can be checked
  exact?: boolean; // compare spaces at the start of lines too (for drawings)
  requirements: { pattern: string; message: string }[];
  hints: string[];
  expect?: MachineExpect; // 6502: registers and memory the program must end with
  cases?: QuestCase[]; // 6502: run the program several times with different values in memory
};

// machine: the CPU after the program stopped (only for assembly courses)
export type RunOptions = { powerOn?: number; memory?: Record<string, number>; keys?: string };

export type RunResult = { output: string; error: string | null; machine?: MachineState | null };

export type UnitInfo = {
  id: string;
  title: string;
  learn: string[];
  goal: string;
  lessons: LessonData[];
  quest: QuestData | null;
  comingSoon: boolean; // planned, but no lessons yet
};

export type ProjectInfo = { id: string; title: string; xp: number; available: boolean };

export type Chapter = {
  id: string;
  title: string;
  subtitle: string;
  units: UnitInfo[];
  project: ProjectInfo | null;
};

export type ChapterJson = {
  id: string;
  title: string;
  subtitle: string;
  units: { id: string; title: string; learn: string[]; goal: string }[];
  project?: { id: string; title: string; xp: number };
};

// Everything a course needs: its look, its content and how to run its programs
export type CourseDef = {
  id: string;
  title: string; // e.g. "BASIC"
  year: number;
  machine: string; // the computer it's styled after
  tagline: string;
  theme: Theme;
  chapters: ChapterJson[];
  lessonsByUnit: Record<string, LessonData[]>;
  quests: Record<string, QuestData>;
  // options: only used by assembly courses (see runAsm)
  run: (code: string, inputs: (number | string)[], options?: RunOptions) => RunResult;
  hasPractice?: boolean;
  editorHint?: string; // placeholder in the empty code editor
  canStep?: boolean; // quests offer step mode (one instruction at a time)
  closingLine?: string; // the last line of the chapter map (C: "}", Pascal: "end.")
  lineStyle?: "basic" | "address" | "card" | "editor" | "octal" | "cobol"; // chapter map: BASIC line numbers (10, 20 …), memory addresses ($0200 …), card sequence numbers (00010 …) or editor lines (1, 2, 3 …)
};

export type Course = Omit<CourseDef, "chapters"> & {
  chapters: Chapter[];
  available: boolean; // false while the course has no lessons yet
  unitNumber: (unitId: string) => number;
  isChapterUnlocked: (index: number, done: Done, admin: boolean) => boolean;
  findLesson: (id: string) => { unit: UnitInfo; lesson: LessonData } | null;
  allStepIds: () => string[];
};

type Done = Record<string, unknown>;

export const REVIEW_XP = 20;
export const QUICK_PRACTICE_XP = 10;
export const FIX_XP = 5;

// ---------- Steps and XP (the same for every course) ----------

export const reviewId = (unitId: string) => `${unitId}-review`;
export const questId = (unitId: string) => `${unitId}-quest`;

// Every step of a unit in order: lessons, review, quest
export function unitStepIds(unit: UnitInfo): string[] {
  if (unit.comingSoon) return [];
  return [...unit.lessons.map((l) => l.id), reviewId(unit.id), ...(unit.quest ? [questId(unit.id)] : [])];
}

export function unitTotalXp(unit: UnitInfo): number {
  if (unit.comingSoon) return 0;
  return unit.lessons.reduce((sum, l) => sum + l.xp, 0) + REVIEW_XP + (unit.quest?.xp ?? 0);
}

export function chapterStepIds(chapter: Chapter): string[] {
  return [...chapter.units.flatMap(unitStepIds), ...(chapter.project?.available ? [chapter.project.id] : [])];
}

export function chapterTotalXp(chapter: Chapter): number {
  return (
    chapter.units.reduce((sum, u) => sum + unitTotalXp(u), 0) +
    (chapter.project?.available ? chapter.project.xp : 0)
  );
}

export function chapterHasContent(chapter: Chapter) {
  return chapter.units.some((u) => !u.comingSoon);
}

// A unit opens when the unit before it (in the same chapter) is completely finished
export function isUnitUnlocked(
  chapter: Chapter,
  unitIndex: number,
  chapterUnlocked: boolean,
  done: Done,
  admin: boolean
): boolean {
  if (admin) return true;
  if (!chapterUnlocked) return false;
  if (unitIndex === 0) return true;
  const previous = chapter.units[unitIndex - 1];
  return !previous.comingSoon && unitStepIds(previous).every((id) => done[id]);
}

// Quick Practice ids look like "mix-<time>.u1-l1.u1-l2", so every round gets a fresh mix
export function quickPracticeId(lessonIds: string[]) {
  return ["mix-" + Date.now(), ...lessonIds].join(".");
}

// Mistake rounds look like "fix-<time>.u3-l1-e2.u3-l2-e5" (the exercise ids to retake)
export function fixMistakesId(exerciseIds: string[]) {
  return ["fix-" + Date.now(), ...exerciseIds].join(".");
}

// The exercises of a unit that are still in the mistakes list
export function unitMistakeIds(unit: UnitInfo, mistakes: Record<string, unknown> | undefined): string[] {
  if (!mistakes) return [];
  const ids = unit.lessons.flatMap((l) => l.exercises.map((e) => e.id));
  // a positive time (or true in old saves) means it's still open; a negative one means it was fixed
  return [...new Set(ids)].filter((id) => {
    const entry = mistakes[id];
    return entry === true || (typeof entry === "number" && entry > 0);
  });
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Building a course ----------

export function buildCourse(def: CourseDef): Course {
  const chapters: Chapter[] = def.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    units: c.units.map((u) => {
      const lessons = def.lessonsByUnit[u.id] ?? [];
      return { ...u, lessons, quest: def.quests[u.id] ?? null, comingSoon: lessons.length === 0 };
    }),
    // A chapter project becomes available once its quest exists
    project: c.project ? { ...c.project, available: !!def.quests[c.project.id] } : null,
  }));

  const allUnits = chapters.flatMap((c) => c.units);
  const cache = new Map<string, LessonData>(); // reviews and practice rounds, so they don't reshuffle

  // The review lesson: 2 random exercises from every lesson of the unit
  function buildReview(unit: UnitInfo): LessonData {
    const picks = unit.lessons.flatMap((l) => shuffle(l.exercises).slice(0, 2));
    return {
      id: reviewId(unit.id),
      title: `Review: ${unit.title}`,
      xp: REVIEW_XP,
      intro: [
        "Time to practice! This round mixes exercises from every lesson in this unit.",
        "Nothing new here, just everything you've learned so far. Aim for a perfect score before you take on the quest.",
      ],
      exercises: shuffle(picks),
    };
  }

  // Quick Practice: 10 random exercises from the lessons in the id
  function buildQuickPractice(id: string): LessonData | null {
    const lessonIds = id.split(".").slice(1);
    const pool = allUnits.flatMap((u) => u.lessons.filter((l) => lessonIds.includes(l.id))).flatMap((l) => l.exercises);
    if (pool.length === 0) return null;
    return {
      id,
      title: "Quick Practice",
      xp: QUICK_PRACTICE_XP,
      intro: [
        `10 random exercises from the ${lessonIds.length} lesson${lessonIds.length === 1 ? "" : "s"} you've finished.`,
        "Every round is a new mix, so come back as often as you like.",
      ],
      exercises: shuffle(pool).slice(0, 10),
    };
  }

  // Mistake round: the exercises in the id, in a fresh order
  function buildFix(id: string): LessonData | null {
    const wanted = new Set(id.split(".").slice(1));
    const seen = new Set<string>();
    const pool = allUnits
      .flatMap((u) => u.lessons.flatMap((l) => l.exercises))
      .filter((e) => wanted.has(e.id) && !seen.has(e.id) && seen.add(e.id));
    if (pool.length === 0) return null;
    return {
      id,
      title: "Fix your mistakes",
      xp: FIX_XP,
      intro: [
        `${pool.length} question${pool.length === 1 ? "" : "s"} you got wrong before. Take your time and read each explanation.`,
        "Every question you answer correctly now is cleared from your mistakes.",
      ],
      exercises: shuffle(pool),
    };
  }

  function findLesson(id: string) {
    if (id.startsWith("fix-")) {
      if (!cache.has(id)) {
        const fix = buildFix(id);
        if (!fix) return null;
        cache.set(id, fix);
      }
      return { unit: allUnits[0], lesson: cache.get(id)! };
    }
    if (id.startsWith("mix-")) {
      if (!cache.has(id)) {
        const mix = buildQuickPractice(id);
        if (!mix) return null;
        cache.set(id, mix);
      }
      return { unit: allUnits[0], lesson: cache.get(id)! };
    }
    for (const unit of allUnits) {
      if (id === reviewId(unit.id) && !unit.comingSoon) {
        if (!cache.has(id)) cache.set(id, buildReview(unit));
        return { unit, lesson: cache.get(id)! };
      }
      const lesson = unit.lessons.find((l) => l.id === id);
      if (lesson) return { unit, lesson };
    }
    return null;
  }

  return {
    ...def,
    chapters,
    available: allUnits.some((u) => !u.comingSoon),
    // Units are numbered across the whole course (Unit 1, 2, 3, ...)
    unitNumber: (unitId) => allUnits.findIndex((u) => u.id === unitId) + 1,
    // A chapter opens when the previous chapter is completely finished
    isChapterUnlocked: (index, done, admin) => {
      if (admin || index === 0) return true;
      const previous = chapters[index - 1];
      if (previous.units.some((u) => u.comingSoon)) return false;
      return chapterStepIds(previous).every((id) => done[id]);
    },
    findLesson,
    allStepIds: () => chapters.flatMap(chapterStepIds),
  };
}
