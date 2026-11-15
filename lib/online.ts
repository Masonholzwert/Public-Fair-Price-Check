import AsyncStorage from "@react-native-async-storage/async-storage";
import { unitStepIds } from "./course";
import { courses } from "./courses";
import { Progress, currentStreak } from "./progress";
import { loadPrograms } from "./sandbox";
import { longestStreak, totalXp } from "./stats";
import { clearLocalData } from "./cloud";
import { supabase } from "./supabase";

// ---------- Your stats on the server ----------

async function userId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// Units where every lesson, the review and the quest are done, across all languages
export function unitsDone(progress: Progress) {
  return courses.reduce(
    (sum, c) =>
      sum +
      c.chapters.flatMap((ch) => ch.units).filter((u) => !u.comingSoon && unitStepIds(u).every((id) => progress.done[id])).length,
    0
  );
}

// The nickname shown on leaderboards (the name from the profile). Returns an error message, or null.
export async function saveNickname(nickname: string): Promise<string | null> {
  const id = await userId();
  if (!id || !supabase) return null;
  const clean = nickname.trim().slice(0, 16);
  if (clean.length < 2) return "Pick a nickname with at least 2 characters.";
  const { error } = await supabase.from("profiles").upsert({ id, nickname: clean });
  if (!error) return null;
  return /duplicate|unique|23505/i.test(error.message + (error.code ?? ""))
    ? `"${clean}" is already taken. Try another nickname.`
    : "Couldn't save the nickname. Check your internet connection.";
}

// Send the current numbers. Called when the profile or a leaderboard opens.
export async function syncStats(progress: Progress, nickname: string) {
  const id = await userId();
  if (!id || !supabase) return;
  let programs = 0;
  let lines = 0;
  for (const c of courses) {
    for (const p of await loadPrograms(c.id)) {
      programs++;
      lines += p.code.split("\n").filter((l) => l.trim() !== "").length;
    }
  }
  if (nickname.trim().length >= 2) await saveNickname(nickname);
  await supabase.from("stats").upsert({
    user_id: id,
    current_streak: currentStreak(progress),
    best_streak: Math.max(longestStreak(progress), currentStreak(progress)),
    units_done: unitsDone(progress),
    programs,
    program_lines: lines,
    xp: totalXp(progress),
    updated_at: new Date().toISOString(),
  });
}

// ---------- Leaderboards ----------

export type Board = "current_streak" | "units_done" | "programs" | "likes";
export type BoardRow = {
  user_id: string;
  nickname: string;
  current_streak: number;
  best_streak: number;
  units_done: number;
  programs: number;
  program_lines: number;
  likes: number;
};

export async function fetchBoard(board: Board): Promise<{ rows: BoardRow[]; error: string | null }> {
  if (!supabase) return { rows: [], error: "Online features aren't set up yet." };
  const { data, error } = await supabase.from("leaderboard").select("*").order(board, { ascending: false }).limit(50);
  return { rows: (data as BoardRow[]) ?? [], error: error ? "Couldn't load the leaderboard. Check your internet connection." : null };
}

// ---------- Shared programs ----------

export type SharedProgram = {
  id: string;
  user_id: string;
  course_id: string;
  name: string;
  code: string;
  likes: number;
  created_at: string;
  nickname: string;
};

export async function shareProgram(courseId: string, name: string, code: string): Promise<string | null> {
  const id = await userId();
  if (!id || !supabase) return "Sign in first.";
  const { error } = await supabase.from("programs").insert({ user_id: id, course_id: courseId, name: name.slice(0, 24) || "PROGRAM", code });
  return error ? "Sharing didn't work. Check your internet connection." : null;
}

export async function fetchShared(courseId: string, sort: "top" | "new"): Promise<{ rows: SharedProgram[]; error: string | null }> {
  if (!supabase) return { rows: [], error: "Online features aren't set up yet." };
  let query = supabase.from("shared_programs").select("*").eq("course_id", courseId);
  query = sort === "top" ? query.order("likes", { ascending: false }).order("created_at", { ascending: false }) : query.order("created_at", { ascending: false });
  const { data, error } = await query.limit(50);
  const blocked = await loadBlocked();
  return {
    rows: ((data as SharedProgram[]) ?? []).filter((p) => !blocked.includes(p.user_id)),
    error: error ? "Couldn't load the programs. Check your internet connection." : null,
  };
}

export async function myLikes(): Promise<Set<string>> {
  if (!supabase || !(await userId())) return new Set();
  const { data } = await supabase.from("likes").select("program_id");
  return new Set(((data as { program_id: string }[]) ?? []).map((r) => r.program_id));
}

export async function setLike(programId: string, liked: boolean) {
  const id = await userId();
  if (!id || !supabase) return;
  if (liked) await supabase.from("likes").insert({ program_id: programId, user_id: id });
  else await supabase.from("likes").delete().eq("program_id", programId).eq("user_id", id);
}

export async function reportProgram(programId: string, reason: string) {
  const id = await userId();
  if (!id || !supabase) return;
  await supabase.from("reports").insert({ program_id: programId, user_id: id, reason: reason.slice(0, 200) });
}

export async function deleteShared(programId: string) {
  await supabase?.from("programs").delete().eq("id", programId);
}

export async function deleteAccount(): Promise<string | null> {
  if (!supabase) return null;
  const { error } = await supabase.rpc("delete_own_account");
  if (error) return "Deleting the account didn't work. Try again later.";
  await clearLocalData();
  await supabase.auth.signOut();
  return null;
}

// ---------- Blocking (stored on this phone) ----------

const BLOCK_KEY = "basic-lingo-blocked";

export async function loadBlocked(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(BLOCK_KEY)) ?? "[]");
  } catch {
    return [];
  }
}

export async function blockUser(userIdToBlock: string) {
  const list = await loadBlocked();
  if (!list.includes(userIdToBlock)) await AsyncStorage.setItem(BLOCK_KEY, JSON.stringify([...list, userIdToBlock]));
}
