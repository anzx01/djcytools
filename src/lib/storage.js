import { createSeedWorkspace } from "./workspaceSeed.js";

const STORAGE_KEY = "djcytools.workspace.v1";

export function normalizeWorkspace(value) {
  const seed = createSeedWorkspace();
  if (!value || !Array.isArray(value.projects) || value.projects.length === 0) return seed;

  const projects = value.projects.filter(Boolean).map((project) => ({
    ...project,
    comments: Array.isArray(project.comments) ? project.comments : [],
    exports: Array.isArray(project.exports) ? project.exports : [],
    versions: Array.isArray(project.versions) ? project.versions : [],
    campaignResults: Array.isArray(project.campaignResults) ? project.campaignResults : [],
  }));
  const activeProjectId = projects.some((project) => project.id === value.activeProjectId)
    ? value.activeProjectId
    : projects[0]?.id || seed.activeProjectId;

  return {
    ...seed,
    ...value,
    projects,
    activeProjectId,
    team: {
      ...seed.team,
      ...(value.team || {}),
      members: Array.isArray(value.team?.members) ? value.team.members : seed.team.members,
    },
    settings: {
      ...seed.settings,
      ...(value.settings || {}),
    },
    customTemplates: Array.isArray(value.customTemplates) ? value.customTemplates : [],
  };
}

export function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedWorkspace();
    return normalizeWorkspace(JSON.parse(raw));
  } catch {
    return createSeedWorkspace();
  }
}

export function saveWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}
