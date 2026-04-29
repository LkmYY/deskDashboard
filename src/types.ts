export type TaskStatus = "inbox" | "running" | "review" | "done" | "failed";
export type TaskPriority = "Low" | "Medium" | "High" | "Max";

export interface Project {
  id: string;
  name: string;
  path: string;
  type: string[];
  branch: string;
  dirty: boolean;
  lastCommit: string;
  updatedAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  agent: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
}

export interface TaskLog {
  id: string;
  taskId: string;
  kind: "event" | "agent" | "command" | "change" | "error";
  at: string;
  message: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  projectPath: string;
  worktreePath: string;
  branch: string;
  model: string;
  agent: string;
  status: "running" | "review" | "failed";
  startedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  logs: TaskLog[];
  diffStat: string;
  diff: string;
  error?: string;
}

export interface AppState {
  workspacePath: string;
  tasks: Task[];
  logs: Record<string, TaskLog[]>;
  runs?: Record<string, TaskRun>;
}

export interface DraftTask {
  title: string;
  description: string;
  priority: TaskPriority;
  model: string;
}
