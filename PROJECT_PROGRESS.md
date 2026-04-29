# Desk Dashboard 项目进度

最后更新：2026-04-29

## 当前状态

Desk Dashboard 已经从一个本地项目看板 MVP，推进到带有真实 Runner v1 链路的本地开发工作台。当前可以扫描本地工作区、管理项目任务、创建隔离的 Git worktree、为 `gpt-*` 模型调用本地 Codex CLI、收集执行日志，并展示 diff 摘要。

## 已完成功能

- 已完成 React/Vite 前端看板和 Node 本地 API。
- 已完成工作区扫描和项目识别。
- 已完成可拖拽的工作台面板和可拖拽的看板状态列。
- 已完成任务创建、编辑、删除、执行、停止、验收和归档流程。
- 已完成底部对话式任务发布面板。
- 已完成详情页动态计划方案生成。
- 已完成本地 Runner API：
  - `POST /api/task-runs`
  - `GET /api/task-runs/:id`
  - `POST /api/task-runs/:id/cancel`
- 已完成 Git worktree 隔离，隔离目录位于 `~/.desk-dashboard/worktrees`。
- 已完成 `gpt-*` 模型到本地 `codex exec` 的路由。
- 已修复 Windows 下 Runner 启动 Codex CLI 的兼容问题：
  - 不再直接 spawn WindowsApps/应用别名中的 `codex.exe`。
  - Windows 下通过 shell 启动 `codex`，避免 `spawn EPERM`。
  - prompt 改为通过 stdin 传递，避免多行需求被 shell 拆成错误参数。
  - 移除旧版 Codex CLI 不支持的 `--ask-for-approval` 参数。
  - 新增 `gpt-default` / `gpt-auto` 路由，允许使用 Codex CLI 当前账号默认模型。
- 已完成 Runner 日志、耗时、worktree 路径、分支、diff stat 和 diff 展示。
- 已初始化本地 Git 仓库，准备接入 GitHub 远端 `https://github.com/LkmYY/deskDashboard.git`。
- 已新增 `.gitignore`，避免上传 `node_modules`、`dist`、日志、缓存和本地环境文件。
- 已将 `README.md` 重写为干净的 UTF-8 中文文档，避免上传乱码文档污染远端。
- 已将当前项目代码以非强推方式上传到 GitHub 远端 `main` 分支。

## 已验证

- `npm run build` 通过。
- `node --check server/local-api.cjs` 通过。
- 本地 API 可通过 `127.0.0.1:4177` 访问。
- Vite 应用可通过 `127.0.0.1:5173` 访问。
- 非 Git 项目执行任务时会在进入 Codex 前安全失败。
- 选择 gpt 模型时，Runner 会被识别为 `codex-cli`。
- 已在真实 Git 项目 `D:\lsProject\deskDashboard` 上验证 Runner 可创建隔离 worktree，并真实启动本地 Codex CLI：
  - 成功创建 worktree：`~/.desk-dashboard/worktrees/3ea8a415a007/run-b8bcc42d-6e3e-4f90-9d83-c5b0e1d9fd16`。
  - Runner 已进入 `codex exec` 阶段，日志中能看到 Codex CLI 读取 prompt、workdir、sandbox 和账号默认模型。
  - 源项目目录未生成 `RUNNER_SMOKE_TEST.md`，确认没有直接污染源目录。
  - 失败 run 的 worktree 未产生未预期文件改动。
- 已确认 GitHub 远端 `main` 分支存在提交，上传前必须走合并/追加提交流程，不能强推覆盖。
- `README.md` 已能作为项目入口说明，并链接到本进度文件。
- GitHub 远端 `main` 已包含当前 MVP 代码、进度文件和上传污染控制配置；最新提交以 `git log --oneline -1` 为准。

## 已知问题

- 真实 Git Runner 验证已推进到 Codex CLI 启动阶段，但尚未完成 Agent 写文件和 diff 收集闭环：
  - `gpt-5.4-codex`、`gpt-5-codex`、`gpt-5`、`gpt-5.1-codex` 在当前 ChatGPT 账号模式下被本地 CLI 判定为不支持。
  - 使用 `gpt-default` 时，旧版 `codex` shim 解析到 `codex-cli 0.112.0`，默认模型为 `gpt-5.5`，CLI 提示需要升级到更新版本。
  - 当前 PATH 同时存在旧的 `C:\Users\Dell\AppData\Roaming\npm\codex.cmd` 和新的 OpenAI Codex 应用 CLI，Runner 通过 shell 时会优先命中旧 shim。
- in-app browser 自动化仍可能解析到旧 Node 路径，nvm 更新后可能需要重启 Codex。
- Runner 状态目前保存在内存中，应用状态保存在 JSON 中；API 重启后 run 记录不会持久保留。
- 还没有针对验收通过后的 worktree 改动提供合并/应用流程。
- 还没有清理旧 worktree 的 UI。

## 下一步优先级

1. 修复本机 Codex CLI 路径和版本选择：优先使用新版 OpenAI Codex CLI，避免 PATH 命中旧 `npm` shim。
2. 增加 Runner 启动前的 `codex --version` / 可用模型自检，并在 UI 中提示模型不可用原因。
3. 在 Codex CLI 升级或路径修复后，重新跑真实 Git Runner smoke test，确认能生成 `RUNNER_SMOKE_TEST.md`、收集 diff，并进入验收区。
4. 将 run 状态持久化到 `~/.desk-dashboard/state.json` 或 SQLite。
5. 增加 worktree 清理和安全放弃流程。
6. 增加验收后接受、应用、合并改动的流程。
7. 增加更完整的 diff 查看器和变更文件列表。
8. 解析 Codex 执行 transcript，让日志更清晰。
9. 增加非 gpt Agent 的 provider 抽象。
10. 增加任务生命周期和 Runner API 的自动化测试。

## 安全规则

- 永远不要让 Agent 直接在源项目目录中执行会写代码的任务。
- 写代码前必须先创建 Git worktree。
- 如果选中的项目不是 Git 仓库，必须安全失败。
- 如果源项目存在未提交改动，不要触碰这些改动；从 HEAD 创建 worktree，并记录提醒日志。
- 只允许编辑和删除 `需求池` 中尚未开始的任务。
- 停止任务时必须取消后端 run，并在存在活动子进程时终止该子进程。
- 上传 GitHub 前必须确认 `.gitignore` 生效，不上传依赖、构建产物、日志和本地环境文件。
- 推送远端时不得使用 force push，避免覆盖远端已有提交。
