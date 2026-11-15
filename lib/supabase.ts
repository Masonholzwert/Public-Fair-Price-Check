import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session, createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

// The online part of the app: accounts, cloud save, leaderboards and shared programs.
// The keys come from the .env file in the project folder (see ONLINE-SETUP.md).
// Without them, the app works as before and the online screens explain what's missing.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isOnlineSetUp = !!url && !!key;

export const supabase = isOnlineSetUp
  ? createClient(url!, key!, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    })
  : null;

// Keep the login fresh while the app is open
if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export async function signOut() {
  await supabase?.auth.signOut();
}

// The signed-in player, or null. Updates when signing in or out.
export function useSession(): Session | null {
  return useAuth().session;
}

// Like useSession, plus `ready`: false until the saved login has been read from the device,
// so the app doesn't flash the sign-in screen for someone who is already signed in.
export function useAuth(): { session: Session | null; ready: boolean } {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: !supabase });
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, ready: true }));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setState({ session: s, ready: true }));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}
