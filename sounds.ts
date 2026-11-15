import AsyncStorage from "@react-native-async-storage/async-storage";
import { noteSound, setTapPlayer } from "./click";
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { router } from "expo-router";
import { useCallback, useEffect } from "react";
import { useTheme } from "./theme";

// Sound effects that match each course's computer:
// BASIC: a teletype on a time-sharing terminal (typebar clacks, the paper bell).
// 6502: a single-board computer with a piezo beeper (key clicks, square-wave beeps).
// FORTRAN: a keypunch, a card reader and a line printer.
// C: a clicky VT100-style keyboard, the terminal bell and the PDP-11's disk.
// Altair 8800: metal toggle switches, the DEPOSIT and RUN paddles and the power supply's hum.
// COBOL: the 3270 terminal's keyboard clicker, its alarm beep and the mainframe's line printer.
// Pascal: an IBM PC with a buckling-spring keyboard, the PC speaker's square-wave beeps and a floppy drive.
// tap: choosing an answer. open/back: moving through the menus. toggle: switches.
export type SoundName = "tap" | "open" | "back" | "toggle" | "correct" | "wrong" | "complete" | "run";

const FILES: Record<string, Record<SoundName, number>> = {
  basic: {
    tap: require("./assets/sounds/basic-tap.wav"),
    open: require("./assets/sounds/basic-open.wav"),
    back: require("./assets/sounds/basic-back.wav"),
    toggle: require("./assets/sounds/basic-toggle.wav"),
    correct: require("./assets/sounds/basic-correct.wav"),
    wrong: require("./assets/sounds/basic-wrong.wav"),
    complete: require("./assets/sounds/basic-complete.wav"),
    run: require("./assets/sounds/basic-run.wav"),
  },
  ibm: {
    tap: require("./assets/sounds/ibm-tap.wav"),
    open: require("./assets/sounds/ibm-open.wav"),
    back: require("./assets/sounds/ibm-back.wav"),
    toggle: require("./assets/sounds/ibm-toggle.wav"),
    correct: require("./assets/sounds/ibm-correct.wav"),
    wrong: require("./assets/sounds/ibm-wrong.wav"),
    complete: require("./assets/sounds/ibm-complete.wav"),
    run: require("./assets/sounds/ibm-run.wav"),
  },
  unix: {
    tap: require("./assets/sounds/unix-tap.wav"),
    open: require("./assets/sounds/unix-open.wav"),
    back: require("./assets/sounds/unix-back.wav"),
    toggle: require("./assets/sounds/unix-toggle.wav"),
    correct: require("./assets/sounds/unix-correct.wav"),
    wrong: require("./assets/sounds/unix-wrong.wav"),
    complete: require("./assets/sounds/unix-complete.wav"),
    run: require("./assets/sounds/unix-run.wav"),
  },
  cobol: {
    tap: require("./assets/sounds/cobol-tap.wav"),
    open: require("./assets/sounds/cobol-open.wav"),
    back: require("./assets/sounds/cobol-back.wav"),
    toggle: require("./assets/sounds/cobol-toggle.wav"),
    correct: require("./assets/sounds/cobol-correct.wav"),
    wrong: require("./assets/sounds/cobol-wrong.wav"),
    complete: require("./assets/sounds/cobol-complete.wav"),
    run: require("./assets/sounds/cobol-run.wav"),
  },
  altair: {
    tap: require("./assets/sounds/altair-tap.wav"),
    open: require("./assets/sounds/altair-open.wav"),
    back: require("./assets/sounds/altair-back.wav"),
    toggle: require("./assets/sounds/altair-toggle.wav"),
    correct: require("./assets/sounds/altair-correct.wav"),
    wrong: require("./assets/sounds/altair-wrong.wav"),
    complete: require("./assets/sounds/altair-complete.wav"),
    run: require("./assets/sounds/altair-run.wav"),
  },
  turbo: {
    tap: require("./assets/sounds/turbo-tap.wav"),
    open: require("./assets/sounds/turbo-open.wav"),
    back: require("./assets/sounds/turbo-back.wav"),
    toggle: require("./assets/sounds/turbo-toggle.wav"),
    correct: require("./assets/sounds/turbo-correct.wav"),
    wrong: require("./assets/sounds/turbo-wrong.wav"),
    complete: require("./assets/sounds/turbo-complete.wav"),
    run: require("./assets/sounds/turbo-run.wav"),
  },
  kim: {
    tap: require("./assets/sounds/kim-tap.wav"),
    open: require("./assets/sounds/kim-open.wav"),
    back: require("./assets/sounds/kim-back.wav"),
    toggle: require("./assets/sounds/kim-toggle.wav"),
    correct: require("./assets/sounds/kim-correct.wav"),
    wrong: require("./assets/sounds/kim-wrong.wav"),
    complete: require("./assets/sounds/kim-complete.wav"),
    run: require("./assets/sounds/kim-run.wav"),
  },
};

// ---------- Sound on/off (saved on the phone) ----------

const KEY = "basic-lingo-sound";
let soundOn = true;
const listeners = new Set<(on: boolean) => void>();

AsyncStorage.getItem(KEY)
  .then((saved) => {
    soundOn = saved !== "off";
    listeners.forEach((l) => l(soundOn));
  })
  .catch(() => {});

// Play even when the phone is on silent (turn sounds off with the speaker button instead)
setAudioModeAsync({ playsInSilentMode: true }).catch((e) => console.warn("[sound] audio mode:", e));

export function isSoundOn() {
  return soundOn;
}

export function setSoundOn(on: boolean) {
  soundOn = on;
  listeners.forEach((l) => l(on));
  AsyncStorage.setItem(KEY, on ? "on" : "off").catch(() => {});
}

export function onSoundChange(listener: (on: boolean) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------- Playing ----------

// A few players per sound, used in turn. Quick taps then each get their own player
// instead of interrupting one that is still busy.
const COPIES = 3;
const players = new Map<string, AudioPlayer[]>();
const nextCopy = new Map<string, number>();

function playersFor(themeId: string, name: SoundName): AudioPlayer[] {
  const files = FILES[themeId] ?? FILES.basic;
  const key = `${themeId}-${name}`;
  if (!players.has(key)) {
    try {
      players.set(key, Array.from({ length: COPIES }, () => createAudioPlayer(files[name])));
    } catch (e) {
      console.warn("[sound] could not load", key, e);
      players.set(key, []);
    }
  }
  return players.get(key)!;
}

export function playSound(themeId: string, name: SoundName) {
  noteSound(); // so a button knows it already made a sound
  if (!soundOn) return;
  const list = playersFor(themeId, name);
  if (list.length === 0) return;
  const key = `${themeId}-${name}`;
  const index = nextCopy.get(key) ?? 0;
  nextCopy.set(key, (index + 1) % list.length);
  const player = list[index];
  try {
    // Rewind first and only then play. Playing before the rewind is done
    // does nothing when the sound had already played to its end.
    player.pause();
    player
      .seekTo(0)
      .then(() => player.play())
      .catch(() => player.play());
  } catch (e) {
    // A missing sound should never break a lesson, but show why in the Expo terminal
    console.warn("[sound] could not play", name, e);
  }
}

// ---------- Menus ----------

// The theme of the active course, kept up to date by the root layout
let currentThemeId = "basic";

export function useSoundTheme() {
  const t = useTheme();
  useEffect(() => {
    currentThemeId = t.id;
    (Object.keys(FILES.basic) as SoundName[]).forEach((name) => playersFor(t.id, name));
  }, [t.id]);
}

export function sound(name: SoundName) {
  playSound(currentThemeId, name);
}

// Every button without a sound of its own plays this one (see press.tsx)
setTapPlayer(() => sound("tap"));

// Open a screen / go back, with a little sound
export function go(path: string) {
  sound("open");
  router.push(path as any);
}

export function goBack() {
  sound("back");
  // On the computer the sidebar opens screens without history, then "back" means home
  if (router.canGoBack()) router.back();
  else router.replace("/" as any);
}

// In a screen: const play = useSound(); play("correct")
export function useSound() {
  const t = useTheme();
  // Load this course's sounds when the screen opens, so the first one isn't lost while loading
  useEffect(() => {
    (Object.keys(FILES.basic) as SoundName[]).forEach((name) => playersFor(t.id, name));
  }, [t.id]);
  return useCallback((name: SoundName) => playSound(t.id, name), [t.id]);
}
