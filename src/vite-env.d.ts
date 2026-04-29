/// <reference types="vite/client" />

import type { AppState, Project } from "./types";

declare global {
  interface Window {
    deskDashboard?: {
      chooseWorkspace: () => Promise<string | null>;
      scanWorkspace: (rootPath: string) => Promise<Project[]>;
      loadState: () => Promise<AppState>;
      saveState: (state: AppState) => Promise<boolean>;
      openProject: (projectPath: string) => Promise<boolean>;
    };
  }
}
