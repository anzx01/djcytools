import { createSeedWorkspace } from "./workspaceSeed";

const STORAGE_KEY = "djcytools.workspace.v1";

export function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedWorkspace();
    return JSON.parse(raw);
  } catch {
    return createSeedWorkspace();
  }
}

export function saveWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}
