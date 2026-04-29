const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.DESK_DASHBOARD_API_PORT || 4177);
const DATA_DIR = path.join(os.homedir(), ".desk-dashboard");
const DATA_FILE = path.join(DATA_DIR, "state.json");
const WORKTREE_DIR = path.join(DATA_DIR, "worktrees");
const staticArgIndex = process.argv.indexOf("--static");
const staticRoot = staticArgIndex >= 0 ? path.resolve(process.argv[staticArgIndex + 1] || "dist") : "";
const runs = new Map();

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
      resolve(error ? "" : stdout.trim());
    });
  });
}

function runProcess(cwd, command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  const onLine = options.onLine || (() => {});
  const run = options.run;

  return new Promise((resolve) => {
    if (run?.cancelRequested) {
      resolve({ code: 130, output: "", error: new Error("Run cancelled") });
      return;
    }

    const child = spawn(command, args, {
      cwd,
      shell: Boolean(options.shell),
      windowsHide: true
    });
    if (run) run.currentChild = child;
    if (typeof options.input === "string" && child.stdin) {
      child.stdin.end(options.input);
    }

    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      onLine(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);

    function append(chunk, stream) {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLine(`${stream}: ${line}`);
      }
    }

    child.stdout.on("data", (chunk) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk) => append(chunk, "stderr"));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (run?.currentChild === child) delete run.currentChild;
      resolve({ code: 1, output, error });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (run?.currentChild === child) delete run.currentChild;
      resolve({ code: code ?? 0, output });
    });
  });
}

function runCapture(cwd, command, args, options = {}) {
  const lines = [];
  return runProcess(cwd, command, args, {
    timeoutMs: options.timeoutMs || 15_000,
    shell: options.shell,
    input: options.input,
    onLine: (line) => lines.push(line)
  }).then((result) => ({
    ...result,
    lines,
    text: lines.join("\n")
  }));
}

function makeLog(taskId, kind, message) {
  return {
    id: `log-${crypto.randomUUID()}`,
    taskId,
    kind,
    at: new Date().toISOString(),
    message
  };
}

function addRunLog(run, kind, message) {
  run.logs.push(makeLog(run.taskId, kind, message));
}

function publicRun(run) {
  const { currentChild, cancelRequested, ...rest } = run;
  return rest;
}

function safeSlug(value) {
  return String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
}

async function isGitRepository(projectPath) {
  return (await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"])) === "true";
}

async function readPackageScripts(projectPath) {
  const packagePath = path.join(projectPath, "package.json");
  if (!(await pathExists(packagePath))) return {};
  const pkg = await readJson(packagePath, {});
  return pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
}

function isGptModel(model) {
  return String(model || "").toLowerCase().startsWith("gpt-");
}

function bin(name) {
  if (process.platform !== "win32") return name;
  if (name === "npm") return "npm.cmd";
  return name;
}

function buildCodexPrompt(payload) {
  return [
    "你正在一个由 Desk Dashboard 创建的隔离 git worktree 中工作。",
    "只修改当前 worktree 内的文件，不要访问或修改其他目录。",
    "完成后请尽量运行项目已有的验证命令；如果无法运行，请在最终回复中说明原因。",
    "",
    `需求标题：${payload.title}`,
    `需求描述：${payload.description || "无"}`,
    "",
    "请完成这个需求，并保持改动尽量小而清晰。"
  ].join("\n");
}

function buildCodexExecArgs(worktreePath, model) {
  const args = ["exec", "--cd", worktreePath, "--sandbox", "workspace-write"];
  const normalizedModel = String(model || "").toLowerCase();
  if (normalizedModel && normalizedModel !== "gpt-default" && normalizedModel !== "gpt-auto") {
    args.push("--model", model);
  }
  args.push("-");
  return args;
}

function extractCodexVersion(text) {
  const match = String(text || "").match(/codex(?:-cli)?\s+([0-9][^\s]*)/i);
  return match ? match[1] : "";
}

function parseCodexFailure(text) {
  const raw = String(text || "");
  if (/requires a newer version of Codex/i.test(raw)) {
    return {
      code: "codex-outdated",
      summary: "当前命中的 Codex CLI 版本过旧，无法使用账号默认模型。",
      action: "请升级或修正 PATH，让 Runner 命中新版 Codex CLI 后重试。"
    };
  }
  const unsupported = raw.match(/The '([^']+)' model is not supported/i);
  if (unsupported) {
    return {
      code: "model-unsupported",
      summary: `当前 Codex 账号或 CLI 不支持模型 ${unsupported[1]}。`,
      action: "请改用账号可用模型，或使用 gpt-default 让 Codex CLI 选择默认模型。"
    };
  }
  if (/spawn EPERM|Access is denied/i.test(raw)) {
    return {
      code: "spawn-denied",
      summary: "Windows 拒绝直接启动 Codex CLI。",
      action: "请使用 shell 启动或修正 Codex CLI 路径，避免直接 spawn WindowsApps 应用别名。"
    };
  }
  if (/unexpected argument/i.test(raw)) {
    return {
      code: "cli-args",
      summary: "Codex CLI 参数与当前版本不兼容。",
      action: "请使用当前 CLI 支持的 exec 参数，并通过 stdin 传入多行 prompt。"
    };
  }
  return {
    code: "codex-failed",
    summary: "Codex CLI 执行失败。",
    action: "请查看下方日志中的 stderr，确认账号、网络、模型和 CLI 版本。"
  };
}

async function inspectCodexCli(cwd) {
  const shell = process.platform === "win32";
  const versionResult = await runCapture(cwd, bin("codex"), ["--version"], {
    shell,
    timeoutMs: 20_000
  });
  const pathCommand = process.platform === "win32" ? "cmd.exe" : "sh";
  const pathArgs = process.platform === "win32" ? ["/d", "/s", "/c", "where codex"] : ["-lc", "command -v codex"];
  const pathResult = await runCapture(cwd, pathCommand, pathArgs, { timeoutMs: 20_000 });
  const paths = pathResult.lines
    .map((line) => line.replace(/^(stdout|stderr):\s*/, "").trim())
    .filter(Boolean);
  const version = extractCodexVersion(versionResult.text);
  const warnings = [];

  if (version && /^0\.(?:[0-9]|[1-9][0-9])\./.test(version)) {
    warnings.push("当前 Codex CLI 版本较旧，可能不支持最新模型。");
  }
  if (paths.some((item) => /AppData\\Roaming\\npm\\codex\.cmd/i.test(item))) {
    warnings.push("PATH 中存在旧的 npm codex shim，可能会优先命中旧 CLI。");
  }

  return {
    command: "codex",
    version,
    paths,
    exitCode: versionResult.code,
    ok: versionResult.code === 0,
    warnings,
    raw: versionResult.text
  };
}

async function startTaskRun(payload) {
  const started = Date.now();
  const model = payload.model || "gpt-5.4-codex";
  const agent = isGptModel(model) ? "codex-cli" : "local-runner";
  const runId = `run-${crypto.randomUUID()}`;
  const branch = `desk-dashboard/${runId.slice(4, 12)}-${safeSlug(payload.title)}`;
  const projectHash = crypto.createHash("sha1").update(payload.projectPath).digest("hex").slice(0, 12);
  const worktreePath = path.join(WORKTREE_DIR, projectHash, runId);
  const run = {
    id: runId,
    taskId: payload.taskId,
    projectPath: payload.projectPath,
    worktreePath: "",
    branch: "",
    model,
    agent,
    status: "running",
    startedAt: new Date(started).toISOString(),
    logs: [],
    diagnostics: {},
    diffStat: "",
    diff: ""
  };

  runs.set(runId, run);
  addRunLog(run, "event", "Runner run 已创建，等待后台执行");

  queueMicrotask(async () => {
    try {
      addRunLog(run, "event", `收到任务：${payload.title}`);

      if (!(await pathExists(payload.projectPath))) {
        throw new Error("项目路径不存在，无法启动任务");
      }

      if (!(await isGitRepository(payload.projectPath))) {
        addRunLog(run, "error", "当前项目不是 Git 仓库，Runner 暂不执行会写入文件的任务");
        run.status = "failed";
        return;
      }

      const sourceStatus = await runGit(payload.projectPath, ["status", "--porcelain"]);
      if (sourceStatus) {
        addRunLog(run, "event", "源项目存在未提交改动，本次执行从当前 HEAD 创建隔离 worktree，不会触碰这些改动");
      }

      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      addRunLog(run, "command", `git worktree add -b ${branch} ${worktreePath} HEAD`);
      const worktreeResult = await runProcess(payload.projectPath, "git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
        timeoutMs: 60_000,
        run,
        onLine: (line) => addRunLog(run, "command", line)
      });

      if (run.cancelRequested) throw new Error("任务已停止");
      if (worktreeResult.code !== 0) {
        throw new Error("创建隔离 worktree 失败");
      }

      run.worktreePath = worktreePath;
      run.branch = branch;
      addRunLog(run, "event", `隔离环境已创建：${worktreePath}`);

      if (agent === "codex-cli") {
        run.diagnostics.codex = await inspectCodexCli(worktreePath);
        if (run.diagnostics.codex.ok) {
          addRunLog(run, "agent", `Codex CLI preflight passed: ${run.diagnostics.codex.version || "unknown version"}`);
        } else {
          addRunLog(run, "error", "Codex CLI preflight failed: version command did not complete");
        }
        for (const warning of run.diagnostics.codex.warnings || []) {
          addRunLog(run, "error", warning);
        }
        addRunLog(run, "agent", `使用本地 Codex CLI 执行：${model}`);
        const codexResult = await runProcess(
          worktreePath,
          bin("codex"),
          buildCodexExecArgs(worktreePath, model),
          {
            timeoutMs: 600_000,
            shell: process.platform === "win32",
            input: buildCodexPrompt(payload),
            run,
            onLine: (line) => addRunLog(run, "agent", line)
          }
        );

        if (run.cancelRequested) throw new Error("任务已停止");
        if (codexResult.code !== 0) {
          run.diagnostics.codexFailure = parseCodexFailure(codexResult.output);
          addRunLog(run, "error", run.diagnostics.codexFailure.summary);
          addRunLog(run, "error", run.diagnostics.codexFailure.action);
          throw new Error("Codex CLI 执行失败");
        }
      } else {
        addRunLog(run, "event", `模型 ${model} 暂未接入自动编码 Agent，本次仅执行隔离与验证流程`);
      }

      const scripts = await readPackageScripts(worktreePath);
      if (scripts.build) {
        if (!(await pathExists(path.join(worktreePath, "node_modules")))) {
          run.diagnostics.build = {
            skipped: true,
            reason: "隔离 worktree 中没有 node_modules，跳过自动 build，避免在 Runner 中隐式安装依赖。"
          };
          addRunLog(run, "command", run.diagnostics.build.reason);
        } else {
        addRunLog(run, "command", "检测到 build 脚本，开始执行 npm run build");
        const buildResult = await runProcess(worktreePath, bin("npm"), ["run", "build"], {
          timeoutMs: 180_000,
          shell: process.platform === "win32",
          run,
          onLine: (line) => addRunLog(run, "command", line)
        });
        if (run.cancelRequested) throw new Error("任务已停止");
        if (buildResult.code !== 0) {
          throw new Error("npm run build 执行失败");
        }
        }
      } else {
        addRunLog(run, "event", "未检测到 package.json build 脚本，本次跳过自动构建验证");
      }

      addRunLog(run, "command", "收集 git diff 和状态");
      run.diffStat = await runGit(worktreePath, ["diff", "--stat"]);
      run.diff = await runGit(worktreePath, ["diff", "--"]);
      const finalStatus = await runGit(worktreePath, ["status", "--short"]);

      if (finalStatus) {
        addRunLog(run, "change", finalStatus);
      } else {
        addRunLog(run, "change", "没有检测到文件改动");
      }

      run.status = "review";
      addRunLog(run, "event", "Runner 执行完成，等待人工验收");
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : "未知错误";
      addRunLog(run, "error", run.error);
    } finally {
      run.finishedAt = new Date().toISOString();
      run.elapsedMs = Date.now() - started;
    }
  });

  return run;
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

  return projects.filter(Boolean).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const resolved = path.resolve(staticRoot, `.${requested}`);
  const fallback = path.join(staticRoot, "index.html");
  const filePath = resolved.startsWith(staticRoot) && (await pathExists(resolved)) ? resolved : fallback;
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  };

  try {
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(await fs.readFile(filePath));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, await readJson(DATA_FILE, { workspacePath: "", tasks: [], logs: {} }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/state") {
      await writeJson(DATA_FILE, await readBody(req));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/scan") {
      const { rootPath } = await readBody(req);
      if (!rootPath || !(await pathExists(rootPath))) {
        sendJson(res, 200, []);
        return;
      }

      sendJson(res, 200, await scanWorkspace(rootPath));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/project/open") {
      const { projectPath } = await readBody(req);
      if (!projectPath || !(await pathExists(projectPath))) {
        sendJson(res, 404, { ok: false });
        return;
      }

      const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
      execFile(command, [projectPath], () => {});
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/task-runs") {
      const payload = await readBody(req);
      if (!payload.taskId || !payload.projectPath || !payload.title) {
        sendJson(res, 400, { error: "taskId, projectPath and title are required" });
        return;
      }

      sendJson(res, 200, publicRun(await startTaskRun(payload)));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/task-runs/")) {
      const runId = decodeURIComponent(url.pathname.split("/").pop() || "");
      const run = runs.get(runId);
      if (!run) {
        sendJson(res, 404, { error: "Run not found" });
        return;
      }

      sendJson(res, 200, publicRun(run));
      return;
    }

    if (req.method === "POST" && url.pathname.endsWith("/cancel") && url.pathname.startsWith("/api/task-runs/")) {
      const runId = decodeURIComponent(url.pathname.split("/").at(-2) || "");
      const run = runs.get(runId);
      if (!run) {
        sendJson(res, 404, { error: "Run not found" });
        return;
      }

      if (run.status !== "running") {
        sendJson(res, 200, publicRun(run));
        return;
      }

      run.cancelRequested = true;
      addRunLog(run, "error", "收到停止请求，正在终止当前命令");
      if (run.currentChild) run.currentChild.kill();
      sendJson(res, 200, publicRun(run));
      return;
    }

    if (staticRoot) {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Desk Dashboard local API listening on http://127.0.0.1:${PORT}`);
});
