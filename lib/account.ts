import { clearLocalData, syncNow } from "./cloud";
import { saveName } from "./stats";
import { supabase } from "./supabase";

// Accounts: e-mail + password. Everyone signs in at the first start,
// and the progress is saved with the account on every device.

const NOT_SET_UP = "Online features aren't set up yet.";

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail or password is wrong.";
  if (/email not confirmed/i.test(message)) return "Confirm your e-mail first: open the link in the e-mail we sent you, then sign in.";
  if (/already registered|already been registered|user already exists/i.test(message))
    return "There's already an account with this e-mail. Sign in instead.";
  if (/database error saving new user/i.test(message)) return "That nickname was just taken. Try another one.";
  if (/password.*(short|least|characters)|weak/i.test(message)) return "The password needs at least 8 characters.";
  if (/rate|too many|security purposes/i.test(message)) return "Too many tries in a short time. Wait a few minutes and try again.";
  if (/expired|invalid.*token|otp/i.test(message)) return "That code is wrong or expired. Ask for a new one.";
  if (/sending|smtp/i.test(message)) return "The e-mail couldn't be sent. (Check the SMTP settings in Supabase.)";
  if (/invalid.*email|email.*invalid|valid email/i.test(message)) return "That doesn't look like an e-mail address.";
  if (/network|fetch|failed to/i.test(message)) return "Couldn't connect. Check your internet connection.";
  return message;
}

const cleanEmail = (email: string) => email.trim().toLowerCase();
const looksLikeEmail = (email: string) => /^\S+@\S+\.\S+$/.test(email.trim());

// After signing in: use the account's nickname here and bring the progress over
async function afterSignIn(userId: string) {
  if (!supabase) return;
  const { data: profile } = await supabase.from("profiles").select("nickname").eq("id", userId).maybeSingle();
  if (profile?.nickname) await saveName(profile.nickname);
  await syncNow();
}

// Returns an error message, "confirm" when the e-mail must be confirmed first, or null when signed in
export async function createAccount(nickname: string, email: string, password: string): Promise<string | null> {
  if (!supabase) return NOT_SET_UP;
  const name = nickname.trim();
  if (name.length < 2) return "Pick a nickname with at least 2 characters.";
  if (!looksLikeEmail(email)) return "That doesn't look like an e-mail address.";
  if (password.length < 8) return "The password needs at least 8 characters.";

  const { data: free, error: checkError } = await supabase.rpc("nickname_available", { name });
  if (checkError) return friendly(checkError.message);
  if (free === false) return `"${name}" is already taken. Try another nickname.`;

  const { data, error } = await supabase.auth.signUp({ email: cleanEmail(email), password, options: { data: { nickname: name } } });
  if (error) return friendly(error.message);
  // Supabase says "fine" for an existing e-mail too (so nobody can test which e-mails have accounts),
  // but then the user has no identities
  if (data.user && data.user.identities && data.user.identities.length === 0)
    return "There's already an account with this e-mail. Sign in instead.";
  if (!data.session) return "confirm";
  await saveName(name);
  await afterSignIn(data.session.user.id);
  return null;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return NOT_SET_UP;
  if (!looksLikeEmail(email)) return "That doesn't look like an e-mail address.";
  const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail(email), password });
  if (error || !data.user) return friendly(error?.message ?? "Sign-in didn't work.");
  await afterSignIn(data.user.id);
  return null;
}

// Forgot password: a 6-digit code by e-mail, then a new password
export async function sendResetCode(email: string): Promise<string | null> {
  if (!supabase) return NOT_SET_UP;
  if (!looksLikeEmail(email)) return "That doesn't look like an e-mail address.";
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail(email));
  return error ? friendly(error.message) : null;
}

export async function resetPassword(email: string, code: string, newPassword: string): Promise<string | null> {
  if (!supabase) return NOT_SET_UP;
  if (newPassword.length < 8) return "The new password needs at least 8 characters.";
  const { data, error } = await supabase.auth.verifyOtp({ email: cleanEmail(email), token: code.trim(), type: "recovery" });
  if (error || !data.user) return friendly(error?.message ?? "That code didn't work.");
  const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
  if (pwError) return friendly(pwError.message);
  await afterSignIn(data.user.id);
  return null;
}

// Sign out: save everything to the cloud first, then forget it on this device
export async function signOutHere() {
  if (!supabase) return;
  await syncNow();
  await clearLocalData();
  await supabase.auth.signOut();
}
