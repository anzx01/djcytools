import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Database,
  FileText,
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
import { useEffect, useState } from "react";
import workbenchPreview from "../image/README/1777172899013.png";
import { templates, templateTypes } from "./data/templates.js";

// 设计方向：短剧战争室 + 编辑部工业感，服务 AI 短剧剧本生成器、短剧出海模板、DeepSeek 剧本生成和 Seedance 真实视频等核心关键词。
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
    icon: TimerReset,
    title: "定向改写",
    text: "基于当前剧本提高冲突、强化投流钩子或做本地化表达。",
  },
  {
    icon: BarChart3,
    title: "沉淀个人资产",
    text: "保存项目、版本、创作备注、导出记录和 AI 调用成本。",
  },
];

const productionSignals = [
  { label: "Brief 输入", value: "情绪、市场、模板、钩子密度" },
  { label: "结构输出", value: "人设、大纲、前三集、核心对白" },
  { label: "成片准备", value: "分镜、提示词、真实视频" },
  { label: "创作留痕", value: "版本、备注、导出、AI 成本" },
];

const benefits = [
  {
    icon: Layers3,
    title: "模板先行，不从空白页硬写",
    text: "120 个热门模板覆盖豪门、复仇、重生、狼人、职场、古装等题材，立项时能快速对齐叙事套路。",
  },
  {
    icon: LockKeyhole,
    title: "模型 Key 不进前端",
    text: "前端只调用本地代理，DeepSeek 和 Seedance 密钥保留在服务端环境变量中。",
  },
  {
    icon: TimerReset,
    title: "每次改写都能回到上一稿",
    text: "冲突加强、钩子强化、本地化表达都可以保存记录，便于继续打磨。",
  },
  {
    icon: Clapperboard,
    title: "剧本直接衔接真实视频",
    text: "结构化剧本内置分镜提示，生成后可直接进入 Seedance 真实视频流程。",
  },
  {
    icon: Database,
    title: "本地持久化可迁移",
    text: "当前使用 SQLite 拆表保存账号、项目、版本、投流、审计和日志，并提供 PostgreSQL 迁移预案。",
  },
  {
    icon: Users2,
    title: "一人公司也能持续生产",
    text: "项目、备注、导出记录和成本日志都在本地闭环，不需要搭复杂协作系统。",
  },
];

const proof = [
  "DeepSeek 生成与定向改写",
  "Seedance 真实视频生成",
  "SQLite 持久化与审计",
  "AI 调用日志与成本统计",
  "TXT / PDF / DOC / JSON 导出",
  "120 个短剧模板",
  "结构化剧本与分镜建议",
];

const testimonials = [
  {
    name: "李砚",
    role: "短剧项目主理人",
    quote: "以前一个创意要拆很久，现在先用模板和前三集样稿定方向，效率明显更快。",
  },
  {
    name: "周岚",
    role: "编剧统筹",
    quote: "定向改写很实用。想加强羞辱或强化开场时，可以直接让当前稿继续往目标方向收敛。",
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
    question: "DeepSeek 和 Doubao / 火山方舟 API Key 会不会暴露在浏览器里？",
    answer: "不会。当前实现通过服务端代理读取 .env，前端只调用本地 API，生产构建不会把 Key 打进浏览器 bundle。",
  },
  {
    question: "外部 AI 接口失败时还能用吗？",
    answer: "可以。工作台保留本地兜底生成逻辑，DeepSeek 或 Doubao-Seed-2.0 临时失败不会阻断立项、编辑和导出流程。",
  },
  {
    question: "模板能继续扩展吗？",
    answer: "能。内置模板已经按类型和热度组织，这次已扩展到 120 个，后续继续追加也只需要维护模板数据。",
  },
  {
    question: "生成结果一定是中文吗？",
    answer: "当前提示词和数据结构都面向简体中文输出，适合个人创作者做短剧出海选题、剧本和视频生成。",
  },
  {
    question: "生成后可以拿到文件吗？",
    answer: "可以导出 TXT、PDF、DOC、JSON，也可以直接在工作台继续生成真实视频。",
  },
  {
    question: "后续接账号和数据库会推倒重来吗？",
    answer: "不需要。API 内核已经独立在服务端，当前 SQLite 拆表覆盖账号、团队、项目和审计，多实例上线时可按迁移预案切换 PostgreSQL。",
  },
];

const landingModules = [
  { id: "workflow", label: "生产流程", eyebrow: "Workflow", title: "从 brief 到真实视频，一条线跑完" },
  { id: "templates", label: "模板库", eyebrow: "Template Map", title: `${templates.length} 个热门模板，按类型和热度排序` },
  { id: "benefits", label: "核心能力", eyebrow: "Benefits", title: "给一人公司一条可复用的生产线" },
  { id: "feedback", label: "创作者反馈", eyebrow: "Creator Feedback", title: "面向个人短剧工作流的试用反馈" },
  { id: "ops", label: "上线准备", eyebrow: "Production Ready", title: "生成、改写、真实视频、导出、日志都已闭环" },
  { id: "faq", label: "FAQ", eyebrow: "FAQ", title: "上线前最常被问到的 6 个问题" },
];

export default function LandingPage({ onLaunch }) {
  const [activeModule, setActiveModule] = useState("workflow");
  const [generatedVideos, setGeneratedVideos] = useState([]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const topTemplates = [...templates].sort((a, b) => a.heatRank - b.heatRank).slice(0, 7);
  const typeStats = templateTypes.map((type) => ({
    type,
    count: templates.filter((template) => template.type === type).length,
  }));
  const activeModuleMeta = landingModules.find((item) => item.id === activeModule) || landingModules[0];
  const activeVideo = generatedVideos[activeVideoIndex] || generatedVideos[0] || null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/showcase/generated-videos", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : { videos: [] }))
      .then((data) => {
        if (cancelled) return;
        const videos = Array.isArray(data.videos) ? data.videos.filter((video) => video.localVideoUrl) : [];
        setGeneratedVideos(videos);
        setActiveVideoIndex(0);
      })
      .catch(() => {
        if (!cancelled) setGeneratedVideos([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (generatedVideos.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveVideoIndex((index) => (index + 1) % generatedVideos.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [generatedVideos.length]);

  function openModule(moduleId) {
    setActiveModule(moduleId);
    window.setTimeout(() => {
      document.getElementById("modules")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

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
          <button className="nav-tab-link" type="button" onClick={() => openModule("templates")}>模板</button>
          <button className="nav-tab-link" type="button" onClick={() => openModule("benefits")}>能力</button>
          <button className="nav-tab-link" type="button" onClick={() => openModule("faq")}>FAQ</button>
          <button type="button" onClick={onLaunch}>
            进入工作台
          </button>
        </div>
      </nav>

      <header className="landing-hero video-hero">
        <div className="hero-copy">
          <p className="landing-kicker">AI 短剧剧本生成器 / DeepSeek 剧本 + Seedance 真实视频</p>
          <h1>一人公司也能把短剧创意生成剧本和真实视频</h1>
          <p>
            DJCYTools 用 DeepSeek 写中文短剧，用 Seedance 生成真实视频，把“复仇、逆袭、职场反杀”这类创意直接推进到可剪、可改、可投流的成片工作流。
          </p>
          <div className="hero-actions">
            <button className="landing-primary" type="button" onClick={onLaunch}>
              <Wand2 size={18} />
              进入生成工作台
            </button>
            <a className="landing-secondary" href="#demo">
              查看产品演示
              <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-trust-line" aria-label="产品可信信号">
            <span>{templates.length} 个热门模板</span>
            <span>{generatedVideos.length || 0} 条真实成片</span>
            <span>API Key 服务端代理</span>
          </div>
        </div>
        <HeroVideoCarousel
          activeVideo={activeVideo}
          activeVideoIndex={activeVideoIndex}
          videos={generatedVideos}
          onLaunch={onLaunch}
          onSelectVideo={setActiveVideoIndex}
        />
      </header>

      <main>
        <section className="landing-band product-media-band" id="demo">
          <div className="landing-section-head landing-section-head-split">
            <div>
              <p className="landing-kicker">Product Demo</p>
              <h2>不是静态宣传页，首屏之后直接展示工作台怎么生产</h2>
            </div>
            <p>
              把 brief、模板、AI 生成、结构化编辑、真实视频和导出放在同一条生产线上，打开就能看懂怎么产出。
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
                  <b>生成、结构化剧本、真实视频、导出在同一界面完成</b>
                </figcaption>
              </figure>
            </div>
            <div className="product-side-rail">
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
          </div>
        </section>

        <section className="landing-band module-band" id="modules">
          <div className="landing-section-head landing-section-head-split">
            <div>
              <p className="landing-kicker">{activeModuleMeta.eyebrow}</p>
              <h2>{activeModuleMeta.title}</h2>
            </div>
            <p>
              首页只保留核心动线，其余信息按模块切换查看。想看模板、能力、上线准备或 FAQ，不需要一路滚到底。
            </p>
          </div>

          <div className="landing-module-tabs" role="tablist" aria-label="首页信息模块">
            {landingModules.map((item) => (
              <button
                aria-controls={`landing-panel-${item.id}`}
                aria-selected={activeModule === item.id}
                className={activeModule === item.id ? "active" : ""}
                id={`landing-tab-${item.id}`}
                key={item.id}
                role="tab"
                type="button"
                onClick={() => setActiveModule(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            aria-labelledby={`landing-tab-${activeModule}`}
            className={`landing-module-panel ${activeModule}`}
            id={`landing-panel-${activeModule}`}
            role="tabpanel"
          >
            {activeModule === "workflow" && (
              <div className="workflow-grid">
                {workflow.map((item) => (
                  <article key={item.title}>
                    <item.icon size={22} />
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </article>
                ))}
              </div>
            )}

            {activeModule === "templates" && (
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
            )}

            {activeModule === "benefits" && (
              <div className="benefit-grid">
                {benefits.map((item, index) => (
                  <article className={index === 0 ? "benefit-card featured-benefit" : "benefit-card"} key={item.title}>
                    <item.icon size={23} />
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </article>
                ))}
              </div>
            )}

            {activeModule === "feedback" && (
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
            )}

            {activeModule === "ops" && (
              <div className="ops-grid">
                <div className="ops-copy">
                  <Clapperboard size={28} />
                  <h3>这不是演示壳，而是能继续生产的工具入口</h3>
                  <p>
                    当前版本已经包含服务端工作区、AI 调用记录、真实视频任务和多格式导出；多实例正式上线时按迁移脚本切换 PostgreSQL。
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
            )}

            {activeModule === "faq" && (
              <div className="faq-layout">
                <div className="faq-copy">
                  <HelpCircle size={26} />
                  <h3>上线前最常被问到的问题</h3>
                  <p>
                    重点覆盖密钥安全、AI 失败兜底、模板扩展、中文输出、导出格式和后续数据库升级。
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
            )}
          </div>
        </section>

        <section className="final-cta-band" id="start">
          <div>
            <p className="landing-kicker">Start Now</p>
            <h2>今晚把下一个短剧项目从灵感推进到可导出的首版方案</h2>
            <p>
              先用模板选题，再让 DeepSeek 生成首版，最后用结构化剧本、Seedance 真实视频和导出把讨论落到文件里。
            </p>
            <div className="final-cta-actions">
              <button className="landing-primary" type="button" onClick={onLaunch}>
                <Wand2 size={18} />
                开始生成
              </button>
              <button className="landing-secondary dark" type="button" onClick={() => openModule("templates")}>
                先看模板库
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
          <div className="final-cta-points">
            <p>
              <FileText size={17} />
              中文结构化剧本
            </p>
            <p>
              <MessageSquareText size={17} />
              创作备注留痕
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
          <p>AI 短剧叙事工厂，面向一人公司的短视频生成工作台。</p>
        </div>
        <div className="footer-columns">
          <div>
            <h3>产品</h3>
            <a href="#demo">产品演示</a>
            <button type="button" onClick={() => openModule("templates")}>热门模板</button>
            <button type="button" onClick={() => openModule("benefits")}>核心能力</button>
          </div>
          <div>
            <h3>工作流</h3>
            <button type="button" onClick={() => openModule("workflow")}>生成流程</button>
            <button type="button" onClick={() => openModule("ops")}>生产闭环</button>
            <button type="button" onClick={onLaunch}>进入工作台</button>
          </div>
          <div>
            <h3>联系</h3>
            <a href="mailto:team@djcytools.local">
              <Mail size={14} />
              hello@djcytools.local
            </a>
            <button type="button" onClick={() => openModule("faq")}>FAQ</button>
          </div>
          <div>
            <h3>说明</h3>
            <button type="button" onClick={() => openModule("faq")}>隐私与密钥安全</button>
            <button type="button" onClick={() => openModule("faq")}>数据备份说明</button>
            <button type="button" onClick={() => openModule("faq")}>导出格式说明</button>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 DJCYTools</span>
          <span>AI 生成内容发布前请人工复核</span>
        </div>
      </footer>
    </div>
  );
}

function HeroVideoCarousel({ activeVideo, activeVideoIndex, videos, onLaunch, onSelectVideo }) {
  const title = videoDisplayTitle(activeVideo, activeVideoIndex);
  return (
    <aside className="hero-video-carousel" aria-label="首页真实视频轮播">
      <div className="hero-video-head">
        <span>
          <Play size={16} />
          真实视频轮播
        </span>
        <b>{videos.length ? `${videos.length} 条成片` : "等待成片"}</b>
      </div>
      {activeVideo ? (
        <>
          <div className="hero-video-player">
            <video key={activeVideo.localVideoUrl} src={activeVideo.localVideoUrl} autoPlay muted loop playsInline controls preload="metadata" />
          </div>
          <div className="hero-video-meta">
            <h3>{title}</h3>
            <p>
              {activeVideo.model || "Seedance"} · {activeVideo.duration || 15}s · {activeVideo.ratio || "9:16"}
            </p>
          </div>
          <div className="hero-video-strip" aria-label="全部已生成视频">
            <div className="hero-video-strip-head">
              <b>全部生成视频</b>
              <span>{videos.length} 条</span>
            </div>
            <div className="hero-video-thumbs">
              {videos.map((video, index) => (
                <button
                  aria-label={`查看第 ${index + 1} 条已生成视频`}
                  className={index === activeVideoIndex ? "active" : ""}
                  key={video.taskId || video.localVideoUrl}
                  type="button"
                  onClick={() => onSelectVideo(index)}
                >
                  <span className="hero-video-thumb">
                    <video src={video.localVideoUrl} muted playsInline preload="metadata" />
                  </span>
                  <b>{videoDisplayTitle(video, index)}</b>
                  <small>{[video.duration ? `${video.duration}s` : "", video.ratio, video.downloadedAt ? "已入库" : ""].filter(Boolean).join(" · ")}</small>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="hero-video-empty">
          <Clapperboard size={26} />
          <h3>还没有可轮播的真实视频</h3>
          <p>工作台生成成功并下载到本地后，首页首屏会自动轮播最新成片。</p>
          <button type="button" onClick={onLaunch}>
            去生成真实视频
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </aside>
  );
}

function videoDisplayTitle(video, index = 0) {
  const title = String(video?.title || "").trim();
  if (title && !/^\?+$/.test(title)) return title;
  if (video?.taskId) return `Seedance 成片 ${index + 1}`;
  return "生成后自动展示";
}
