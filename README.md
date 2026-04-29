# deskDashboard

本地项目管理看板 MVP。它会扫描指定工作区下的项目，展示项目状态，并支持创建、发布、执行、验收任务。

## 启动

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

本地 API 默认运行在：

```text
http://127.0.0.1:4177
```

## 当前能力

- 输入本地工作区路径并扫描项目。
- 自动识别 `.git`、`package.json`、`pyproject.toml`、`Cargo.toml`、`go.mod` 等项目。
- 读取 Git 分支、未提交改动、最近提交时间。
- 按需求池、执行中、验收区、已完成、异常展示任务。
- 支持创建、编辑、删除未开始需求。
- 支持发布执行、停止任务、验收归档。
- 支持为 `gpt-*` 模型调用本地 `codex exec`。
- Runner 会先创建 Git worktree 隔离环境，避免污染原项目目录。
- 任务状态和日志保存到 `~/.desk-dashboard/state.json`。
- 右侧展示动态计划、执行日志、worktree 信息和 diff 摘要。

## 后续方向

详见 [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md)。
