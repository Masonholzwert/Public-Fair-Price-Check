import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Course } from "./course";
import { courses } from "./courses";
import { challengeIdsFor, practiceIdsFor } from "./practice";
import { dailyXp } from "./daily";
import { Progress, currentStreak, dayKey, earnedXp } from "./progress";

// Everything the profile screen shows, worked out from the saved progress

export type CourseStats = {
  course: Course;
  xp: number;
  stepsDone: number;
  stepsTotal: number; // lessons, reviews, quests and projects that exist so far
  lessonsDone: number;
  started: boolean;
};

export function courseStats(course: Course, progress: Progress): CourseStats {
  const ids = course.allStepIds();
  const done = ids.filter((id) => progress.done[id]);
  const lessonIds = new Set(course.chapters.flatMap((c) => c.units.flatMap((u) => u.lessons.map((l) => l.id))));
  const challengeIds = challengeIdsFor(course);
  return {
    course,
    xp: earnedXp(progress, ids) + earnedXp(progress, practiceIdsFor(course)),
    stepsDone: done.length,
    stepsTotal: ids.length,
    lessonsDone: done.filter((id) => lessonIds.has(id)).length,
    started: done.length > 0 || challengeIds.some((id) => progress.done[id]),
  };
}

export function totalXp(progress: Progress) {
  return courses.reduce((sum, c) => sum + courseStats(c, progress).xp, 0) + (progress.bonusXp ?? 0) + dailyXp(progress);
}

// Share of right answers in all finished lessons and reviews
export function accuracy(progress: Progress): number | null {
  let right = 0;
  let all = 0;
  for (const entry of Object.values(progress.done)) {
    if (entry.correct !== undefined && entry.total) {
      right += entry.correct;
      all += entry.total;
    }
  }
  return all > 0 ? Math.round((right / all) * 100) : null;
}

// The longest run of days in a row, ever
export function longestStreak(progress: Progress) {
  const days = [...new Set(progress.activeDays ?? [])].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of days) {
    const time = new Date(`${day}T12:00:00`).getTime();
    run = previous !== null && Math.round((time - previous) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return best;
}

// The last 5 weeks for the activity grid, oldest first, ending today
export function lastDays(progress: Progress, count = 35) {
  const days = new Set(progress.activeDays ?? []);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (count - 1 - i));
    return { key: dayKey(d), active: days.has(dayKey(d)), today: i === count - 1 };
  });
}

// ---------- Numbers for the stats list ----------

export type StatLine = { label: string; value: string };

export function generalStats(progress: Progress, programs: number): StatLine[] {
  const entries = Object.entries(progress.done);
  const lessonIds = new Set(courses.flatMap((c) => c.chapters.flatMap((ch) => ch.units.flatMap((u) => u.lessons.map((l) => l.id)))));
  const challengeSet = new Set(courses.flatMap((c) => challengeIdsFor(c)));
  const n = (test: (id: string) => boolean) => entries.filter(([id]) => test(id)).length;
  let answered = 0;
  let right = 0;
  let perfect = 0;
  for (const [, e] of entries) {
    if (e.total) {
      answered += e.total;
      right += e.correct ?? 0;
      if (e.correct === e.total) perfect++;
    }
  }
  const fixed = Object.values(progress.mistakes ?? {}).filter((v) => typeof v === "number" && v < 0).length;
  const open = Object.values(progress.mistakes ?? {}).filter((v) => v === true || (typeof v === "number" && v > 0)).length;

  // When you learn: the part of the day and the weekday with the most finished steps
  const parts = [
    { name: "Night", from: 0, to: 5 },
    { name: "Morning", from: 5, to: 12 },
    { name: "Afternoon", from: 12, to: 17 },
    { name: "Evening", from: 17, to: 22 },
    { name: "Night", from: 22, to: 24 },
  ];
  const partCount: Record<string, number> = {};
  const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
  for (const [, e] of entries) {
    const d = new Date(e.date);
    const part = parts.find((p) => d.getHours() >= p.from && d.getHours() < p.to)!.name;
    partCount[part] = (partCount[part] ?? 0) + 1;
    weekdayCount[d.getDay()]++;
  }
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const topPart = Object.entries(partCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topDay = entries.length ? weekdays[weekdayCount.indexOf(Math.max(...weekdayCount))] : undefined;
  const first = [...(progress.activeDays ?? [])].sort()[0];
  const since = first ? new Date(`${first}T12:00:00`) : null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (x: number) => x.toLocaleString("en-US");

  return [
    { label: "Learning since", value: since ? `${since.getDate()} ${months[since.getMonth()]} ${since.getFullYear()}` : "–" },
    { label: "Lessons finished", value: fmt(n((id) => lessonIds.has(id))) },
    { label: "Unit reviews", value: fmt(n((id) => id.endsWith("-review"))) },
    { label: "Quests solved", value: fmt(n((id) => id.endsWith("-quest"))) },
    { label: "Chapter projects", value: fmt(n((id) => id.endsWith("-project"))) },
    { label: "Code challenges", value: fmt(n((id) => challengeSet.has(id))) },
    { label: "Translations", value: fmt(n((id) => id.startsWith("t-"))) },
    { label: "Daily challenges", value: fmt(n((id) => id.startsWith("daily-"))) },
    { label: "Practice rounds", value: fmt(progress.practiceRounds ?? 0) },
    { label: "Questions answered", value: fmt(answered) },
    { label: "Answered right", value: fmt(right) },
    { label: "Without a mistake", value: `${fmt(perfect)} lesson${perfect === 1 ? "" : "s"}` },
    { label: "Mistakes fixed", value: fmt(fixed) },
    { label: "Mistakes to fix", value: fmt(open) },
    { label: "Sandbox programs", value: fmt(programs) },
    { label: "Favorite time", value: topPart ?? "–" },
    { label: "Busiest weekday", value: topDay ?? "–" },
  ];
}

// ---------- Achievements ----------

export type AchievementGroup = "LEARNING" | "STREAKS" | "PRACTICE" | "LANGUAGES" | "SPECIAL";
export const ACHIEVEMENT_GROUPS: AchievementGroup[] = ["LEARNING", "STREAKS", "PRACTICE", "LANGUAGES", "SPECIAL"];

export type Achievement = {
  id: string;
  icon: string;
  title: string;
  text: string;
  group: AchievementGroup;
  earned: boolean;
  count?: string; // how far you are, like "4/10", for the ones that count something
  date?: string; // when it was earned (ISO), worked out from the progress, or the day the profile first saw it
};

// The n-th earliest date (1 = the earliest), or undefined if there aren't that many
function nth(dates: (string | undefined)[], n: number): string | undefined {
  const sorted = dates.filter((d): d is string => !!d).sort();
  return n >= 1 && sorted.length >= n ? sorted[n - 1] : undefined;
}
const latest = (dates: string[]) => (dates.length ? [...dates].sort()[dates.length - 1] : undefined);
const dayDate = (day: string) => `${day}T12:00:00`; // an active day ("2026-11-10") as a date

// The day a run of `need` days in a row was first reached
function streakDate(activeDays: string[], need: number): string | undefined {
  const days = [...new Set(activeDays)].sort();
  let run = 0;
  let previous: number | null = null;
  for (const day of days) {
    const time = new Date(dayDate(day)).getTime();
    run = previous !== null && Math.round((time - previous) / 86400000) === 1 ? run + 1 : 1;
    if (run >= need) return dayDate(day);
    previous = time;
  }
  return undefined;
}

// Finishing a whole course: one badge per language, named after its era
const COURSE_BADGES: Record<string, { icon: string; title: string }> = {
  basic: { icon: "school-outline", title: "Dartmouth Graduate" },
  "6502": { icon: "hardware-chip-outline", title: "Bare Metal" },
  fortran: { icon: "albums-outline", title: "Card Shark" },
  c: { icon: "terminal-outline", title: "Unix Wizard" },
  pascal: { icon: "git-network-outline", title: "Wirth's Student" },
  altair: { icon: "toggle-outline", title: "Front Panel Hacker" },
  cobol: { icon: "business-outline", title: "Mainframe Banker" },
};

export function achievements(progress: Progress): Achievement[] {
  const all = courses.map((c) => courseStats(c, progress));
  const entries = Object.entries(progress.done);
  const datesOf = (test: (id: string, e: Progress["done"][string]) => boolean) =>
    entries.filter(([id, e]) => test(id, e)).map(([, e]) => e.date);
  const lessonIds = new Set(courses.flatMap((c) => c.chapters.flatMap((ch) => ch.units.flatMap((u) => u.lessons.map((l) => l.id)))));
  const challengeSet = new Set(courses.flatMap((c) => challengeIdsFor(c)));
  const lessons = all.reduce((sum, s) => sum + s.lessonsDone, 0);
  const quests = entries.filter(([id]) => id.endsWith("-quest")).length;
  const projects = entries.filter(([id]) => id.endsWith("-project")).length;
  const challenges = courses.reduce((sum, c) => sum + challengeIdsFor(c).filter((id) => progress.done[id]).length, 0);
  const translationsDone = entries.filter(([id]) => id.startsWith("t-")).length;
  const dailies = entries.filter(([id]) => id.startsWith("daily-")).length;
  const isPerfect = (e: Progress["done"][string]) => e.correct !== undefined && e.total !== undefined && e.total > 0 && e.correct === e.total;
  const perfectCount = entries.filter(([, e]) => isPerfect(e)).length;
  const perfectReview = entries.some(([id, e]) => id.endsWith("-review") && isPerfect(e));
  const hourOf = (e: Progress["done"][string]) => new Date(e.date).getHours();
  const nightOwl = entries.some(([, e]) => hourOf(e) >= 23 || hourOf(e) < 4);
  const earlyBird = entries.some(([, e]) => hourOf(e) >= 4 && hourOf(e) < 7);
  // A Saturday and the Sunday right after it, both with learning
  const days = new Set(progress.activeDays ?? []);
  const weekend = [...days].some((day) => {
    const d = new Date(`${day}T12:00:00`);
    if (d.getDay() !== 6) return false;
    d.setDate(d.getDate() + 1);
    return days.has(dayKey(d));
  });
  // Exercises that went wrong and were fixed later (stored as minus the time they were fixed)
  const fixed = Object.values(progress.mistakes ?? {}).filter((v) => typeof v === "number" && v < 0).length;
  const acc = accuracy(progress);
  const started = all.filter((s) => s.started).length;
  const available = courses.filter((c) => c.available).length;
  const streak = Math.max(longestStreak(progress), currentStreak(progress));
  const xp = totalXp(progress);
  const rounds = progress.practiceRounds ?? 0;
  const chapterDone = courses.some((c) =>
    c.chapters.some((ch) => {
      const ids = ch.units.flatMap((u) => u.lessons.map((l) => l.id));
      return ids.length > 0 && ids.every((id) => progress.done[id]) && (!ch.project || !!progress.done[ch.project.id]);
    })
  );
  const finished = all.filter((s) => s.course.available && s.stepsTotal > 0 && s.stepsDone === s.stepsTotal);
  const finishDate = (c: Course) => latest(c.allStepIds().map((id) => progress.done[id]?.date).filter((d): d is string => !!d));
  const finishDates = finished.map((f) => finishDate(f.course));

  // Dates for the counting badges
  const lessonDates = datesOf((id) => lessonIds.has(id));
  const perfectDates = datesOf((_, e) => isPerfect(e));
  const questDates = datesOf((id) => id.endsWith("-quest"));
  const projectDates = datesOf((id) => id.endsWith("-project"));
  const challengeDates = datesOf((id) => challengeSet.has(id));
  const translateDates = datesOf((id) => id.startsWith("t-"));
  const dailyDates = datesOf((id) => id.startsWith("daily-"));
  const fixedDates = Object.values(progress.mistakes ?? {})
    .filter((v): v is number => typeof v === "number" && v < 0)
    .map((v) => new Date(-v).toISOString());
  const activeDates = [...days].map(dayDate);
  // XP over time: add up every finished step in the order it was done
  const xpDate = (need: number) => {
    let sum = 0;
    for (const [, e] of [...entries].sort((a, b) => a[1].date.localeCompare(b[1].date))) {
      sum += e.xp;
      if (sum >= need) return e.date;
    }
    return undefined;
  };
  // The first day each language was started
  const startDates = courses.map((c) => nth([...c.allStepIds(), ...challengeIdsFor(c)].map((id) => progress.done[id]?.date), 1));
  const chapterDates = courses.flatMap((c) =>
    c.chapters.map((ch) => {
      const ids = [...ch.units.flatMap((u) => u.lessons.map((l) => l.id)), ...(ch.project ? [ch.project.id] : [])];
      return ids.length > 0 && ids.every((id) => progress.done[id]) ? latest(ids.map((id) => progress.done[id].date)) : undefined;
    })
  );
  const weekendDate = nth(
    [...days].filter((day) => {
      const d = new Date(dayDate(day));
      if (d.getDay() !== 6) return false;
      d.setDate(d.getDate() + 1);
      return days.has(dayKey(d));
    }).map((day) => {
      const d = new Date(dayDate(day));
      d.setDate(d.getDate() + 1);
      return dayDate(dayKey(d));
    }),
    1
  );

  const list: Achievement[] = [];
  let group: AchievementGroup = "LEARNING";
  const add = (id: string, icon: string, title: string, text: string, ok: boolean, date?: string) =>
    list.push({ id, icon, title, text, group, earned: ok, date: ok ? date : undefined });
  // For the ones that count: earned at `need`, and shows "have/need" until then
  const count = (id: string, icon: string, title: string, text: string, have: number, need: number, date?: string) =>
    list.push({
      id,
      icon,
      title,
      text,
      group,
      earned: have >= need,
      count: `${Math.min(have, need).toLocaleString("en-US")}/${need.toLocaleString("en-US")}`,
      date: have >= need ? date : undefined,
    });

  group = "LEARNING";
  add("first", "footsteps-outline", "First Steps", "Finish your first lesson", lessons >= 1, nth(lessonDates, 1));
  count("lessons10", "book-outline", "Regular", "Finish 10 lessons", lessons, 10, nth(lessonDates, 10));
  count("lessons50", "library-outline", "Bookworm", "Finish 50 lessons", lessons, 50, nth(lessonDates, 50));
  count("lessons100", "glasses-outline", "Scholar", "Finish 100 lessons", lessons, 100, nth(lessonDates, 100));
  count("lessons250", "school-outline", "Professor", "Finish 250 lessons", lessons, 250, nth(lessonDates, 250));
  add("perfect", "checkmark-done-outline", "Flawless", "Finish a lesson without a mistake", perfectCount >= 1, nth(perfectDates, 1));
  count("perfect10", "shield-checkmark-outline", "Perfectionist", "10 lessons or reviews without a mistake", perfectCount, 10, nth(perfectDates, 10));
  add("review", "sparkles-outline", "Clean Sweep", "A unit review without a mistake", perfectReview, nth(datesOf((id, e) => id.endsWith("-review") && isPerfect(e)), 1));
  add("sharp", "locate-outline", "Sharpshooter", "90 % right answers after 20 lessons", lessons >= 20 && (acc ?? 0) >= 90);
  count("fixed10", "bug-outline", "Debugger", "Fix 10 of your mistakes", fixed, 10, nth(fixedDates, 10));
  add("quest", "star-outline", "Quest Hero", "Solve your first quest", quests >= 1, nth(questDates, 1));
  count("quest10", "star-half-outline", "Questmaster", "Solve 10 quests", quests, 10, nth(questDates, 10));
  add("chapter", "trophy-outline", "Chapter Champion", "Finish a whole chapter, project included", chapterDone, nth(chapterDates, 1));
  count("project3", "ribbon-outline", "Master Builder", "Finish 3 chapter projects", projects, 3, nth(projectDates, 3));
  count("project10", "construct-outline", "Architect", "Finish 10 chapter projects", projects, 10, nth(projectDates, 10));
  count("xp500", "speedometer-outline", "Warming Up", "Earn 500 XP", xp, 500, xpDate(500));
  count("xp2000", "rocket-outline", "Mainframe", "Earn 2,000 XP", xp, 2000, xpDate(2000));
  count("xp5000", "planet-outline", "Supercomputer", "Earn 5,000 XP", xp, 5000, xpDate(5000));
  count("xp10000", "infinite-outline", "Turing Complete", "Earn 10,000 XP", xp, 10000, xpDate(10000));

  group = "STREAKS";
  count("streak3", "flame-outline", "On Fire", "Learn 3 days in a row", streak, 3, streakDate(progress.activeDays ?? [], 3));
  count("streak7", "bonfire-outline", "Week Warrior", "Learn 7 days in a row", streak, 7, streakDate(progress.activeDays ?? [], 7));
  count("streak14", "flash-outline", "Fortnight", "Learn 14 days in a row", streak, 14, streakDate(progress.activeDays ?? [], 14));
  count("streak30", "calendar-outline", "Unstoppable", "Learn 30 days in a row", streak, 30, streakDate(progress.activeDays ?? [], 30));
  count("streak100", "diamond-outline", "Legend", "Learn 100 days in a row", streak, 100, streakDate(progress.activeDays ?? [], 100));
  count("days50", "calendar-number-outline", "Old Hand", "Learn on 50 different days", days.size, 50, nth(activeDates, 50));
  add("weekend", "cafe-outline", "Weekend Coder", "Learn on a Saturday and the Sunday after", weekend, weekendDate);

  group = "PRACTICE";
  count("practice", "terminal-outline", "Practice Makes Perfect", "Play 10 practice rounds", rounds, 10);
  count("practice50", "barbell-outline", "Drill Sergeant", "Play 50 practice rounds", rounds, 50);
  count("challenges", "code-slash-outline", "Challenger", "Solve 10 code challenges", challenges, 10, nth(challengeDates, 10));
  count("challenges50", "code-working-outline", "Hacker", "Solve 50 code challenges", challenges, 50, nth(challengeDates, 50));
  count("challenges150", "medal-outline", "Grandmaster", "Solve 150 code challenges", challenges, 150, nth(challengeDates, 150));
  add("translate", "swap-horizontal-outline", "Translator", "Rewrite a program in another language", translationsDone >= 1, nth(translateDates, 1));
  count("translate10", "language-outline", "Rosetta Stone", "Finish 10 translations", translationsDone, 10, nth(translateDates, 10));
  add("daily", "sunny-outline", "Daily Driver", "Solve a daily challenge", dailies >= 1, nth(dailyDates, 1));
  count("daily7", "partly-sunny-outline", "Seven Suns", "Solve 7 daily challenges", dailies, 7, nth(dailyDates, 7));
  count("daily30", "earth-outline", "Every Day Counts", "Solve 30 daily challenges", dailies, 30, nth(dailyDates, 30));

  group = "LANGUAGES";
  add("two", "git-compare-outline", "Polyglot", "Start a second language", started >= 2, nth(startDates, 2));
  count("three", "git-branch-outline", "Trilingual", "Start three languages", started, 3, nth(startDates, 3));
  count("all", "time-outline", "Time Traveller", "Try every language in the app", started, available, nth(startDates, available));
  for (const c of courses.filter((c) => c.available)) {
    const badge = COURSE_BADGES[c.id] ?? { icon: "checkmark-circle-outline", title: `${c.title} Master` };
    add(`course-${c.id}`, badge.icon, badge.title, `Finish the whole ${c.title} course`, finished.some((f) => f.course.id === c.id), finishDate(c));
  }
  count("courses3", "podium-outline", "Historian", "Finish three whole courses", finished.length, 3, nth(finishDates, 3));

  group = "SPECIAL";
  add("night", "moon-outline", "Night Owl", "Finish a lesson after 11 pm", nightOwl, nth(datesOf((_, e) => hourOf(e) >= 23 || hourOf(e) < 4), 1));
  add("early", "sunny", "Early Bird", "Finish a lesson before 7 am", earlyBird, nth(datesOf((_, e) => hourOf(e) >= 4 && hourOf(e) < 7), 1));
  return list;
}

// ---------- Dates for the badges the progress can't date ----------
// (Sharpshooter, Drill Sergeant, Practice Makes Perfect: practice rounds and accuracy have no dates.)
// The first time the profile sees one of them earned, that day is saved and shown from then on.

const BADGE_DATES_KEY = "basic-lingo-achievement-dates";

export async function withSeenDates(list: Achievement[]): Promise<Achievement[]> {
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse((await AsyncStorage.getItem(BADGE_DATES_KEY)) ?? "{}");
  } catch {}
  let changed = false;
  const now = new Date().toISOString();
  const result = list.map((a) => {
    if (!a.earned || a.date) return a;
    if (!seen[a.id]) {
      seen[a.id] = now;
      changed = true;
    }
    return { ...a, date: seen[a.id] };
  });
  if (changed) AsyncStorage.setItem(BADGE_DATES_KEY, JSON.stringify(seen)).catch(() => {});
  return result;
}

// "15 Nov 2026"
export function badgeDate(iso: string) {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ---------- Name ----------

const NAME_KEY = "basic-lingo-name";

export async function loadName(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(NAME_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function saveName(name: string) {
  try {
    await AsyncStorage.setItem(NAME_KEY, name);
  } catch {
    // best effort
  }
}
