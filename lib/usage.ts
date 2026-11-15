import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { dayKey } from "./progress";

// Time spent in the app: counted in steps of a few seconds while the app is open and in front.
// Every device counts its own time, and the cloud save carries all of them, so the profile
// shows the time from the phone and the computer added up.

export type Usage = {
  days: Record<string, number>; // seconds per day, like "2026-11-15": 1260
  courses: Record<string, number>; // seconds per course
  sessions: number; // how often the app was opened (or came back after a while)
  longest: number; // the longest session, in seconds
};

export type AllUsage = Record<string, Usage>; // by device

const KEY = "basic-lingo-usage";
const DEVICE_KEY = "basic-lingo-device";
const TICK = 15; // seconds between two counts
const NEW_SESSION_AFTER = 5 * 60 * 1000; // away longer than this: the next visit is a new session

const emptyUsage = (): Usage => ({ days: {}, courses: {}, sessions: 0, longest: 0 });
const total = (u: Usage) => Object.values(u.days).reduce((a, b) => a + b, 0);

let deviceId: string | null = null;
async function getDeviceId() {
  if (deviceId) return deviceId;
  try {
    deviceId = await AsyncStorage.getItem(DEVICE_KEY);
    if (!deviceId) {
      deviceId = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await AsyncStorage.setItem(DEVICE_KEY, deviceId);
    }
  } catch {
    deviceId = deviceId ?? "this-device";
  }
  return deviceId;
}

export async function loadAllUsage(): Promise<AllUsage> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}");
  } catch {
    return {};
  }
}

// Two copies of the usage (this device and the cloud): for every device, the one with more time wins
export function mergeUsage(a: AllUsage, b: AllUsage): AllUsage {
  const out: AllUsage = { ...a };
  for (const [device, u] of Object.entries(b ?? {})) {
    if (!out[device] || total(u) > total(out[device])) out[device] = u;
  }
  return out;
}

// Saves what the cloud brought, without losing seconds counted in the meantime
export async function saveAllUsage(all: AllUsage) {
  const current = await loadAllUsage();
  await AsyncStorage.setItem(KEY, JSON.stringify(mergeUsage(current, all))).catch(() => {});
}

// ---------- Counting ----------

let courseId = "basic";
export function setUsageCourse(id: string) {
  courseId = id;
}

let started = false;
let sessionSeconds = 0;
let lastSeen = 0;
let writing: Promise<void> = Promise.resolve();

function isActive() {
  return AppState.currentState === "active" || AppState.currentState === undefined || AppState.currentState === null;
}

// Started once from the root layout
export function startUsageTracking() {
  if (started) return;
  started = true;
  newVisit();
  AppState.addEventListener("change", (state) => {
    if (state === "active") newVisit();
  });
  setInterval(() => {
    if (isActive()) count(TICK);
  }, TICK * 1000);
}

// Coming back after a while starts a new session
function newVisit() {
  const now = Date.now();
  if (now - lastSeen > NEW_SESSION_AFTER) {
    sessionSeconds = 0;
    writing = writing.then(() => change((u) => (u.sessions += 1)));
  }
  lastSeen = now;
}

function count(seconds: number) {
  lastSeen = Date.now();
  sessionSeconds += seconds;
  const day = dayKey();
  const course = courseId;
  const session = sessionSeconds;
  writing = writing.then(() =>
    change((u) => {
      u.days[day] = (u.days[day] ?? 0) + seconds;
      u.courses[course] = (u.courses[course] ?? 0) + seconds;
      u.longest = Math.max(u.longest, session);
    })
  );
}

async function change(edit: (u: Usage) => void) {
  try {
    const id = await getDeviceId();
    const all = await loadAllUsage();
    const mine = all[id] ?? emptyUsage();
    edit(mine);
    // Days older than two years are dropped, so the save stays small
    const oldest = dayKey(new Date(Date.now() - 730 * 86400000));
    for (const d of Object.keys(mine.days)) if (d < oldest) delete mine.days[d];
    all[id] = mine;
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not being able to count a few seconds must never bother anyone
  }
}

// ---------- Reading ----------

export type TimeStats = {
  total: number;
  today: number;
  week: number; // the last 7 days
  perDay: number; // average on the days the app was used
  daysUsed: number;
  sessions: number;
  longest: number;
  courses: Record<string, number>;
};

export function timeStats(all: AllUsage): TimeStats {
  const days: Record<string, number> = {};
  const courses: Record<string, number> = {};
  let sessions = 0;
  let longest = 0;
  for (const u of Object.values(all)) {
    for (const [d, s] of Object.entries(u.days ?? {})) days[d] = (days[d] ?? 0) + s;
    for (const [c, s] of Object.entries(u.courses ?? {})) courses[c] = (courses[c] ?? 0) + s;
    sessions += u.sessions ?? 0;
    longest = Math.max(longest, u.longest ?? 0);
  }
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - i * 86400000))));
  const sum = Object.values(days).reduce((a, b) => a + b, 0);
  const daysUsed = Object.values(days).filter((s) => s > 0).length;
  return {
    total: sum,
    today: days[dayKey()] ?? 0,
    week: Object.entries(days).filter(([d]) => week.has(d)).reduce((a, [, s]) => a + s, 0),
    perDay: daysUsed ? Math.round(sum / daysUsed) : 0,
    daysUsed,
    sessions,
    longest,
    courses,
  };
}

// 0 → "0m", 840 → "14m", 7380 → "2h 3m", 200000 → "55h 33m"
export function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
