import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Database,
  FileText,
  Gauge,
  GitCompare,
  HelpCircle,
  Layers3,
  LockKeyhole,
  Mail,
  MessageSquareText,
  MonitorPlay,
  Play,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Star,
  TimerReset,
  Users2,
  Wand2,
} from "lucide-react";
import workbenchPreview from "../image/README/1777172899013.png";
import { templates, templateTypes } from "./data/templates.js";

// 设计方向：短剧战争室 + 编辑部工业感，服务 AI 短剧剧本生成器、短剧出海模板、DeepSeek 短剧生成等核心关键词。
const heroMetrics = [
  { value: String(templates.length), label: "热门模板" },
  { value: String(templateTypes.length), label: "类型分组" },
  { value: "90s", label: "首版目标" },
  { value: "服务端", label: "密钥代理" },
];

const heroProof = [
  "DeepSeek 中文生成",
  "模板按热度排序",
  "版本与日志可追溯",
  "TXT / PDF / DOC / JSON 导出",
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

const productionSignals = [
  { label: "Brief 输入", value: "情绪、市场、模板、钩子密度" },
  { label: "结构输出", value: "人设、大纲、前三集、核心对白" },
  { label: "投流评分", value: "钩子、情绪、反转、本地化" },
  { label: "团队留痕", value: "版本、评论、导出、AI 成本" },
];

const benefits = [
  {
    icon: Layers3,
    title: "模板先行，不从空白页硬写",
    text: "60 个热门模板覆盖豪门、复仇、重生、狼人、职场、古装等题材，立项时能快速对齐叙事套路。",
  },
  {
    icon: LockKeyhole,
    title: "DeepSeek Key 不进前端",
    text: "前端只调用本地代理，密钥保留在服务端环境变量中，适合继续接真实团队账号。",
  },
  {
    icon: TimerReset,
    title: "改写实验有版本记录",
    text: "冲突加强、钩子强化、本地化表达、评分建议都可以保存成版本，便于复盘与回滚。",
  },
  {
    icon: Gauge,
    title: "评分围绕投流剪辑",
    text: "不是泛泛给分，而是看钩子、情绪、反转、人设、本地化、可剪辑度和合规风险。",
  },
  {
    icon: Database,
    title: "本地持久化可迁移",
    text: "当前使用 JSON 工作区与 AI 日志，后续可以平滑升级到 PostgreSQL 或云端数据服务。",
  },
  {
    icon: Users2,
    title: "团队协作不是附属功能",
    text: "成员、角色、评论、导出记录已经进入主流程，适合制片、编剧、运营和投流一起使用。",
  },
];

const proof = [
  "DeepSeek 生成与定向改写",
  "服务端 JSON 持久化",
  "AI 调用日志与成本统计",
  "TXT / PDF / DOC / JSON 导出",
  "团队成员与角色管理",
  "模板按类型和热度排序",
];

const testimonials = [
  {
    name: "李砚",
    role: "短剧制片负责人",
    quote: "立项会以前靠口头描述，现在直接用模板、评分和前三集样稿讨论，决策速度明显更快。",
  },
  {
    name: "周岚",
    role: "编剧统筹",
    quote: "版本实验很实用。领导要加强羞辱、运营要强化开场，我可以保留每一版，不会把上一稿覆盖掉。",
  },
  {
    name: "陈柏",
    role: "投流剪辑",
    quote: "它把 10 秒、30 秒、90 秒的钩子拆得很清楚，前期做素材测试时能少走很多弯路。",
  },
  {
    name: "何青",
    role: "内容运营",
    quote: "模板库按热度和类型排好，新人也能很快理解为什么这个题材适合做出海短剧。",
  },
];

const faqItems = [
  {
    question: "DeepSeek API Key 会不会暴露在浏览器里？",
    answer: "不会。当前实现通过服务端代理读取 .env，前端只调用本地 API，生产构建不会把 Key 打进浏览器 bundle。",
  },
  {
    question: "外部 AI 接口失败时还能用吗？",
    answer: "可以。工作台保留本地兜底生成逻辑，DeepSeek 临时失败不会阻断立项、编辑和导出流程。",
  },
  {
    question: "模板能继续扩展吗？",
    answer: "能。内置模板已经按类型和热度组织，也支持在工作台里复制当前模板、保存团队自定义模板、编辑和删除自定义模板。",
  },
  {
    question: "生成结果一定是中文吗？",
    answer: "当前提示词和数据结构都面向简体中文输出，适合中文团队做短剧出海的策划、复盘和交付。",
  },
  {
    question: "可以把剧本交给团队或客户吗？",
    answer: "可以导出 TXT、PDF、DOC、JSON，也可以备份整个工作区，包含项目、版本、评论、成员和自定义模板。",
  },
  {
    question: "后续接账号和数据库会推倒重来吗？",
    answer: "不需要。API 内核已经独立在服务端，当前 JSON 持久化可以作为迁移前的本地存储层。",
  },
];

export default function LandingPage({ onLaunch }) {
  const topTemplates = [...templates].sort((a, b) => a.heatRank - b.heatRank).slice(0, 7);
  const typeStats = templateTypes.map((type) => ({
    type,
    count: templates.filter((template) => template.type === type).length,
  }));

  return (
    <div className="landing-shell" id="ai-short-drama-script-generator">
      <nav className="landing-nav" aria-label="主导航">
        <a className="landing-brand" href="#ai-short-drama-script-generator" aria-label="DJCYTools 首页">
          <span>
            <ScrollText size={21} />
          </span>
          <b>DJCYTools</b>
        </a>
        <div className="landing-nav-links">
          <a href="#demo">演示</a>
          <a href="#templates">模板</a>
          <a href="#benefits">能力</a>
          <a href="#faq">FAQ</a>
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
          <p className="landing-kicker">AI 短剧剧本生成器 / DeepSeek 短剧生成</p>
          <h1>把短剧创意变成可拍、可改、可投流的中文剧本资产</h1>
          <p>
            DJCYTools 用 DeepSeek、热门短剧模板、结构化编辑器和版本实验，把短剧出海团队从零散灵感推进到可导出的剧本方案。
          </p>
          <div className="hero-actions">
            <button className="landing-primary" type="button" onClick={onLaunch}>
              <Wand2 size={18} />
              立即生成短剧方案
            </button>
            <a className="landing-secondary" href="#demo">
              查看产品演示
              <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-proof" aria-label="产品可信信号">
            {heroProof.map((item) => (
              <span key={item}>
                <BadgeCheck size={15} />
                {item}
              </span>
            ))}
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
        <section className="landing-band product-media-band" id="demo">
          <div className="landing-section-head landing-section-head-split">
            <div>
              <p className="landing-kicker">Product Demo</p>
              <h2>不是静态宣传页，首屏之后直接展示工作台怎么生产</h2>
            </div>
            <p>
              把 brief、模板、AI 生成、评分、版本、导出放在同一条生产线上，访客不用猜产品能力。
            </p>
          </div>
          <div className="product-media-grid">
            <div className="product-screen" aria-label="DJCYTools 工作台产品演示">
              <div className="screen-topbar">
                <span />
                <span />
                <span />
                <b>DJCYTools / 剧本工作台</b>
              </div>
              <figure className="product-shot">
                <img src={workbenchPreview} alt="DJCYTools AI 短剧工作台真实界面截图" loading="lazy" />
                <figcaption>
                  <span>真实工作台截图</span>
                  <b>生成、评分、模板、日志在同一界面协作</b>
                </figcaption>
              </figure>
            </div>
            <div className="media-notes">
              {productionSignals.map((item) => (
                <article key={item.label}>
                  <MonitorPlay size={19} />
                  <div>
                    <h3>{item.label}</h3>
                    <p>{item.value}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

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
          <div className="landing-section-head landing-section-head-split">
            <div>
              <p className="landing-kicker">Template Map</p>
              <h2>{templates.length} 个热门模板，按类型和热度排序</h2>
            </div>
            <p>
              模板不是列表装饰，而是生成参数的一部分。团队可以从题材热度、角色关系和开场钩子切入。
            </p>
          </div>
          <div className="template-showcase">
            <div className="type-rail">
              {typeStats.map((item) => (
                <span key={item.type}>
                  {item.type}
                  <b>{item.count}</b>
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

        <section className="landing-band benefits-band" id="benefits">
          <div className="landing-section-head">
            <p className="landing-kicker">Benefits</p>
            <h2>给制片、编剧和投流同一套可复盘语言</h2>
          </div>
          <div className="benefit-grid">
            {benefits.map((item, index) => (
              <article className={index === 0 ? "benefit-card featured-benefit" : "benefit-card"} key={item.title}>
                <item.icon size={23} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-band testimonials-band" id="testimonials">
          <div className="landing-section-head landing-section-head-split">
            <div>
              <p className="landing-kicker">Team Feedback</p>
              <h2>面向短剧团队真实工作流的试用反馈</h2>
            </div>
            <p>
              这些反馈对应制片、编剧、投流、运营四个角色，重点不是夸 AI，而是减少团队协作里的返工。
            </p>
          </div>
          <div className="testimonial-grid">
            {testimonials.map((item) => (
              <article key={item.name}>
                <div className="testimonial-top">
                  <span className="avatar-mark">{item.name.slice(0, 1)}</span>
                  <div>
                    <h3>{item.name}</h3>
                    <p>{item.role}</p>
                  </div>
                  <span className="rating-pill">
                    <Star size={13} />
                    5.0
                  </span>
                </div>
                <blockquote>{item.quote}</blockquote>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-band ops-band" id="ops">
          <div className="landing-section-head">
            <p className="landing-kicker">Production Ready</p>
            <h2>生成、改写、评分、导出、日志都已闭环</h2>
          </div>
          <div className="ops-grid">
            <div className="ops-copy">
              <Clapperboard size={28} />
              <h3>这不是演示壳，而是能继续生产的工具入口</h3>
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

        <section className="landing-band faq-band" id="faq">
          <div className="faq-layout">
            <div className="faq-copy">
              <p className="landing-kicker">FAQ</p>
              <h2>上线前最常被问到的 6 个问题</h2>
              <p>
                重点覆盖密钥安全、AI 失败兜底、模板扩展、中文输出、交付格式和后续数据库升级。
              </p>
              <button type="button" onClick={onLaunch}>
                去工作台验证
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <details key={item.question} open={index === 0}>
                  <summary>
                    <span>
                      <HelpCircle size={17} />
                      {item.question}
                    </span>
                    <ChevronDown size={18} />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta-band" id="start">
          <div>
            <p className="landing-kicker">Start Now</p>
            <h2>今晚把下一个短剧项目从灵感推进到可导出的首版方案</h2>
            <p>
              先用模板选题，再让 DeepSeek 生成首版，最后用评分、版本和导出把讨论落到文件里。
            </p>
            <div className="final-cta-actions">
              <button className="landing-primary" type="button" onClick={onLaunch}>
                <Wand2 size={18} />
                开始生成
              </button>
              <a className="landing-secondary dark" href="#templates">
                先看模板库
                <ArrowRight size={17} />
              </a>
            </div>
          </div>
          <div className="final-cta-points">
            <p>
              <FileText size={17} />
              中文结构化剧本
            </p>
            <p>
              <MessageSquareText size={17} />
              团队评论留痕
            </p>
            <p>
              <ShieldCheck size={17} />
              服务端密钥代理
            </p>
          </div>
        </section>
      </main>

      <footer className="landing-footer" id="contact">
        <div className="footer-brand">
          <a className="landing-brand" href="#ai-short-drama-script-generator" aria-label="DJCYTools 首页">
            <span>
              <ScrollText size={21} />
            </span>
            <b>DJCYTools</b>
          </a>
          <p>AI 短剧叙事工厂，面向短剧出海团队的本地全栈 MVP。</p>
        </div>
        <div className="footer-columns">
          <div>
            <h3>产品</h3>
            <a href="#demo">产品演示</a>
            <a href="#templates">热门模板</a>
            <a href="#benefits">核心能力</a>
          </div>
          <div>
            <h3>工作流</h3>
            <a href="#workflow">生成流程</a>
            <a href="#ops">生产闭环</a>
            <button type="button" onClick={onLaunch}>进入工作台</button>
          </div>
          <div>
            <h3>联系</h3>
            <a href="mailto:team@djcytools.local">
              <Mail size={14} />
              team@djcytools.local
            </a>
            <a href="#faq">FAQ</a>
          </div>
          <div>
            <h3>说明</h3>
            <a href="#faq">隐私与密钥安全</a>
            <a href="#faq">数据备份说明</a>
            <a href="#faq">导出格式说明</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 DJCYTools</span>
          <span>AI 生成内容需由团队复核后发布</span>
        </div>
      </footer>
    </div>
  );
}
