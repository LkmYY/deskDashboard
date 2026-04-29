const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_FILE = "desk-dashboard-state.json";

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    title: "Desk Dashboard",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    win.loadURL(devServer);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function getStatePath() {
  return path.join(app.getPath("userData"), DATA_FILE);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }

      resolve(stdout.trim());
    });
  });
}

function detectProjectType(files) {
  const fileSet = new Set(files);
  const types = [];

  if (fileSet.has("package.json")) types.push("Node");
  if (fileSet.has("vite.config.ts") || fileSet.has("vite.config.js")) types.push("Vite");
  if (fileSet.has("next.config.js") || fileSet.has("next.config.ts")) types.push("Next");
  if (fileSet.has("pyproject.toml") || fileSet.has("requirements.txt")) types.push("Python");
  if (fileSet.has("Cargo.toml")) types.push("Rust");
  if (fileSet.has("go.mod")) types.push("Go");
  if (fileSet.has("pom.xml") || fileSet.has("build.gradle")) types.push("Java");

  return types.length ? types : ["Project"];
}

async function readPackageName(projectPath) {
  const packagePath = path.join(projectPath, "package.json");
  if (!(await pathExists(packagePath))) return null;

  const pkg = await readJson(packagePath, {});
  return typeof pkg.name === "string" && pkg.name.trim() ? pkg.name : null;
}

async function scanOneProject(projectPath, direntName) {
  const entries = await fs.readdir(projectPath, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const name = (await readPackageName(projectPath)) || direntName;
  const isGit = dirs.includes(".git");
  const stats = await fs.stat(projectPath);
  const branch = isGit ? (await runGit(projectPath, ["branch", "--show-current"])) || "detached" : "";
  const status = isGit ? await runGit(projectPath, ["status", "--porcelain"]) : "";
  const lastCommit = isGit ? await runGit(projectPath, ["log", "-1", "--pretty=%cr"]) : "";

  return {
    id: crypto.createHash("sha1").update(projectPath).digest("hex"),
    name,
    path: projectPath,
    type: detectProjectType([...files, ...dirs]),
    branch,
    dirty: Boolean(status),
    lastCommit,
    updatedAt: stats.mtimeMs
  };
}

async function scanWorkspace(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const projectMarkers = new Set([
    ".git",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle"
  ]);

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const projectPath = path.join(rootPath, entry.name);
    const childEntries = await fs.readdir(projectPath, { withFileTypes: true }).catch(() => []);
    if (childEntries.some((child) => projectMarkers.has(child.name))) {
      candidates.push({ projectPath, name: entry.name });
    }
  }

  const projects = await Promise.all(
    candidates.map(({ projectPath, name }) => scanOneProject(projectPath, name).catch(() => null))
  );

  return projects
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

ipcMain.handle("workspace:choose", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择项目工作区",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("workspace:scan", async (_event, rootPath) => {
  if (!rootPath || !(await pathExists(rootPath))) {
    return [];
  }

  return scanWorkspace(rootPath);
});

ipcMain.handle("state:load", async () => {
  return readJson(getStatePath(), {
    workspacePath: "",
    tasks: [],
    logs: {}
  });
});

ipcMain.handle("state:save", async (_event, state) => {
  await writeJson(getStatePath(), state);
  return true;
});

ipcMain.handle("project:open", async (_event, projectPath) => {
  if (!projectPath || !(await pathExists(projectPath))) return false;
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";

  execFile(command, [projectPath], () => {});
  return true;
});
