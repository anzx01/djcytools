import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  ClipboardList,
  Download,
  FileJson,
  FileText,
  Flame,
  MessageSquare,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { templates } from "../../data/templates";
import { lastTrendUpdated, marketNotes, templateSignals, trendTags } from "../../data/trends";
import { getTemplate, uid } from "../../lib/generator";
import { calculateCampaignMetrics, exportDoc, exportJson, exportText, printPdf } from "../../lib/exporters";

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ErrorNotice({ error, onClose }) {
  return (
    <div className={`error-notice ${error.tone === "error" ? "error" : ""}`} role="status">
      <AlertTriangle size={18} />
      <div>
        <strong>{error.title}</strong>
        <p>{error.message}</p>
        {error.detail && <small>{error.detail}</small>}
      </div>
      <button type="button" onClick={onClose} title="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}

export function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PanelHeader({ icon: Icon, eyebrow, title }) {
  return (
    <div className="panel-header">
      <div className="panel-icon">
        <Icon size={17} />
      </div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
    </div>
  );
}

export function TemplateBriefPreview({ template }) {
  const tags = template.tags || [];
  return (
    <div className="template-preview">
      <div className="template-preview-head">
        <span>{template.type}</span>
        <strong>{template.heatScore || "自定义"}</strong>
      </div>
      <h4>{template.name}</h4>
      <p>{template.hook}</p>
      <div className="template-preview-tags">
        {tags.slice(0, 4).map((tag) => (
          <em key={tag}>{tag}</em>
        ))}
      </div>
    </div>
  );
}

export function DraftReadinessPanel({ readiness }) {
  return (
    <div className="readiness-panel">
      <div className="readiness-head">
        <span>生成准备度</span>
        <strong>{readiness.score}%</strong>
      </div>
      <div className="readiness-track" aria-hidden="true">
        <i style={{ width: `${readiness.score}%` }} />
      </div>
      <div className="readiness-checks">
        {readiness.checks.map((item) => (
          <span className={item.done ? "done" : ""} key={item.label}>
            {item.done && <Check size={12} />}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CampaignPanel({ project, activeVersion, onAddResult }) {
  const [draft, setDraft] = useState({
    channel: "Meta Ads",
    materialName: activeVersion.selectedTitle || project.name,
    spend: 100,
    impressions: 10000,
    clicks: 420,
    completions: 1800,
    conversions: 18,
    revenue: 220,
    materialUrl: "",
    note: "",
  });
  const metrics = calculateCampaignMetrics(draft);
  const results = project.campaignResults || [];

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      materialName: activeVersion.selectedTitle || project.name,
    }));
  }, [activeVersion.id, activeVersion.selectedTitle, project.name]);

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submitResult() {
    onAddResult({
      ...draft,
      spend: Number(draft.spend || 0),
      impressions: Number(draft.impressions || 0),
      clicks: Number(draft.clicks || 0),
      completions: Number(draft.completions || 0),
      conversions: Number(draft.conversions || 0),
      revenue: Number(draft.revenue || 0),
    });
    setDraft((current) => ({
      ...current,
      materialName: activeVersion.selectedTitle || project.name,
      materialUrl: "",
      note: "",
    }));
  }

  return (
    <div className="campaign-panel">
      <div className="campaign-form">
        <div className="two-col">
          <label>
            渠道
            <input value={draft.channel} onChange={(event) => updateField("channel", event.target.value)} />
          </label>
          <label>
            素材名
            <input value={draft.materialName} onChange={(event) => updateField("materialName", event.target.value)} />
          </label>
        </div>
        <div className="campaign-number-grid">
          {[
            ["spend", "花费 $"],
            ["impressions", "曝光"],
            ["clicks", "点击"],
            ["completions", "完播"],
            ["conversions", "转化"],
            ["revenue", "收入 $"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input type="number" min="0" value={draft[key]} onChange={(event) => updateField(key, event.target.value)} />
            </label>
          ))}
        </div>
        <label>
          素材链接
          <input value={draft.materialUrl} onChange={(event) => updateField("materialUrl", event.target.value)} />
        </label>
        <label>
          投流备注
          <textarea rows={2} value={draft.note} onChange={(event) => updateField("note", event.target.value)} />
        </label>
        <div className="campaign-metrics-preview">
          <span>CTR <b>{metrics.ctr}%</b></span>
          <span>完播 <b>{metrics.completionRate}%</b></span>
          <span>CPA <b>${metrics.cpa}</b></span>
          <span>ROAS <b>{metrics.roas}</b></span>
        </div>
        <button className="secondary-action strong" type="button" onClick={submitResult}>
          <Plus size={15} />
          记录投流结果
        </button>
      </div>

      <div className="campaign-result-list">
        {results.slice(0, 6).map((result) => {
          const itemMetrics = result.metrics || calculateCampaignMetrics(result);
          return (
            <article key={result.id}>
              <div>
                <b>{result.channel}</b>
                <span>{result.materialName}</span>
                <small>{result.versionName} · {formatDate(result.createdAt)}</small>
              </div>
              <strong>{itemMetrics.roas}x</strong>
              <p>
                CTR {itemMetrics.ctr}% · 完播 {itemMetrics.completionRate}% · CPA ${itemMetrics.cpa}
              </p>
            </article>
          );
        })}
        {results.length === 0 && <p className="muted-note">暂无投流结果。导出后把素材表现回填到这里，用于复盘模板和版本。</p>}
      </div>
    </div>
  );
}

export function ScriptEditor({ version, patchActiveVersion, onRewrite, isRewriting }) {
  function updateField(field, value) {
    patchActiveVersion((current) => ({ ...current, [field]: value }));
  }

  function updateCharacter(index, field, value) {
    patchActiveVersion((current) => ({
      ...current,
      characters: current.characters.map((character, itemIndex) =>
        itemIndex === index ? { ...character, [field]: value } : character,
      ),
    }));
  }

  function updateEpisode(index, field, value) {
    patchActiveVersion((current) => ({
      ...current,
      episodes: current.episodes.map((episode, itemIndex) =>
        itemIndex === index
          ? {
              ...episode,
              [field]: field === "dialogue" ? value.split("\n").filter(Boolean) : value,
            }
          : episode,
      ),
    }));
  }

  function updateStringList(field, index, value) {
    patchActiveVersion((current) => ({
      ...current,
      [field]: (current[field] || []).map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  }

  const titleCandidates = version.titleCandidates || [];
  const sellingPoints = version.sellingPoints || [];
  const adHooks = version.adHooks || [];
  const characters = version.characters || [];
  const outline = version.outline || [];
  const episodes = version.episodes || [];

  return (
    <div className="editor-content">
      <div className="title-candidates">
        {titleCandidates.map((title) => (
          <button
            key={title}
            type="button"
            className={version.selectedTitle === title ? "chip selected" : "chip"}
            onClick={() => updateField("selectedTitle", title)}
          >
            {title}
          </button>
        ))}
      </div>

      <VersionMeta version={version} />

      <label>
        一句话卖点
        <textarea rows={3} value={version.logline} onChange={(event) => updateField("logline", event.target.value)} />
      </label>

      <div className="section-band compact-section">
        <h4>卖点卡</h4>
        <div className="text-card-grid">
          {sellingPoints.map((point, index) => (
            <label className="text-card" key={`${point}-${index}`}>
              卖点 {index + 1}
              <textarea rows={2} value={point} onChange={(event) => updateStringList("sellingPoints", index, event.target.value)} />
            </label>
          ))}
        </div>
      </div>

      <div className="quick-actions">
        {["提高冲突", "生成投流钩子", "降低狗血度", "本地化表达"].map((item) => (
          <button key={item} type="button" onClick={() => onRewrite(item)} disabled={isRewriting}>
            <RefreshCcw size={15} />
            {isRewriting ? "改写中..." : item}
          </button>
        ))}
      </div>

      <div className="section-band">
        <h4>人物卡</h4>
        <div className="character-grid">
          {characters.map((character, index) => (
            <div className="character-item" key={`${character.role}-${character.name}`}>
              <span>{character.role}</span>
              <input value={character.name} onChange={(event) => updateCharacter(index, "name", event.target.value)} />
              <textarea rows={2} value={character.motive} onChange={(event) => updateCharacter(index, "motive", event.target.value)} />
              <small>{character.archetype}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="section-band">
        <h4>故事大纲</h4>
        <div className="outline-list">
          {outline.map((arc, index) => (
            <label key={arc.id}>
              {arc.stage}
              <textarea
                rows={2}
                value={arc.summary}
                onChange={(event) =>
                  patchActiveVersion((current) => ({
                    ...current,
                    outline: current.outline.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, summary: event.target.value } : item,
                    ),
                  }))
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="section-band compact-section">
        <h4>投流钩子</h4>
        <div className="ad-hook-list">
          {adHooks.map((hook, index) => (
            <label key={`${hook}-${index}`}>
              钩子 {index + 1}
              <textarea rows={2} value={hook} onChange={(event) => updateStringList("adHooks", index, event.target.value)} />
            </label>
          ))}
        </div>
      </div>

      <div className="section-band">
        <h4>前 3 集脚本</h4>
        {episodes.map((episode, index) => (
          <article className="episode-editor" key={episode.number}>
            <div className="episode-head">
              <strong>第 {episode.number} 集</strong>
              <input value={episode.title} onChange={(event) => updateEpisode(index, "title", event.target.value)} />
            </div>
            <label>
              钩子
              <textarea rows={2} value={episode.hook} onChange={(event) => updateEpisode(index, "hook", event.target.value)} />
            </label>
            <label>
              结构
              <textarea rows={2} value={episode.beat} onChange={(event) => updateEpisode(index, "beat", event.target.value)} />
            </label>
            <label>
              脚本
              <textarea rows={4} value={episode.script} onChange={(event) => updateEpisode(index, "script", event.target.value)} />
            </label>
            <label>
              核心对白
              <textarea
                rows={2}
                value={(episode.dialogue || []).join("\n")}
                onChange={(event) => updateEpisode(index, "dialogue", event.target.value)}
              />
            </label>
          </article>
        ))}
      </div>
    </div>
  );
}

function VersionMeta({ version }) {
  const usage = version.usage || {};
  return (
    <div className="version-meta">
      <span>{version.source || "本地生成"}</span>
      {version.model && <span>{version.model}</span>}
      {typeof usage.total_tokens === "number" && <span>{usage.total_tokens} tokens</span>}
      {typeof version.costUsd === "number" && <span>${version.costUsd}</span>}
      {version.requestId && <span>{version.requestId}</span>}
      <span>{formatDate(version.createdAt)}</span>
    </div>
  );
}

export function ScoreCard({ version, onRewrite, isRewriting }) {
  return (
    <div>
      <div className="score-dial">
        <span>{version.score.total}</span>
        <small>综合分</small>
      </div>
      <div className="score-bars">
        {version.score.dimensions.map((item) => (
          <div className="score-line" key={item.name}>
            <span>
              {item.name}
              <b>{item.score}</b>
            </span>
            <div className="bar-track">
              <i style={{ width: `${item.score}%` }} />
            </div>
            <small>{item.note}</small>
          </div>
        ))}
      </div>
      <div className="suggestion-list">
        {version.score.suggestions.map((suggestion) => (
          <button type="button" key={suggestion} onClick={() => onRewrite(suggestion)} disabled={isRewriting}>
            <Flame size={15} />
            {isRewriting ? "DeepSeek 改写中..." : suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VersionPanel({ project, activeVersion, compareVersion, compareVersionId, setCompareVersionId, setWorkspace }) {
  function setActiveVersion(versionId) {
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id === project.id ? { ...item, activeVersionId: versionId, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  }

  return (
    <div className="version-panel">
      <label>
        对比版本
        <select value={compareVersionId} onChange={(event) => setCompareVersionId(event.target.value)}>
          <option value="">自动选择上一版</option>
          {project.versions
            .filter((version) => version.id !== activeVersion.id)
            .map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
        </select>
      </label>
      {compareVersion && (
        <div className="compare-box">
          <div>
            <span>当前</span>
            <strong>{activeVersion.score.total}</strong>
            <small>{activeVersion.name}</small>
          </div>
          <div>
            <span>对照</span>
            <strong>{compareVersion.score.total}</strong>
            <small>{compareVersion.name}</small>
          </div>
        </div>
      )}
      <div className="version-list">
        {project.versions.map((version) => (
          <button
            key={version.id}
            type="button"
            className={version.id === activeVersion.id ? "version-row active" : "version-row"}
            onClick={() => setActiveVersion(version.id)}
          >
            <span>
              <b>{version.name}</b>
              <small>
                {formatDate(version.createdAt)} · {version.templateName} · {version.source || "本地生成"}
              </small>
            </span>
            <strong>{version.score.total}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TrendPanel({ setDraftBrief }) {
  function applyTag(tag) {
    setDraftBrief((brief) => ({
      ...brief,
      painPoint: `${tag.tag}：围绕${tag.fit}设计前 3 集。`,
    }));
  }

  return (
    <div className="trend-panel">
      <p className="timestamp">更新：{lastTrendUpdated}</p>
      <div className="trend-list">
        {trendTags.map((tag) => (
          <button type="button" className="trend-row" key={`${tag.tag}-${tag.market}`} onClick={() => applyTag(tag)}>
            <span>
              <b>{tag.tag}</b>
              <small>{tag.market} · {tag.fit}</small>
            </span>
            <strong>
              {tag.heat}
              <em>{tag.change > 0 ? `+${tag.change}` : tag.change}</em>
            </strong>
          </button>
        ))}
      </div>
      <div className="signal-grid">
        {templateSignals.map((signal) => (
          <div className="signal" key={signal.name}>
            <b>{signal.name}</b>
            <span>保存 {signal.saveRate}%</span>
            <span>导出 {signal.exportRate}%</span>
            <strong>{signal.score}</strong>
          </div>
        ))}
      </div>
      <div className="market-note-list">
        {marketNotes.map((note) => (
          <p key={note.market}>
            <b>{note.market}</b>
            {note.note}
          </p>
        ))}
      </div>
    </div>
  );
}

export function DeliveryPanel({ project, commentText, setCommentText, addComment, recordExport }) {
  return (
    <div className="delivery-panel">
      <div className="export-grid">
        <button type="button" onClick={() => recordExport("TXT", exportText)}>
          <FileText size={16} />
          TXT
        </button>
        <button type="button" onClick={() => recordExport("PDF", printPdf)}>
          <ClipboardList size={16} />
          PDF
        </button>
        <button type="button" onClick={() => recordExport("DOC", exportDoc)}>
          <Archive size={16} />
          DOC
        </button>
        <button type="button" onClick={() => recordExport("JSON", exportJson)}>
          <FileJson size={16} />
          JSON
        </button>
      </div>

      <div className="comment-box">
        <label>
          团队评论
          <textarea rows={2} value={commentText} onChange={(event) => setCommentText(event.target.value)} />
        </label>
        <button type="button" onClick={addComment}>
          <MessageSquare size={15} />
          添加评论
        </button>
      </div>

      <div className="activity-list">
        {project.comments.map((comment) => (
          <p key={comment.id}>
            <b>{comment.author}</b>
            {comment.text}
            <small>{formatDate(comment.createdAt)}</small>
          </p>
        ))}
        {project.exports.map((item) => (
          <p key={item.id}>
            <b>{item.type}</b>
            已导出 {item.version}
            <small>{formatDate(item.createdAt)}</small>
          </p>
        ))}
      </div>
    </div>
  );
}

export function TeamPanel({ workspace, setWorkspace }) {
  const members = workspace.team?.members || [];

  function patchTeam(patcher) {
    setWorkspace((current) => ({
      ...current,
      team: patcher(current.team || { name: "未命名团队", members: [] }),
    }));
  }

  function updateMember(index, field, value) {
    patchTeam((team) => ({
      ...team,
      members: team.members.map((member, itemIndex) => (itemIndex === index ? { ...member, [field]: value } : member)),
    }));
  }

  function addMember() {
    patchTeam((team) => ({
      ...team,
      members: [...team.members, { name: "新成员", role: "查看者" }],
    }));
  }

  function removeMember(index) {
    patchTeam((team) => ({
      ...team,
      members: team.members.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  return (
    <div className="team-panel">
      <label>
        团队名称
        <input
          value={workspace.team?.name || ""}
          onChange={(event) => patchTeam((team) => ({ ...team, name: event.target.value }))}
        />
      </label>
      <div className="member-list">
        {members.map((member, index) => (
          <div className="member-row" key={`${member.name}-${index}`}>
            <input value={member.name} onChange={(event) => updateMember(index, "name", event.target.value)} />
            <select value={member.role} onChange={(event) => updateMember(index, "role", event.target.value)}>
              <option>所有者</option>
              <option>编辑者</option>
              <option>查看者</option>
            </select>
            <button type="button" onClick={() => removeMember(index)} title="移除成员">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <button className="secondary-action" type="button" onClick={addMember}>
        <Plus size={15} />
        添加成员
      </button>
    </div>
  );
}

export function TemplateManager({ workspace, setWorkspace, templateCatalog, typeGroups, draftBrief, setDraftBrief, setDraftParams }) {
  const selectedTemplate = getTemplate(draftBrief.templateId, templateCatalog);
  const [draftTemplate, setDraftTemplate] = useState(() => createTemplateDraft(selectedTemplate));
  const customTemplates = workspace.customTemplates || [];

  useEffect(() => {
    setDraftTemplate((current) => (current.id ? current : createTemplateDraft(selectedTemplate)));
  }, [selectedTemplate.id]);

  function createTemplateDraft(template) {
    return {
      id: "",
      name: `${template.name} 改版`,
      type: template.type || "自定义",
      tags: (template.tags || []).join("、"),
      premise: template.premise || "",
      lead: template.lead || "",
      rival: template.rival || "",
      hook: template.hook || "",
      beat: template.beat || "",
      heatScore: 70,
      defaultParams: template.defaultParams || selectedTemplate.defaultParams,
    };
  }

  function resetFromSelected() {
    setDraftTemplate(createTemplateDraft(selectedTemplate));
  }

  function saveCustomTemplate() {
    const nextTemplate = {
      id: draftTemplate.id || `custom-${uid("tpl")}`,
      name: draftTemplate.name.trim() || "未命名自定义模板",
      type: draftTemplate.type.trim() || "自定义",
      category: draftTemplate.type.trim() || "自定义",
      heatRank: draftTemplate.id ? draftTemplate.heatRank || 900 : 900 + customTemplates.length + 1,
      heatScore: Number(draftTemplate.heatScore || 70),
      tags: draftTemplate.tags
        .split(/[、,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      premise: draftTemplate.premise,
      lead: draftTemplate.lead,
      rival: draftTemplate.rival,
      hook: draftTemplate.hook,
      beat: draftTemplate.beat,
      defaultParams: draftTemplate.defaultParams || selectedTemplate.defaultParams,
      isCustom: true,
    };

    setWorkspace((current) => {
      const existing = current.customTemplates || [];
      const nextCustomTemplates = existing.some((template) => template.id === nextTemplate.id)
        ? existing.map((template) => (template.id === nextTemplate.id ? nextTemplate : template))
        : [nextTemplate, ...existing];
      return {
        ...current,
        customTemplates: nextCustomTemplates,
      };
    });
    setDraftTemplate(createTemplateDraft(nextTemplate));
    setDraftBrief((brief) => ({ ...brief, templateId: nextTemplate.id }));
    setDraftParams(nextTemplate.defaultParams);
  }

  function editCustomTemplate(template) {
    setDraftTemplate({
      ...template,
      tags: (template.tags || []).join("、"),
    });
  }

  function deleteCustomTemplate(templateId) {
    setWorkspace((current) => ({
      ...current,
      customTemplates: (current.customTemplates || []).filter((template) => template.id !== templateId),
    }));
    if (draftBrief.templateId === templateId) {
      setDraftBrief((brief) => ({ ...brief, templateId: templates[0].id }));
      setDraftParams(templates[0].defaultParams);
    }
  }

  return (
    <div className="template-manager">
      <div className="template-manager-head">
        <div>
          <strong>{templateCatalog.length}</strong>
          <span>可用模板</span>
        </div>
        <div>
          <strong>{customTemplates.length}</strong>
          <span>团队自定义</span>
        </div>
      </div>

      <div className="template-form">
        <div className="two-col">
          <label>
            模板名
            <input
              value={draftTemplate.name}
              onChange={(event) => setDraftTemplate({ ...draftTemplate, name: event.target.value })}
            />
          </label>
          <label>
            类型
            <input
              list="template-type-options"
              value={draftTemplate.type}
              onChange={(event) => setDraftTemplate({ ...draftTemplate, type: event.target.value })}
            />
            <datalist id="template-type-options">
              {typeGroups.map((type) => (
                <option key={type} value={type} />
              ))}
              <option value="自定义" />
            </datalist>
          </label>
        </div>
        <label>
          标签
          <input value={draftTemplate.tags} onChange={(event) => setDraftTemplate({ ...draftTemplate, tags: event.target.value })} />
        </label>
        <label>
          钩子
          <textarea rows={2} value={draftTemplate.hook} onChange={(event) => setDraftTemplate({ ...draftTemplate, hook: event.target.value })} />
        </label>
        <label>
          模板主线
          <textarea rows={2} value={draftTemplate.beat} onChange={(event) => setDraftTemplate({ ...draftTemplate, beat: event.target.value })} />
        </label>
        <div className="two-col">
          <label>
            主角
            <input value={draftTemplate.lead} onChange={(event) => setDraftTemplate({ ...draftTemplate, lead: event.target.value })} />
          </label>
          <label>
            对手
            <input value={draftTemplate.rival} onChange={(event) => setDraftTemplate({ ...draftTemplate, rival: event.target.value })} />
          </label>
        </div>
        <div className="template-actions">
          <button className="secondary-action" type="button" onClick={resetFromSelected}>
            复制当前模板
          </button>
          <button className="secondary-action strong" type="button" onClick={saveCustomTemplate}>
            保存为团队模板
          </button>
        </div>
      </div>

      <div className="custom-template-list">
        {customTemplates.map((template) => (
          <div className="custom-template-row" key={template.id}>
            <button type="button" onClick={() => editCustomTemplate(template)}>
              <b>{template.name}</b>
              <span>{template.type} · {template.tags?.slice(0, 3).join(" / ")}</span>
            </button>
            <button type="button" onClick={() => deleteCustomTemplate(template.id)} title="删除自定义模板">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {customTemplates.length === 0 && <p className="muted-note">还没有团队自定义模板。可以复制当前模板后改写并保存。</p>}
      </div>
    </div>
  );
}

function formatOptionalDate(value) {
  return value ? formatDate(value) : "暂无";
}

export function OpsPanel({ storageStatus, aiLogState, analyticsState, exportWorkspaceBackup, importWorkspaceBackup, backupInputRef }) {
  const totals = aiLogState.totals || { count: 0, success: 0, tokens: 0, costUsd: 0 };
  const analyticsTotals = analyticsState?.totals || { pageViews: 0, uniqueVisitors: 0 };
  const landingStats = analyticsState?.pages?.landing || { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null };
  const workbenchStats = analyticsState?.pages?.workbench || { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null };
  const recentVisitAt = analyticsState?.recentEvents?.[0]?.createdAt || landingStats.lastVisitedAt || workbenchStats.lastVisitedAt;
  return (
    <div className="ops-panel">
      <div className="ops-status">
        <strong>{storageStatus}</strong>
        <span>AI 调用 {totals.count} 次 · 成功 {totals.success} 次</span>
        <span>Token {totals.tokens} · 估算成本 ${totals.costUsd}</span>
      </div>
      <div className="analytics-grid">
        <div>
          <span>落地页访问</span>
          <strong>{landingStats.pageViews}</strong>
          <small>{landingStats.uniqueVisitors} 独立访客</small>
        </div>
        <div>
          <span>工作台访问</span>
          <strong>{workbenchStats.pageViews}</strong>
          <small>{workbenchStats.uniqueVisitors} 独立访客</small>
        </div>
        <div>
          <span>总独立访客</span>
          <strong>{analyticsTotals.uniqueVisitors}</strong>
          <small>总访问 {analyticsTotals.pageViews}</small>
        </div>
        <div>
          <span>最近访问</span>
          <strong className="compact">{formatOptionalDate(recentVisitAt)}</strong>
          <small>本地匿名埋点</small>
        </div>
      </div>
      <div className="ai-log-list">
        {(aiLogState.logs || []).slice(0, 5).map((log) => (
          <p key={log.id}>
            <b>{log.status === "success" ? "成功" : "失败"}</b>
            {log.instruction} · {log.model || "unknown"}
            <small>
              {log.durationMs}ms · {formatDate(log.createdAt)}
            </small>
          </p>
        ))}
        {(!aiLogState.logs || aiLogState.logs.length === 0) && <p>暂无 AI 调用日志。</p>}
      </div>
      <div className="backup-actions">
        <button className="secondary-action" type="button" onClick={exportWorkspaceBackup}>
          <Download size={15} />
          导出工作区
        </button>
        <button className="secondary-action" type="button" onClick={() => backupInputRef.current?.click()}>
          <Archive size={15} />
          恢复备份
        </button>
        <input
          ref={backupInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => importWorkspaceBackup(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
