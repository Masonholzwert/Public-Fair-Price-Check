# Basic Lingo for Mac / Windows

The desktop version is the web version of the app inside its own window (Electron).
Same code, same courses. Progress is saved on the computer, separately from the phone.

## One time

1. In the project folder:
   npx expo install react-dom react-native-web @expo/metro-runtime
2. In app.json, inside "expo", set:
   "web": { "output": "single" }
3. In the desktop folder:
   cd desktop
   npm install

## Try it

   cd desktop
   npm start

## Build the download

Mac (.dmg):      npm run mac       → desktop/release/Basic Lingo-<version>-universal.dmg
Windows (.exe):  npm run windows   → desktop/release/Basic Lingo Setup <version>.exe
                 (most reliable when run on a Windows PC)

After changing the app, run the same command again, it rebuilds everything.

## A new version

1. Raise "version" in desktop/package.json (1.1.0 → 1.2.0 …), so the new download gets its own name.
2. Run npm run mac (or npm run windows) again.

Versions so far:
- 1.0.0: first desktop version
- 1.1.0: COBOL course, practice for every language, smooth design with the rail and the new menu,
         sounds on every button, 49 achievements with dates, % done on every course
- 1.2.0: time in the app, lessons and other stats on the profile
