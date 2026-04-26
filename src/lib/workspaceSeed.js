import { defaultBrief } from "../data/templates.js";
import { createProject } from "./generator.js";

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
    settings: {
      persistence: "server-json",
      language: "zh-CN",
    },
  };
}
