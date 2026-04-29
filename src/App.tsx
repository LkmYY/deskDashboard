import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Code2,
  Edit3,
  FolderOpen,
  GitBranch,
  GripVertical,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Loader2,
  MessageSquareText,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  SendHorizontal,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppState, DraftTask, Project, Task, TaskLog, TaskPriority, TaskRun, TaskStatus } from "./types";

type PanelId = "projects" | "board" | "detail";

const initialState: AppState = {
  workspacePath: "",
  tasks: [],
  logs: {}
};

const defaultPanelOrder: PanelId[] = ["projects", "board", "detail"];
const defaultLaneOrder: TaskStatus[] = ["inbox", "running", "review", "done", "failed"];

const api = {
  async chooseWorkspace(currentPath: string) {
    if (window.deskDashboard) return window.deskDashboard.chooseWorkspace();
    return window.prompt("请输入要扫描的工作区路径", currentPath || "D:\\lsProject");
  },
  async scanWorkspace(rootPath: string) {
    if (window.deskDashboard) return window.deskDashboard.scanWorkspace(rootPath);
    const response = await fetch("/api/workspace/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath })
    });
    return (await response.json()) as Project[];
  },
  async loadState() {
    if (window.deskDashboard) return window.deskDashboard.loadState();
    const response = await fetch("/api/state");
    return (await response.json()) as AppState;
  },
  async saveState(state: AppState) {
    if (window.deskDashboard) return window.deskDashboard.saveState(state);
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    return true;
  },
  async openProject(projectPath: string) {
    if (window.deskDashboard) return window.deskDashboard.openProject(projectPath);
    await fetch("/api/project/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath })
    });
    return true;
  },
  async startTaskRun(payload: { taskId: string; projectPath: string; title: string; description: string; model: string }) {
    const response = await fetch("/api/task-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("启动 Runner 失败");
    return (await response.json()) as TaskRun;
  },
  async getTaskRun(runId: string) {
    const response = await fetch(`/api/task-runs/${encodeURIComponent(runId)}`);
    if (!response.ok) throw new Error("读取 Runner 状态失败");
    return (await response.json()) as TaskRun;
  },
  async cancelTaskRun(runId: string) {
    const response = await fetch(`/api/task-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    if (!response.ok) throw new Error("停止 Runner 失败");
    return (await response.json()) as TaskRun;
  }
};

const statusMeta: Record<TaskStatus, { label: string; hint: string; icon: typeof Inbox }> = {
  inbox: { label: "需求池", hint: "可编辑、可删除、待发布", icon: Inbox },
  running: { label: "执行中", hint: "Agent 正在处理", icon: Loader2 },
  review: { label: "验收区", hint: "看 diff、跑验证、决定合并", icon: ListChecks },
  done: { label: "已完成", hint: "已归档的结果", icon: CheckCircle2 },
  failed: { label: "异常", hint: "需要人工介入", icon: AlertCircle }
};

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isGptModel(model: string) {
  return model.toLowerCase().startsWith("gpt-");
}

function agentForModel(model: string) {
  return isGptModel(model) ? "codex-cli" : "local-runner";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatElapsed(ms?: number) {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function createLog(taskId: string, kind: TaskLog["kind"], message: string): TaskLog {
  return {
    id: uid("log"),
    taskId,
    kind,
    at: nowIso(),
    message
  };
}

function loadOrder<T extends string>(key: string, fallback: T[]) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]") as T[];
    const valid = saved.filter((item) => fallback.includes(item));
    const missing = fallback.filter((item) => !valid.includes(item));
    return valid.length ? [...valid, ...missing] : fallback;
  } catch {
    return fallback;
  }
}

function moveItem<T>(items: T[], source: T, target: T) {
  const next = [...items];
  const from = next.indexOf(source);
  const to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

function getTaskPlan(task?: Task, project?: Project, run?: TaskRun) {
  if (!task) return ["选择一个任务后，这里会显示对应计划。"];

  const plan = [
    project ? `确认项目：${project.name}` : "等待选择项目上下文",
    task.status === "inbox" ? "需求仍在池中，可先编辑标题、描述、模型和优先级。" : "任务已发布，进入执行链路。",
    isGptModel(task.model)
      ? `使用本地 Codex CLI：codex exec -C <worktree> -m ${task.model}`
      : `当前模型 ${task.model} 暂未接入自动编码 Agent，仅执行隔离与验证流程。`,
    "创建 git worktree 隔离环境，避免污染原项目目录。",
    "执行 Agent 或验证命令后收集 git diff，进入人工验收。"
  ];

  if (run?.status === "failed") {
    plan.push(`最近一次失败原因：${run.error || run.logs.at(-1)?.message || "未知错误"}`);
  }

  if (run?.worktreePath) {
    plan.push(`隔离目录：${run.worktreePath}`);
  }

  return plan;
}

function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [editingTaskId, setEditingTaskId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [draggedLane, setDraggedLane] = useState<TaskStatus | null>(null);
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(() => loadOrder("desk.panelOrder", defaultPanelOrder));
  const [laneOrder, setLaneOrder] = useState<TaskStatus[]>(() => loadOrder("desk.laneOrder", defaultLaneOrder));
  const [draft, setDraft] = useState<DraftTask>({
    title: "",
    description: "",
    priority: "High",
    model: "gpt-5.4-codex"
  });

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId);
  const selectedLogs = selectedTask ? state.logs[selectedTask.id] || [] : [];
  const selectedRun = selectedTask ? state.runs?.[selectedTask.id] : undefined;
  const taskPlan = getTaskPlan(selectedTask, selectedProject, selectedRun);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(normalized));
  }, [projects, query]);

  const projectTasks = useMemo(() => {
    if (!selectedProject) return [];
    return state.tasks.filter((task) => task.projectId === selectedProject.id);
  }, [selectedProject, state.tasks]);

  const taskCounts = useMemo(() => {
    return defaultLaneOrder.reduce(
      (acc, status) => {
        acc[status] = projectTasks.filter((task) => task.status === status).length;
        return acc;
      },
      {} as Record<TaskStatus, number>
    );
  }, [projectTasks]);

  const workspaceColumns = panelOrder
    .map((panel) =>
      panel === "board" ? "minmax(620px, 1.45fr)" : panel === "detail" ? "minmax(360px, .86fr)" : "minmax(280px, .62fr)"
    )
    .join(" ");

  useEffect(() => {
    api
      .loadState()
      .then((stored) => {
        setState({ ...initialState, ...stored });
        if (stored.workspacePath) {
          scan(stored.workspacePath);
        }
      })
      .finally(() => setStateLoaded(true))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!stateLoaded) return;
    api.saveState(state).catch(() => undefined);
  }, [state, stateLoaded]);

  useEffect(() => {
    localStorage.setItem("desk.panelOrder", JSON.stringify(panelOrder));
  }, [panelOrder]);

  useEffect(() => {
    localStorage.setItem("desk.laneOrder", JSON.stringify(laneOrder));
  }, [laneOrder]);

  useEffect(() => {
    if (projects.length && !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
      return;
    }

    if (!projects.length) {
      setSelectedProjectId("");
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedTaskId && projectTasks.length) {
      setSelectedTaskId(projectTasks[0].id);
    }
  }, [projectTasks, selectedTaskId]);

  async function scan(rootPath = state.workspacePath) {
    if (!rootPath) return;
    setIsScanning(true);
    try {
      const scanned = await api.scanWorkspace(rootPath);
      setProjects(scanned);
      setState((current) => ({ ...current, workspacePath: rootPath }));
    } finally {
      setIsScanning(false);
    }
  }

  async function chooseWorkspace() {
    const picked = await api.chooseWorkspace(state.workspacePath);
    if (!picked) return;
    await scan(picked);
  }

  function clearDraft(model = draft.model) {
    setDraft({ title: "", description: "", priority: "High", model });
    setEditingTaskId("");
  }

  function createTask(status: TaskStatus = "inbox") {
    if (!selectedProject || !draft.title.trim()) return;

    if (editingTaskId) {
      saveEditedTask(status);
      return;
    }

    const task: Task = {
      id: uid("task"),
      projectId: selectedProject.id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      status,
      priority: draft.priority,
      agent: agentForModel(draft.model),
      model: draft.model,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    setState((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      logs: {
        ...current.logs,
        [task.id]: [createLog(task.id, "event", "需求已创建，等待发布执行")]
      }
    }));
    setSelectedTaskId(task.id);
    clearDraft(draft.model);

    if (status === "running") {
      setTimeout(() => runTask(task.id, task), 200);
    }
  }

  function editTask(task: Task) {
    if (task.status !== "inbox") return;
    setEditingTaskId(task.id);
    setSelectedTaskId(task.id);
    setDraft({
      title: task.title,
      description: task.description,
      priority: task.priority,
      model: task.model
    });
  }

  function saveEditedTask(nextStatus: TaskStatus = "inbox") {
    if (!editingTaskId || !draft.title.trim()) return;
    const originalTask = state.tasks.find((task) => task.id === editingTaskId);
    if (!originalTask || originalTask.status !== "inbox") return;

    const editedTask: Task = {
      ...originalTask,
      title: draft.title.trim(),
      description: draft.description.trim(),
      priority: draft.priority,
      model: draft.model,
      agent: agentForModel(draft.model),
      status: nextStatus,
      updatedAt: nowIso()
    };

    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === editingTaskId ? editedTask : task)),
      logs: {
        ...current.logs,
        [editingTaskId]: [...(current.logs[editingTaskId] || []), createLog(editingTaskId, "event", "需求已更新")]
      }
    }));

    clearDraft(draft.model);

    if (nextStatus === "running") {
      setTimeout(() => runTask(editedTask.id, editedTask), 200);
    }
  }

  function deleteTask(taskId: string) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "inbox") return;
    if (!window.confirm("删除这个未开始需求？这个操作只会删除看板记录，不会删除项目文件。")) return;

    setState((current) => {
      const logs = { ...current.logs };
      const runs = { ...(current.runs || {}) };
      delete logs[taskId];
      delete runs[taskId];
      return {
        ...current,
        tasks: current.tasks.filter((item) => item.id !== taskId),
        logs,
        runs
      };
    });

    if (selectedTaskId === taskId) setSelectedTaskId("");
    if (editingTaskId === taskId) clearDraft();
  }

  function appendLog(taskId: string, log: TaskLog) {
    setState((current) => ({
      ...current,
      logs: {
        ...current.logs,
        [taskId]: [...(current.logs[taskId] || []), log]
      }
    }));
  }

  function updateTask(taskId: string, patch: Partial<Task>) {
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, ...patch, updatedAt: nowIso() } : task))
    }));
  }

  async function runTask(taskId: string, fallbackTask?: Task) {
    const task = state.tasks.find((item) => item.id === taskId) || fallbackTask;
    const project = task ? projects.find((item) => item.id === task.projectId) || selectedProject : undefined;

    if (!task || !project) {
      appendLog(taskId, createLog(taskId, "error", "无法找到任务或项目上下文"));
      return;
    }

    updateTask(taskId, { status: "running", finishedAt: undefined, elapsedMs: undefined });
    appendLog(taskId, createLog(taskId, "event", isGptModel(task.model) ? "已提交给本地 Codex CLI Runner" : "已提交给本地验证 Runner"));

    try {
      const run = await api.startTaskRun({
        taskId,
        projectPath: project.path,
        title: task.title,
        description: task.description,
        model: task.model
      });

      setState((current) => ({
        ...current,
        runs: { ...(current.runs || {}), [taskId]: run },
        logs: { ...current.logs, [taskId]: [...(current.logs[taskId] || []), ...run.logs] }
      }));

      pollTaskRun(taskId, run.id);
    } catch (error) {
      updateTask(taskId, { status: "failed", finishedAt: nowIso() });
      appendLog(taskId, createLog(taskId, "error", error instanceof Error ? error.message : "Runner 启动失败"));
    }
  }

  function pollTaskRun(taskId: string, runId: string) {
    const timer = window.setInterval(async () => {
      try {
        const run = await api.getTaskRun(runId);
        setState((current) => ({
          ...current,
          runs: { ...(current.runs || {}), [taskId]: run },
          logs: { ...current.logs, [taskId]: run.logs }
        }));

        if (run.status !== "running") {
          window.clearInterval(timer);
          updateTask(taskId, {
            status: run.status,
            finishedAt: run.finishedAt || nowIso(),
            elapsedMs: run.elapsedMs
          });
        }
      } catch (error) {
        window.clearInterval(timer);
        updateTask(taskId, { status: "failed", finishedAt: nowIso() });
        appendLog(taskId, createLog(taskId, "error", error instanceof Error ? error.message : "Runner 轮询失败"));
      }
    }, 900);
  }

  async function stopTask(taskId: string) {
    const run = state.runs?.[taskId];
    if (run?.status === "running") {
      try {
        const cancelled = await api.cancelTaskRun(run.id);
        setState((current) => ({
          ...current,
          runs: { ...(current.runs || {}), [taskId]: cancelled },
          logs: { ...current.logs, [taskId]: cancelled.logs }
        }));
      } catch (error) {
        appendLog(taskId, createLog(taskId, "error", error instanceof Error ? error.message : "停止 Runner 失败"));
      }
    }

    updateTask(taskId, { status: "failed", finishedAt: nowIso() });
    appendLog(taskId, createLog(taskId, "error", "任务已手动停止，等待重新规划"));
  }

  function finishTask(taskId: string) {
    updateTask(taskId, { status: "done", finishedAt: nowIso() });
    appendLog(taskId, createLog(taskId, "event", "验收通过，任务已归档"));
  }

  function onPanelDrop(target: PanelId) {
    if (!draggedPanel) return;
    setPanelOrder((current) => moveItem(current, draggedPanel, target));
    setDraggedPanel(null);
  }

  function onLaneDrop(target: TaskStatus) {
    if (!draggedLane) return;
    setLaneOrder((current) => moveItem(current, draggedLane, target));
    setDraggedLane(null);
  }

  function renderPanelChrome(id: PanelId, title: string, subtitle: string, icon: ReactNode, content: ReactNode) {
    return (
      <section
        key={id}
        className={`desk-panel panel-${id} ${draggedPanel === id ? "is-dragging" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => onPanelDrop(id)}
        onDragEnd={() => setDraggedPanel(null)}
      >
        <div className="panel-bar">
          <div className="panel-title">
            <span className="panel-icon">{icon}</span>
            <div>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          <button
            className="drag-handle"
            title="拖拽面板换位置"
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              setDraggedPanel(id);
            }}
          >
            <GripVertical size={18} />
          </button>
        </div>
        {content}
      </section>
    );
  }

  function renderTask(task: Task) {
    const isActive = selectedTaskId === task.id;
    return (
      <article className={`task-card ${isActive ? "task-card-active" : ""}`} key={task.id} onClick={() => setSelectedTaskId(task.id)}>
        <div className="task-card-top">
          <Sparkles size={15} />
          <strong>{task.title}</strong>
        </div>
        <p>{task.description || "暂无补充描述"}</p>
        <div className="task-meta">
          <span className={`status-pill status-${task.status}`}>{statusMeta[task.status].label}</span>
          <span className="model-pill">{task.model}</span>
          <span className={`priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
        </div>
        <div className="task-actions">
          {task.status === "inbox" && (
            <>
              <button onClick={(event) => (event.stopPropagation(), runTask(task.id))}>发布</button>
              <button onClick={(event) => (event.stopPropagation(), editTask(task))}>
                <Edit3 size={13} />
                修改
              </button>
              <button className="danger-text" onClick={(event) => (event.stopPropagation(), deleteTask(task.id))}>
                <Trash2 size={13} />
                删除
              </button>
            </>
          )}
          {task.status === "running" && (
            <button className="danger-text" onClick={(event) => (event.stopPropagation(), stopTask(task.id))}>
              停止
            </button>
          )}
          {task.status === "review" && <button onClick={(event) => (event.stopPropagation(), finishTask(task.id))}>验收</button>}
          <span>{formatTime(task.updatedAt)}</span>
        </div>
      </article>
    );
  }

  const projectsPanel = renderPanelChrome(
    "projects",
    "项目导航",
    `${filteredProjects.length} 个项目 / 点击切换上下文`,
    <FolderOpen size={18} />,
    <div className="panel-body project-panel-body">
      <div className="search-box">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名或路径" />
      </div>

      <div className="project-list">
        {filteredProjects.map((project) => (
          <button
            key={project.id}
            className={`project-row ${selectedProjectId === project.id ? "project-row-active" : ""}`}
            onClick={() => {
              setSelectedProjectId(project.id);
              setSelectedTaskId("");
            }}
          >
            <span className="project-mark">{project.name.slice(0, 2).toUpperCase()}</span>
            <span className="project-copy">
              <strong>{project.name}</strong>
              <small>{project.path}</small>
            </span>
            <span className={project.dirty ? "dot dot-hot" : "dot"} />
          </button>
        ))}
        {!filteredProjects.length && <div className="empty-lane">请选择工作区并扫描项目</div>}
      </div>
    </div>
  );

  const boardPanel = renderPanelChrome(
    "board",
    selectedProject?.name || "任务工作台",
    selectedProject?.path || "先选择一个真实项目，避免任务跑到不存在的路径",
    <LayoutDashboard size={18} />,
    <div className="panel-body board-body">
      <div className="context-strip">
        <div className="summary-tags">
          <span>
            <GitBranch size={15} />
            {selectedProject?.branch || "no git"}
          </span>
          <span className={selectedProject?.dirty ? "dirty" : ""}>{selectedProject?.dirty ? "有未提交改动" : "工作区干净"}</span>
          {selectedProject?.type.map((type) => <span key={type}>{type}</span>)}
        </div>
        {selectedProject && (
          <button className="open-path-button" onClick={() => api.openProject(selectedProject.path)}>
            打开目录
          </button>
        )}
      </div>

      <div className="kanban">
        {laneOrder.map((status) => {
          const Icon = statusMeta[status].icon;
          const tasks = projectTasks.filter((task) => task.status === status);
          return (
            <section
              className={`lane lane-${status} ${draggedLane === status ? "is-dragging" : ""}`}
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.stopPropagation();
                onLaneDrop(status);
              }}
              onDragEnd={() => setDraggedLane(null)}
            >
              <div
                className="lane-header"
                draggable
                onDragStart={(event) => {
                  event.stopPropagation();
                  setDraggedLane(status);
                }}
              >
                <div>
                  <h3>
                    <Icon size={17} className={status === "running" ? "spin-soft" : ""} />
                    {statusMeta[status].label}
                    <b>{taskCounts[status]}</b>
                  </h3>
                  <p>{statusMeta[status].hint}</p>
                </div>
                <GripVertical size={17} />
              </div>
              <div className="lane-body">{tasks.length ? tasks.map(renderTask) : <div className="empty-lane">暂无任务</div>}</div>
            </section>
          );
        })}
      </div>

      <div className="prompt-dock">
        <div className={`prompt-shell ${editingTaskId ? "prompt-editing" : ""}`}>
          <div className="prompt-ribbon">
            <span>
              <MessageSquareText size={16} />
              {editingTaskId ? "修改需求" : "给 Agent 下达新需求"}
            </span>
            <small>{selectedProject?.name || "未选择项目"}</small>
          </div>
          <div className="prompt-title-row">
            <input
              className="prompt-title-field"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="一句话说清要做什么，例如：把任务详情页改成可折叠日志抽屉"
              disabled={!selectedProject}
            />
          </div>
          <div className="prompt-main">
            <textarea
              className="prompt-textarea"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="补充目标、边界、验收标准、不要动的模块。这里可以写长一点。"
              disabled={!selectedProject}
            />
            <div className="prompt-controls">
              <label>
                <SlidersHorizontal size={14} />
                优先级
                <select
                  value={draft.priority}
                  onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as TaskPriority }))}
                  disabled={!selectedProject}
                >
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                  <option>Max</option>
                </select>
              </label>
              <label>
                <Bot size={14} />
                模型
                <select
                  value={draft.model}
                  onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                  disabled={!selectedProject}
                >
                  <option>gpt-5.4-codex</option>
                  <option>gpt-5.5</option>
                  <option>claude-opus-4.7</option>
                </select>
              </label>
              <div className="prompt-actions">
                {editingTaskId && (
                  <button className="secondary-button" onClick={() => clearDraft()} type="button">
                    <X size={16} />
                    取消
                  </button>
                )}
                <button className="secondary-button" onClick={() => createTask("inbox")} disabled={!selectedProject || !draft.title.trim()}>
                  <Plus size={16} />
                  {editingTaskId ? "保存修改" : "先放入池"}
                </button>
                <button className="primary-button send-button" onClick={() => createTask("running")} disabled={!selectedProject || !draft.title.trim()}>
                  <SendHorizontal size={16} />
                  {editingTaskId ? "保存并执行" : "发布执行"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const detailPanel = renderPanelChrome(
    "detail",
    "执行详情",
    selectedTask ? `${statusMeta[selectedTask.status].label} / ${selectedTask.model}` : "选择任务后查看计划和日志",
    <PanelRightOpen size={18} />,
    <div className="panel-body detail-body">
      {selectedTask ? (
        <>
          <div className="detail-head">
            <div>
              <span className={`status-pill status-${selectedTask.status}`}>{statusMeta[selectedTask.status].label}</span>
              <h2>{selectedTask.title}</h2>
              <p>{selectedTask.description || "没有补充描述"}</p>
            </div>
            <div className="detail-actions">
              {selectedTask.status === "inbox" && (
                <>
                  <button className="icon-button" title="修改需求" onClick={() => editTask(selectedTask)}>
                    <Edit3 size={18} />
                  </button>
                  <button className="icon-button danger" title="删除需求" onClick={() => deleteTask(selectedTask.id)}>
                    <Trash2 size={18} />
                  </button>
                </>
              )}
              {selectedTask.status !== "running" ? (
                <button className="icon-button" title="发布执行" onClick={() => runTask(selectedTask.id)}>
                  <Play size={18} />
                </button>
              ) : (
                <button className="icon-button danger" title="停止任务" onClick={() => stopTask(selectedTask.id)}>
                  <Square size={18} />
                </button>
              )}
              {selectedTask.status === "review" && (
                <button className="primary-button" onClick={() => finishTask(selectedTask.id)}>
                  <CheckCircle2 size={17} />
                  验收
                </button>
              )}
            </div>
          </div>

          <div className="run-facts">
            <span>
              <Bot size={15} />
              {selectedTask.agent}
            </span>
            <span>
              <Code2 size={15} />
              {selectedTask.model}
            </span>
            <span>
              <Clock3 size={15} />
              {formatElapsed(selectedTask.elapsedMs) || "未完成"}
            </span>
          </div>

          {selectedRun && (
            <section className="run-panel">
              <h3>隔离执行环境</h3>
              <dl>
                <div>
                  <dt>状态</dt>
                  <dd>{selectedRun.status}</dd>
                </div>
                <div>
                  <dt>分支</dt>
                  <dd>{selectedRun.branch || "创建中"}</dd>
                </div>
                <div>
                  <dt>Worktree</dt>
                  <dd>{selectedRun.worktreePath || "创建中"}</dd>
                </div>
              </dl>
            </section>
          )}

          {selectedRun?.diagnostics?.codex && (
            <section className={`diagnostic-panel ${selectedRun.status === "failed" ? "is-warning" : ""}`}>
              <h3>
                <AlertCircle size={16} />
                Runner 自检
              </h3>
              <dl>
                <div>
                  <dt>Codex</dt>
                  <dd>{selectedRun.diagnostics.codex.version || "版本未知"}</dd>
                </div>
                <div>
                  <dt>路径</dt>
                  <dd>{selectedRun.diagnostics.codex.paths.join(" | ") || "未检测到"}</dd>
                </div>
                {selectedRun.diagnostics.codex.warnings.length > 0 && (
                  <div>
                    <dt>提醒</dt>
                    <dd>{selectedRun.diagnostics.codex.warnings.join("；")}</dd>
                  </div>
                )}
                {selectedRun.diagnostics.codexFailure && (
                  <>
                    <div>
                      <dt>原因</dt>
                      <dd>{selectedRun.diagnostics.codexFailure.summary}</dd>
                    </div>
                    <div>
                      <dt>处理</dt>
                      <dd>{selectedRun.diagnostics.codexFailure.action}</dd>
                    </div>
                  </>
                )}
                {selectedRun.diagnostics.build?.skipped && (
                  <div>
                    <dt>构建</dt>
                    <dd>{selectedRun.diagnostics.build.reason}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <section className="plan-panel">
            <h3>计划方案</h3>
            <ol>
              {taskPlan.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>

          <section className="log-panel">
            <h3>任务消息中心</h3>
            <div className="logs">
              {selectedLogs.map((log) => (
                <div className={`log-row log-${log.kind}`} key={log.id}>
                  <span>{formatTime(log.at)}</span>
                  <p>{log.message}</p>
                </div>
              ))}
            </div>
          </section>

          {selectedRun && (
            <section className="diff-panel">
              <h3>文件改动</h3>
              <pre>{selectedRun.diffStat || selectedRun.diff || "暂未检测到文件改动"}</pre>
            </section>
          )}
        </>
      ) : (
        <div className="empty-detail">
          <TerminalSquare size={38} />
          <h2>选择一个任务</h2>
          <p>这里会显示计划、日志、验证结果和文件改动。</p>
        </div>
      )}
    </div>
  );

  const panels: Record<PanelId, ReactNode> = {
    projects: projectsPanel,
    board: boardPanel,
    detail: detailPanel
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-badge">DD</div>
          <div>
            <h1>Desk Dashboard</h1>
            <span>{state.workspacePath || "请选择本地工作区"}</span>
          </div>
        </div>
        <div className="metric-strip">
          <span>{projects.length} 项目</span>
          <span>{projectTasks.length} 任务</span>
          <span>{taskCounts.running} 执行中</span>
        </div>
        <div className="toolbar">
          <button className="icon-button" title="重新扫描" onClick={() => scan()} disabled={isScanning || !state.workspacePath}>
            <RefreshCw size={18} className={isScanning ? "spin" : ""} />
          </button>
          <button className="icon-button" title="设置">
            <Settings size={18} />
          </button>
          <button className="primary-button" onClick={chooseWorkspace}>
            <FolderOpen size={18} />
            选择工作区
          </button>
        </div>
      </header>

      <section className="workbench" style={{ gridTemplateColumns: workspaceColumns }}>
        {panelOrder.map((panel) => panels[panel])}
      </section>
    </main>
  );
}

export default App;
