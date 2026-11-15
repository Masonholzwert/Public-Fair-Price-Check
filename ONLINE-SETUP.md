# Online features: setup

Leaderboards and shared programs run on **Supabase** (free plan). Players join with just a
nickname: no e-mail, no password. This takes about 10 minutes, once. Until it's done, the app
works as before and the online screens show "Online features aren't set up yet".

## 1. Install the new packages

In the VS Code terminal, inside the project folder:

```
npx expo install @supabase/supabase-js react-native-url-polyfill
```

## 2. Create the Supabase project

1. Go to https://supabase.com and sign up (GitHub login works).
2. **New project**. Name: `basic-lingo`. Region: **Central EU (Frankfurt)**. Pick a database password and save it somewhere.
3. Wait until the project is ready (about 2 minutes).

## 3. Create the tables

1. In Supabase, open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from the project in VS Code, copy everything, paste it in, press **Run**.
3. It should say *Success. No rows returned.*

## 4. Allow joining with a nickname

In Supabase: **Authentication** → **Sign In / Providers** (or **Settings**) → switch on
**Allow anonymous sign-ins** → **Save**.

## 5. Connect the app

1. In Supabase: **Project Settings** → **API Keys** (or **Data API**). Copy the **Project URL** and the **anon / public** key.
2. In VS Code, create a file called `.env` in the project folder (next to `package.json`):

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

3. Open `.gitignore` and add a line with `.env`, so the keys don't end up on GitHub.

## 6. Start

```
npx expo start -c
```

Then ☰ → Profile → pick a nickname → **JOIN**.

## Good to know

- The online account belongs to the phone. Deleting the app loses it (the progress on the
  phone is lost then anyway). A real login (Apple / Google) can be added later and keep the same data.
- Nicknames are unique. Nobody can take a name that's already used.
- Supabase recommends a captcha for anonymous sign-ins once an app is public, against fake players.
  Not needed while testing.

## What's stored online

- the nickname
- streak, units done, number of sandbox programs and lines, XP
- programs a player chooses to share, and their likes and reports

Players can delete everything with **Profile → Leave leaderboards**. Before publishing,
you'll need a short privacy policy (GDPR) that lists these points.
