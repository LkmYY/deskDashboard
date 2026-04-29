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
- 已确认 GitHub 远端 `main` 分支存在提交，上传前必须走合并/追加提交流程，不能强推覆盖。
- `README.md` 已能作为项目入口说明，并链接到本进度文件。
- GitHub 远端已更新到提交 `1bc3b1d`，包含当前 MVP 代码、进度文件和上传污染控制配置。

## 已知问题

- 当前项目目录刚完成 Git 初始化，但完整的 worktree + Codex 执行链路还需要在真实 Git 项目提交后验证。
- in-app browser 自动化仍可能解析到旧 Node 路径，nvm 更新后可能需要重启 Codex。
- Runner 状态目前保存在内存中，应用状态保存在 JSON 中；API 重启后 run 记录不会持久保留。
- 还没有针对验收通过后的 worktree 改动提供合并/应用流程。
- 还没有清理旧 worktree 的 UI。

## 下一步优先级

1. 在真实 Git 项目上验证完整 Runner 流程。
2. 将 run 状态持久化到 `~/.desk-dashboard/state.json` 或 SQLite。
3. 增加 worktree 清理和安全放弃流程。
4. 增加验收后接受、应用、合并改动的流程。
5. 增加更完整的 diff 查看器和变更文件列表。
6. 解析 Codex 执行 transcript，让日志更清晰。
7. 增加非 gpt Agent 的 provider 抽象。
8. 增加任务生命周期和 Runner API 的自动化测试。

## 安全规则

- 永远不要让 Agent 直接在源项目目录中执行会写代码的任务。
- 写代码前必须先创建 Git worktree。
- 如果选中的项目不是 Git 仓库，必须安全失败。
- 如果源项目存在未提交改动，不要触碰这些改动；从 HEAD 创建 worktree，并记录提醒日志。
- 只允许编辑和删除 `需求池` 中尚未开始的任务。
- 停止任务时必须取消后端 run，并在存在活动子进程时终止该子进程。
- 上传 GitHub 前必须确认 `.gitignore` 生效，不上传依赖、构建产物、日志和本地环境文件。
- 推送远端时不得使用 force push，避免覆盖远端已有提交。
