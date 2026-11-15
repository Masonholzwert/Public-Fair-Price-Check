// Builds the web version of the app into ../dist.
// It starts Expo with the npm settings of this desktop folder removed, otherwise Expo
// picks up desktop/package.json and builds main.js (the window code) instead of the app.
const { execSync } = require("child_process");
const path = require("path");

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("npm_")) delete env[key];
}
execSync("npx expo export -p web --clear", { cwd: path.join(__dirname, ".."), stdio: "inherit", env });
