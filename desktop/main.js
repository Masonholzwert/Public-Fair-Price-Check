// Basic Lingo for Mac / Windows.
// Opens the web version of the app (built with `npx expo export -p web` into ../dist) in its own window.
const { app, BrowserWindow, protocol, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

// Inside the finished app the web files are in resources/web, while testing they're in ../dist
const root = app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "..", "dist");

// app://basic-lingo/… acts like a small website, so the app's links, sounds and saved progress work
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: "Basic Lingo",
    backgroundColor: "#0B140D",
    autoHideMenuBar: true,
    webPreferences: { autoplayPolicy: "no-user-gesture-required" },
  });
  // Links to other websites open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL("app://basic-lingo/");
}

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    let file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    // Unknown paths (like /chapter/3) go to index.html, the app's router takes it from there
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, "index.html");
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
