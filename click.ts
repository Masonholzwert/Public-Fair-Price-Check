// The tap sound for every button, without the button module needing the sound module
// (that would make a loop: buttons → sounds → theme → buttons).
// The sound module tells this one how to play a tap and counts every sound it plays.

let asked = 0;
let playTap: () => void = () => {};

// Called by the sound module for every sound
export function noteSound() {
  asked++;
}

export function soundCount() {
  return asked;
}

export function setTapPlayer(play: () => void) {
  playTap = play;
}

export function tap() {
  playTap();
}
