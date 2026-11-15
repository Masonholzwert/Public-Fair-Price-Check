import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { syncNow } from "./cloud";
import { loadProgress } from "./progress";

// The first-start introduction: shown once after signing in for the first time on a device.
// People who already have progress (from before, or synced from their account) skip it.

const KEY = "basic-lingo-onboarded";
const listeners = new Set<(done: boolean) => void>();

export async function finishOnboarding() {
  await AsyncStorage.setItem(KEY, "1");
  listeners.forEach((l) => l(true));
}

// Admin: show the introduction again
export async function resetOnboarding() {
  await AsyncStorage.removeItem(KEY);
  listeners.forEach((l) => l(false));
}

async function isOnboarded(): Promise<boolean> {
  if ((await AsyncStorage.getItem(KEY)) === "1") return true;
  const progress = await loadProgress();
  if (Object.keys(progress.done).length > 0) {
    await AsyncStorage.setItem(KEY, "1"); // already learning: no introduction needed
    return true;
  }
  return false;
}

// `ready` is false while checking. Re-checks when the signed-in player changes.
export function useOnboarded(userId: string | undefined): { ready: boolean; done: boolean } {
  const [state, setState] = useState({ ready: false, done: false });
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setState({ ready: false, done: false });
    // First fetch the account's progress (at most 3 seconds), so someone signing in on a new device
    // who already learned elsewhere doesn't get the introduction again
    const wait = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([syncNow().catch(() => {}), wait])
      .then(isOnboarded)
      .then((done) => alive && setState({ ready: true, done }));
    const listener = (done: boolean) => setState({ ready: true, done });
    listeners.add(listener);
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, [userId]);
  return state;
}
