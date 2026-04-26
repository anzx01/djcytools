import { createProject } from "./generator";
import { defaultBrief } from "../data/templates";

const STORAGE_KEY = "djcytools.workspace.v1";

export function createSeedWorkspace() {
  const firstProject = createProject({
    brief: {
      ...defaultBrief,
      title: "当众离婚后，她成了收购方",
      painPoint: "女主被丈夫和家族当众否定价值，离开后用隐藏身份完成反击。",
    },
    params: undefined,
  });

  return {
    activeProjectId: firstProject.id,
    projects: [firstProject],
    team: {
      name: "出海短剧实验室",
      members: [
        { name: "编剧", role: "所有者" },
        { name: "制片", role: "编辑者" },
        { name: "投流", role: "查看者" },
      ],
    },
  };
}

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
