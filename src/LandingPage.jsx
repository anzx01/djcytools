import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  Gauge,
  GitCompare,
  Play,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { templates, templateTypes } from "./data/templates.js";

const heroMetrics = [
  { value: "30", label: "热门模板" },
  { value: "8", label: "类型分组" },
  { value: "90s", label: "首版目标" },
  { value: "中文", label: "输出语言" },
];

const workflow = [
  {
    icon: Sparkles,
    title: "输入情绪痛点",
    text: "用市场、模板、羞辱强度、反转频率和钩子密度定义生成方向。",
  },
  {
    icon: Wand2,
    title: "生成可拍短剧",
    text: "输出剧名、人设、大纲、前 3 集脚本、投流开场和对白样例。",
  },
  {
    icon: GitCompare,
    title: "版本实验改写",
    text: "基于当前版本定向提高冲突、强化投流钩子或做本地化表达。",
  },
  {
    icon: BarChart3,
    title: "沉淀团队资产",
    text: "保存项目、版本、团队评论、导出记录和 AI 调用成本。",
  },
];

const proof = [
  "DeepSeek 生成与改写",
  "服务端 JSON 持久化",
  "AI 调用日志与成本统计",
  "TXT / PDF / DOC / JSON 导出",
  "团队成员与角色管理",
  "模板按类型和热度排序",
];

export default function LandingPage({ onLaunch }) {
  const topTemplates = templates.slice(0, 7);

  return (
    <div className="landing-shell">
      <nav className="landing-nav">
        <div className="landing-brand">
          <span>
            <ScrollText size={21} />
          </span>
          <b>DJCYTools</b>
        </div>
        <div className="landing-nav-links">
          <a href="#workflow">流程</a>
          <a href="#templates">模板</a>
          <a href="#ops">交付</a>
          <button type="button" onClick={onLaunch}>
            进入工作台
          </button>
        </div>
      </nav>

      <header className="landing-hero">
        <div className="hero-stage" aria-hidden="true">
          <div className="stage-marquee">
            {["复仇", "CEO", "狼人", "契约婚姻", "真假千金", "黑帮替嫁", "带球归来", "职场反杀"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="story-lane lane-one">
            <span>10 秒定调</span>
            <b>她签下离婚协议</b>
            <em>钩子强度 91</em>
          </div>
          <div className="story-lane lane-two">
            <span>30 秒冲突</span>
            <b>所有人当众羞辱她</b>
            <em>反转频率 84</em>
          </div>
          <div className="story-lane lane-three">
            <span>90 秒悬念</span>
            <b>收购方代表叫她董事长</b>
            <em>投流可剪辑 88</em>
          </div>
          <div className="stage-score">
            <Gauge size={20} />
            <strong>87</strong>
            <span>剧本评分</span>
          </div>
          <div className="stage-cut">
            <Play size={18} />
            <span>可直接进入投流测试</span>
          </div>
        </div>

        <div className="hero-copy">
          <p className="landing-kicker">AI 短剧叙事工厂</p>
          <h1>把情绪痛点变成可拍、可改、可复盘的出海短剧方案</h1>
          <p>
            DJCYTools 用 DeepSeek、热门模板、结构化编辑器和版本实验，把短剧团队从零散灵感推进到可导出的剧本资产。
          </p>
          <div className="hero-actions">
            <button className="landing-primary" type="button" onClick={onLaunch}>
              <Wand2 size={18} />
              进入生成工作台
            </button>
            <a className="landing-secondary" href="#templates">
              查看 30 个模板
              <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-metrics">
            {heroMetrics.map((metric) => (
              <div key={metric.label}>
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main>
        <section className="landing-band workflow-band" id="workflow">
          <div className="landing-section-head">
            <p className="landing-kicker">Workflow</p>
            <h2>从 brief 到投流版本，一条线跑完</h2>
          </div>
          <div className="workflow-grid">
            {workflow.map((item) => (
              <article key={item.title}>
                <item.icon size={22} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-band template-band" id="templates">
          <div className="landing-section-head">
            <p className="landing-kicker">Template Map</p>
            <h2>30 个热门模板，按类型和热度排序</h2>
          </div>
          <div className="template-showcase">
            <div className="type-rail">
              {templateTypes.map((type) => (
                <span key={type}>
                  {type}
                  <b>{templates.filter((template) => template.type === type).length}</b>
                </span>
              ))}
            </div>
            <div className="template-rank">
              {topTemplates.map((template) => (
                <article key={template.id}>
                  <span>#{template.heatRank}</span>
                  <div>
                    <h3>{template.name}</h3>
                    <p>{template.hook}</p>
                  </div>
                  <strong>{template.heatScore}</strong>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-band ops-band" id="ops">
          <div className="landing-section-head">
            <p className="landing-kicker">Production Ready</p>
            <h2>不是演示页，是能继续生产的工具入口</h2>
          </div>
          <div className="ops-grid">
            <div className="ops-copy">
              <Clapperboard size={28} />
              <h3>生成、改写、评分、导出、日志都已闭环</h3>
              <p>
                当前版本已经包含服务端工作区、AI 调用记录、团队权限和多格式导出，适合继续接真实账号体系和云数据库。
              </p>
              <button type="button" onClick={onLaunch}>
                打开工作台
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="proof-list">
              {proof.map((item) => (
                <p key={item}>
                  <CheckCircle2 size={17} />
                  {item}
                </p>
              ))}
              <p>
                <ShieldCheck size={17} />
                API Key 仅在服务端代理使用
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
