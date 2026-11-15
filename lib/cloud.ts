import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { courses } from "./courses";
import { Progress, loadProgress, onProgressSaved, updateProgress } from "./progress";
import { SandboxProgram, addDeleted, loadDeleted, loadPrograms, onProgramsSaved, savePrograms } from "./sandbox";
import { loadName, saveName } from "./stats";
import { supabase } from "./supabase";
import { AllUsage, loadAllUsage, mergeUsage, saveAllUsage } from "./usage";

// The cloud save: your progress and sandbox programs, stored with your account,
// so the phone and the computer show the same thing.
// Both sides are merged, nothing is overwritten: a lesson done on either device counts as done.

type Save = {
  progress: Progress;
  programs: Record<string, SandboxProgram[]>;
  deleted: string[];
  name: string;
  usage?: AllUsage; // time in the app, per device
};

async function localSave(): Promise<Save> {
  const programs: Record<string, SandboxProgram[]> = {};
  for (const c of courses) programs[c.id] = await loadPrograms(c.id);
  return { progress: await loadProgress(), programs, deleted: await loadDeleted(), name: await loadName(), usage: await loadAllUsage() };
}

// ---------- Merging ----------

function better(a: Progress["done"][string], b: Progress["done"][string]) {
  if ((a.correct ?? -1) !== (b.correct ?? -1)) return (a.correct ?? -1) > (b.correct ?? -1) ? a : b;
  if (a.xp !== b.xp) return a.xp > b.xp ? a : b;
  return a.date <= b.date ? a : b; // the first time it was done
}

function mergeProgress(a: Progress, b: Progress): Progress {
  const done = { ...a.done };
  for (const [id, entry] of Object.entries(b.done ?? {})) done[id] = done[id] ? better(done[id], entry) : entry;
  return {
    done,
    bonusXp: Math.max(a.bonusXp ?? 0, b.bonusXp ?? 0),
    practiceRounds: Math.max(a.practiceRounds ?? 0, b.practiceRounds ?? 0),
    mistakes: mergeMistakes(a.mistakes ?? {}, b.mistakes ?? {}),
    activeDays: [...new Set([...(a.activeDays ?? []), ...(b.activeDays ?? [])])].sort().slice(-400),
  };
}

// For every exercise, the newest news wins: "went wrong at …" or "was fixed at …"
function mergeMistakes(a: NonNullable<Progress["mistakes"]>, b: NonNullable<Progress["mistakes"]>) {
  const when = (v: true | number | undefined) => (typeof v === "number" ? Math.abs(v) : 0);
  const out: NonNullable<Progress["mistakes"]> = { ...a };
  for (const [id, v] of Object.entries(b)) if (out[id] === undefined || when(v) > when(out[id])) out[id] = v;
  return out;
}

function mergePrograms(a: SandboxProgram[], b: SandboxProgram[], deleted: Set<string>) {
  const byId = new Map<string, SandboxProgram>();
  for (const p of [...a, ...b]) {
    if (deleted.has(p.id)) continue;
    const old = byId.get(p.id);
    if (!old || p.updated > old.updated) byId.set(p.id, p); // the newest version wins
  }
  // The same program on both devices (like the starter program) only once
  const seen = new Set<string>();
  return [...byId.values()]
    .sort((x, y) => (y.updated > x.updated ? 1 : -1))
    .filter((p) => {
      const k = p.name + "\n" + p.code;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function merge(local: Save, cloud: Save): Save {
  const deleted = [...new Set([...local.deleted, ...(cloud.deleted ?? [])])].slice(-2000);
  const gone = new Set(deleted);
  const programs: Record<string, SandboxProgram[]> = {};
  for (const c of courses) programs[c.id] = mergePrograms(local.programs[c.id] ?? [], cloud.programs?.[c.id] ?? [], gone);
  return {
    progress: mergeProgress(local.progress, cloud.progress ?? { done: {} }),
    programs,
    deleted,
    name: local.name || cloud.name || "",
    usage: mergeUsage(local.usage ?? {}, cloud.usage ?? {}),
  };
}

// ---------- Syncing ----------

let running: Promise<void> | null = null;

// Fetch the cloud save, merge it with this device, store the result on both sides.
// Does nothing when not signed in. Safe to call often.
export function syncNow(): Promise<void> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync() {
  if (!supabase) return;
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) return;

  const { data, error } = await supabase.from("saves").select("data").eq("user_id", userId).maybeSingle();
  if (error) {
    // offline, or the cloud-save table isn't set up yet (run supabase/cloud-save.sql): try again later
    console.warn("[cloud] download failed:", error.message);
    return;
  }
  const local = await localSave();
  const merged = data?.data ? merge(local, data.data as Save) : local;

  // On this device (merged once more, in case a lesson was finished during the upload)
  merged.progress = await updateProgress((current) => mergeProgress(current, merged.progress));
  for (const c of courses) await savePrograms(c.id, merged.programs[c.id] ?? [], true);
  await addDeleted(merged.deleted);
  if (merged.name && merged.name !== local.name) await saveName(merged.name);
  if (merged.usage) await saveAllUsage(merged.usage);

  // In the cloud
  const { error: upError } = await supabase.from("saves").upsert({ user_id: userId, data: merged, updated_at: new Date().toISOString() });
  if (upError) console.warn("[cloud] upload failed:", upError.message);

  // Tell open screens to show the new numbers
  syncedListeners.forEach((l) => l());
}

// Screens that show progress listen here, so they update when another device's progress arrives
const syncedListeners = new Set<() => void>();
export function onSynced(listener: () => void) {
  syncedListeners.add(listener);
  return () => {
    syncedListeners.delete(listener);
  };
}

// Send changes a moment after they happen (a few quick changes become one upload)
let timer: ReturnType<typeof setTimeout> | null = null;
function soon() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow();
  }, 2500);
}

// Started once when the app opens (from the root layout)
let started = false;
export function startCloudSync() {
  if (started || !supabase) return;
  started = true;
  syncNow();
  onProgressSaved(soon);
  onProgramsSaved(soon);
  AppState.addEventListener("change", (state) => {
    if (state === "active") syncNow();
  });
  // Also check every 20 seconds while the app is open, so a device left open (like the computer)
  // picks up what you did on the other one
  setInterval(() => {
    if (AppState.currentState === "active" || AppState.currentState === undefined) syncNow();
  }, 20000);
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") syncNow();
  });
}

// When someone signs out, this device forgets their progress and programs,
// so the next person who signs in here starts with their own. (Everything is still in the cloud.)
export async function clearLocalData() {
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (k) =>
      k.startsWith("basic-lingo-progress") ||
      k.startsWith("basic-lingo-sandbox") ||
      k === "basic-lingo-usage" ||
      k === "basic-lingo-name" ||
      k === "basic-lingo-onboarded"
  );
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
