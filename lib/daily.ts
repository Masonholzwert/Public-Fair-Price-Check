import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Course } from "./course";
import { courses } from "./courses";
import { Challenge, challengesFor, translationsFor } from "./practice";
import { Progress, updateProgress } from "./progress";
import { supabase } from "./supabase";

// ---------- Which challenge is today's ----------

// The daily challenge is the same for everyone in the world, so it changes at midnight UTC
// (1:00 in winter and 2:00 in summer in Germany), not at local midnight.
export function dailyDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function dayNumber(day: string) {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
}

// A small, fixed hash: the same text always gives the same number, on every phone
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The courses take turns, one per day. From that course, one challenge or translation of
// difficulty 1 or 2 is picked: the hard ones would be unfair for someone who hasn't done that course yet.
export function dailyChallenge(day = dailyDay()): { challenge: Challenge; course: Course } | null {
  const list = courses.filter((c) => c.available && c.hasPractice);
  if (list.length === 0) return null;
  const n = dayNumber(day);
  const course = list[((n % list.length) + list.length) % list.length];
  const pool = [...challengesFor(course), ...translationsFor(course)]
    .filter((c) => c.difficulty <= 2)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length === 0) return null;
  return { challenge: pool[hash(`${day}-${course.id}`) % pool.length], course };
}

// Time left until the next daily challenge, like "5h 12m"
export function timeUntilNext(now = new Date()) {
  const next = Date.parse(`${dailyDay(now)}T00:00:00Z`) + 86400000;
  const minutes = Math.max(0, Math.ceil((next - now.getTime()) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// ---------- Daily streak and bonus ----------

export const dailyKey = (day: string) => `daily-${day}`;

export function solvedDaily(progress: Progress, day = dailyDay()) {
  return !!progress.done[dailyKey(day)];
}

// Daily challenges solved in a row. Today still counts as "not missed" until the day is over.
export function dailyStreak(progress: Progress, today = dailyDay()) {
  const n = dayNumber(today);
  const dayOf = (k: number) => new Date(k * 86400000).toISOString().slice(0, 10);
  let start = solvedDaily(progress, today) ? 0 : 1;
  let streak = 0;
  while (solvedDaily(progress, dayOf(n - start - streak))) streak++;
  return streak;
}

// 25 XP, plus 5 for every day of your daily streak (up to +25)
export const DAILY_BASE_XP = 25;
export function dailyBonus(streakBefore: number) {
  return DAILY_BASE_XP + 5 * Math.min(streakBefore, 5);
}

// XP from all daily bonuses (the challenge's own XP is counted with its course)
export function dailyXp(progress: Progress) {
  return Object.entries(progress.done)
    .filter(([id]) => id.startsWith("daily-"))
    .reduce((sum, [, entry]) => sum + entry.xp, 0);
}

// ---------- The clock ----------
// It starts the first time you open today's challenge, and keeps running if you leave and come back.

const startKey = (day: string) => `basic-lingo-daily-start-${day}`;

export async function startDailyClock(day: string): Promise<number> {
  try {
    const saved = await AsyncStorage.getItem(startKey(day));
    if (saved) return Number(saved);
    const now = Date.now();
    await AsyncStorage.setItem(startKey(day), String(now));
    return now;
  } catch {
    return Date.now();
  }
}

export function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Admin: play today's challenge again from the start
export async function resetDaily(day = dailyDay()) {
  await AsyncStorage.removeItem(startKey(day)).catch(() => {});
  await updateProgress((p) => {
    const done = { ...p.done };
    delete done[dailyKey(day)];
    return { ...p, done };
  });
}

// ---------- Today's leaderboard ----------

export type DailyResult = { user_id: string; nickname: string; seconds: number; runs: number; hints: number; course_id: string };

export async function submitDaily(day: string, challengeId: string, courseId: string, seconds: number, runs: number, hints: number) {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) return;
  // Only the first result of the day counts: the server refuses a second one
  await supabase.from("daily_results").insert({
    day,
    user_id: id,
    challenge_id: challengeId,
    course_id: courseId,
    seconds: Math.max(0, Math.round(seconds)),
    runs: Math.max(1, runs),
    hints: Math.max(0, hints),
  });
}

export async function fetchDailyBoard(day: string): Promise<{ rows: DailyResult[]; me: string | null; error: string | null }> {
  if (!supabase) return { rows: [], me: null, error: "Online features aren't set up yet." };
  const { data: session } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from("daily_board")
    .select("*")
    .eq("day", day)
    .order("seconds", { ascending: true })
    .order("runs", { ascending: true })
    .limit(50);
  return {
    rows: (data as DailyResult[]) ?? [],
    me: session.session?.user.id ?? null,
    error: error ? "Couldn't load today's results. Check your internet connection." : null,
  };
}
