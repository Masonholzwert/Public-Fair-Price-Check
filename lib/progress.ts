import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "basic-lingo-progress-v1";

export type Progress = {
  // Finished lessons, quests and challenges, by id (e.g. "u1-l1", "u1-quest", "p-gauss")
  done: Record<string, { xp: number; correct?: number; total?: number; date: string }>;
  // XP from Quick Practice rounds, which can be played again and again
  bonusXp?: number;
  practiceRounds?: number;
  // Exercises answered wrong, by exercise id (e.g. "u3-l2-e4"): the time it went wrong (a positive number),
  // or minus the time it was fixed. The fixed ones are kept for a while, so another device that still
  // has the old mistake learns that it was fixed when the progress is synced. (Old saves use true.)
  mistakes?: Record<string, true | number>;
  // Days with at least one finished lesson, quest or practice round, like "2026-11-10" (for the streak)
  activeDays?: string[];
};

function emptyProgress(): Progress {
  return { done: {}, bonusXp: 0, practiceRounds: 0, mistakes: {} };
}

// Something else (the cloud save) can listen for changes, to send them to your other devices
const listeners = new Set<() => void>();
export function onProgressSaved(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function changed() {
  listeners.forEach((l) => l());
}

// Change the saved progress in one step (used to merge in progress from another device)
export function updateProgress(change: (current: Progress) => Progress) {
  return enqueue(async () => {
    const next = change(await loadProgress());
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  });
}

// Saves run one after another, so two quick saves can't overwrite each other
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task);
  queue = next.catch(() => {});
  return next;
}

export async function loadProgress(): Promise<Progress> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...emptyProgress(), ...JSON.parse(raw) } : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

// Mark a lesson, quest or challenge as done. If it is repeated, the best score is kept.
// Quick Practice ("mix-…") and mistake rounds ("fix-…") aren't stored one by one, they just add XP.
export function markDone(id: string, xp: number, correct?: number, total?: number) {
  return enqueue(() => saveDone(id, xp, correct, total)).finally(changed);
}

async function saveDone(id: string, xp: number, correct?: number, total?: number) {
  const progress = await loadProgress();
  addActiveDay(progress);

  if (id.startsWith("mix-") || id.startsWith("fix-")) {
    progress.bonusXp = (progress.bonusXp ?? 0) + xp;
    progress.practiceRounds = (progress.practiceRounds ?? 0) + 1;
    await AsyncStorage.setItem(KEY, JSON.stringify(progress));
    return;
  }

  const previous = progress.done[id];
  const keepOld =
    (previous && previous.correct !== undefined && correct !== undefined && previous.correct >= correct) ||
    (previous && correct === undefined); // quests and challenges only count once
  if (keepOld) {
    await AsyncStorage.setItem(KEY, JSON.stringify(progress)); // still save the streak day
    return;
  }
  progress.done[id] = { xp, correct, total, date: new Date().toISOString() };
  await AsyncStorage.setItem(KEY, JSON.stringify(progress));
}

// Remember a wrong answer, or forget it once it's answered correctly
export function recordAnswer(exerciseId: string, correct: boolean) {
  return enqueue(async () => {
    const progress = await loadProgress();
    const mistakes = { ...(progress.mistakes ?? {}) };
    if (correct) {
      if (isOpenMistake(mistakes[exerciseId])) mistakes[exerciseId] = -Date.now();
    } else mistakes[exerciseId] = Date.now();
    progress.mistakes = mistakes;
    await AsyncStorage.setItem(KEY, JSON.stringify(progress));
  }).finally(changed);
}

// A mistake that is still waiting to be fixed
export function isOpenMistake(entry: true | number | undefined): boolean {
  return entry === true || (typeof entry === "number" && entry > 0);
}

// ---------- Daily streak ----------

// The date on the phone, as "2026-11-10" (local time, so the day changes at midnight where you are)
export function dayKey(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday, so summer/winter time changes can't skip a day
  d.setDate(d.getDate() - n);
  return d;
}

function addActiveDay(progress: Progress) {
  const today = dayKey();
  const days = progress.activeDays ?? [];
  if (!days.includes(today)) progress.activeDays = [...days, today].slice(-400);
}

// How many days in a row you've learned something. Today still counts as "not missed" until midnight,
// so a streak from yesterday stays alive until the day is over.
export function currentStreak(progress: Progress) {
  const days = new Set(progress.activeDays ?? []);
  const start = days.has(dayKey()) ? 0 : 1;
  let streak = 0;
  while (days.has(dayKey(daysAgo(start + streak)))) streak++;
  return streak;
}

export function learnedToday(progress: Progress) {
  return (progress.activeDays ?? []).includes(dayKey());
}

// The last 7 days, oldest first, for the little week strip on the home screen
export function lastWeek(progress: Progress) {
  const days = new Set(progress.activeDays ?? []);
  return Array.from({ length: 7 }, (_, i) => {
    const date = daysAgo(6 - i);
    return {
      letter: "SMTWTFS"[date.getDay()],
      active: days.has(dayKey(date)),
      today: i === 6,
    };
  });
}

export function earnedXp(progress: Progress, ids: string[]) {
  return ids.reduce((sum, id) => sum + (progress.done[id]?.xp ?? 0), 0);
}

export async function resetProgress() {
  await AsyncStorage.removeItem(KEY);
  await AsyncStorage.removeItem("basic-lingo-streak-celebrated"); // so the streak animation can be seen again
}

// ---------- Admin mode (development only) ----------

const ADMIN_KEY = "basic-lingo-admin";

export async function loadAdminMode(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ADMIN_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setAdminMode(on: boolean) {
  if (on) await AsyncStorage.setItem(ADMIN_KEY, "1");
  else await AsyncStorage.removeItem(ADMIN_KEY);
}
