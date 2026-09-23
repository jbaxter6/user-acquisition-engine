import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { MessageTemplateStats } from "../types";
import {
  IconChevronDown,
  IconMoreVertical,
  IconPlus,
  IconSearch,
  IconTag,
  IconX,
} from "./icons";
import { PlatformBadge } from "./PlatformBadge";
import { formatRelativeTime } from "../lib/relativeTime";

type Filter = "all" | "top" | "drafts";
type SortKey = "hit" | "newest" | "sent";

const SORT_LABEL: Record<SortKey, string> = {
  hit: "Hit Rate: High to Low",
  newest: "Newest",
  sent: "Most Sent",
};

const TOP_PERFORMER_RATE = 0.3;
const VARIABLE_RE = /(\{\{\s*[\w.]+\s*\}\})/g;

function extractVariables(body: string): string[] {
  return Array.from(new Set(body.match(VARIABLE_RE) ?? []));
}

function renderBody(body: string) {
  return body.split(VARIABLE_RE).map((part, i) =>
    /^\{\{\s*[\w.]+\s*\}\}$/.test(part) ? (
      <code key={i} className="tpl-var">
        {part}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function hitTier(t: MessageTemplateStats): "draft" | "high" | "good" | "mid" | "low" {
  if (t.sent === 0) return "draft";
  if (t.reply_rate >= 0.35) return "high";
  if (t.reply_rate >= 0.27) return "good";
  if (t.reply_rate >= 0.2) return "mid";
  return "low";
}

function formatHours(hours: number | null): string {
  if (hours == null) return "--";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours >= 48) return `${(hours / 24).toFixed(1)} days`;
  return `${hours.toFixed(1)} hrs`;
}

export function TemplatesPanel() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<MessageTemplateStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("hit");
  const [menuId, setMenuId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    api
      .templateStats()
      .then(setStats)
      .catch((e) => setError(String(e)));
  };

  useEffect(refresh, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setFormOpen(false);
        setMenuId(null);
      }
    };
    const closeMenu = () => setMenuId(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", closeMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", closeMenu);
    };
  }, []);

  const openNew = () => {
    setEditingId(null);
    setName("");
    setBody("");
    setFormOpen(true);
  };

  const openDuplicate = (t: MessageTemplateStats) => {
    setEditingId(null);
    setName(`${t.name} (copy)`);
    setBody(t.body);
    setFormOpen(true);
  };

  const openEdit = (t: MessageTemplateStats) => {
    setEditingId(t.id);
    setName(t.name);
    setBody(t.body);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setName("");
    setBody("");
  };

  const handleSave = async () => {
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        await api.updateTemplate(editingId, name.trim(), body.trim());
      } else {
        await api.createTemplate(name.trim(), body.trim());
      }
      closeForm();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: number) => {
    if (
      !confirm(
        "Archive this template? Past stats will be kept, but it won't be selectable anymore.",
      )
    )
      return;
    await api.archiveTemplate(id);
    refresh();
  };

  const active = stats.filter((t) => !t.archived_at);
  const archived = stats.filter((t) => t.archived_at);

  const query = search.trim().toLowerCase();
  const visible = active
    .filter((t) => {
      if (filter === "top") return t.sent > 0 && t.reply_rate >= TOP_PERFORMER_RATE;
      if (filter === "drafts") return t.sent === 0;
      return true;
    })
    .filter(
      (t) =>
        !query ||
        t.name.toLowerCase().includes(query) ||
        t.body.toLowerCase().includes(query),
    )
    .sort((a, b) => {
      if (sort === "newest") return b.id - a.id;
      if (sort === "sent") return b.sent - a.sent;
      return b.reply_rate - a.reply_rate || b.sent - a.sent;
    });

  const topCount = active.filter(
    (t) => t.sent > 0 && t.reply_rate >= TOP_PERFORMER_RATE,
  ).length;
  const draftCount = active.filter((t) => t.sent === 0).length;

  return (
    <div className="prospecting tpl-page">
      <header className="tpl-header">
        <div>
          <h1>
            Message templates
            <span className="tpl-badge">
              {active.length} Active Pitch Variation
              {active.length === 1 ? "" : "s"}
            </span>
          </h1>
          <p>
            Save reusable outreach copy, use {"{{variable}}"} placeholders, and
            monitor conversion metrics below to see which pitches actually land
            replies.
          </p>
        </div>
        <button className="tpl-add-btn" onClick={openNew}>
          <IconPlus size={16} /> Add template
        </button>
      </header>

      {error && <div className="app__error">{error}</div>}

      <section className="tpl-toolbar">
        <label className="toolbar-search tpl-toolbar__search">
          <IconSearch size={15} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter pitches, tags, variables..."
          />
          <kbd>⌘K</kbd>
        </label>

        <div className="tpl-tabs">
          <button
            className={filter === "all" ? "tpl-tab tpl-tab--active" : "tpl-tab"}
            onClick={() => setFilter("all")}
          >
            All Pitches <span className="tpl-tab__count">{active.length}</span>
          </button>
          <button
            className={filter === "top" ? "tpl-tab tpl-tab--active" : "tpl-tab"}
            onClick={() => setFilter("top")}
          >
            Top Performers <span className="tpl-tab__count">{topCount}</span>
          </button>
          <button
            className={
              filter === "drafts" ? "tpl-tab tpl-tab--active" : "tpl-tab"
            }
            onClick={() => setFilter("drafts")}
          >
            New Drafts <span className="tpl-tab__count">{draftCount}</span>
          </button>
        </div>

        <label className="toolbar-select tpl-toolbar__sort">
          <span className="toolbar-select__prefix">Sort:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
          <IconChevronDown size={14} />
        </label>
      </section>

      <div className="tpl-grid">
        {visible.length === 0 && (
          <p className="empty-state">
            {active.length === 0
              ? "No templates yet — add one to get started."
              : "No templates match your filters."}
          </p>
        )}
        {visible.map((t) => {
          const tier = hitTier(t);
          const rate = Math.round(t.reply_rate * 1000) / 10;
          const vars = extractVariables(t.body);
          const words = t.body.trim().split(/\s+/).filter(Boolean).length;
          return (
            <article key={t.id} className={`tpl-card tpl-card--${tier}`}>
              <div className="tpl-card__body">
                <div className="tpl-card__top">
                  <span className={`tpl-rate tpl-rate--${tier}`}>
                    {tier === "draft" ? "NEW DRAFT" : `${rate}% HIT RATE`}
                  </span>
                  <span className="tpl-card__id">ID: #{String(t.id).padStart(2, "0")}</span>
                  <div className="tpl-card__menu">
                    <button
                      className="tpl-kebab"
                      aria-label="More actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(menuId === t.id ? null : t.id);
                      }}
                    >
                      <IconMoreVertical size={16} />
                    </button>
                    {menuId === t.id && (
                      <div
                        className="tpl-menu"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t.sent === 0 ? (
                          <button onClick={() => openEdit(t)}>Edit</button>
                        ) : (
                          <button onClick={() => openDuplicate(t)}>
                            Duplicate
                          </button>
                        )}
                        <button
                          className="tpl-menu__danger"
                          onClick={() => handleArchive(t.id)}
                        >
                          Archive
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <h3 className="tpl-card__title">
                  {t.name}
                  {t.sent > 0 && (
                    <span className="tpl-live" title="Sent — locked from editing">
                      LIVE
                    </span>
                  )}
                </h3>

                <div className="tpl-card__preview">{renderBody(t.body)}</div>

                <div className="tpl-card__meta">
                  <span>
                    <IconTag size={14} /> {vars.length} Token
                    {vars.length === 1 ? "" : "s"}
                  </span>
                  <span>
                    {t.body.length} chars • ~{words} words
                  </span>
                </div>
              </div>

              <div className="tpl-card__stats">
                <div className="tpl-stats-row">
                  <div>
                    <span>SENT</span>
                    <strong>{t.sent}</strong>
                  </div>
                  <div>
                    <span>REPLIED</span>
                    <strong className={`tpl-replied tpl-replied--${tier}`}>
                      {t.replied}
                    </strong>
                  </div>
                  <div>
                    <span>AVG RESPONSE</span>
                    <strong>{formatHours(t.avg_response_hours)}</strong>
                  </div>
                </div>

                <div className="tpl-benchmark">
                  <div className="tpl-benchmark__label">
                    <span>Hit Rate Benchmark</span>
                    <strong className={`tpl-replied tpl-replied--${tier}`}>
                      {t.sent > 0 ? `${rate}%` : "—"}
                    </strong>
                  </div>
                  <div className="tpl-bar">
                    <div
                      className={`tpl-bar__fill tpl-bar__fill--${tier}`}
                      style={{ width: `${Math.min(100, rate)}%` }}
                    />
                  </div>
                </div>

                {t.conversations.length > 0 && (
                  <button
                    className="tpl-convos-toggle"
                    onClick={() =>
                      setExpandedId(expandedId === t.id ? null : t.id)
                    }
                  >
                    <span>
                      {expandedId === t.id ? "Hide" : "View"} conversations (
                      {t.conversations.length})
                    </span>
                    <span
                      className={
                        expandedId === t.id
                          ? "tpl-convos-toggle__chev tpl-convos-toggle__chev--open"
                          : "tpl-convos-toggle__chev"
                      }
                    >
                      <IconChevronDown size={15} />
                    </span>
                  </button>
                )}

                {expandedId === t.id && (
                  <ul className="tpl-convos">
                    {t.conversations.map((c) => (
                      <li key={c.id}>
                        <button
                          className="tpl-convo"
                          onClick={() =>
                            navigate(`/inbox?conversationId=${c.id}`)
                          }
                          title="Open in inbox"
                        >
                          <PlatformBadge platform={c.platform} />
                          <span className="tpl-convo__who">
                            {c.participant_name || `@${c.participant_handle}`}
                          </span>
                          <span className="tpl-convo__when">
                            {formatRelativeTime(c.sent_at)}
                          </span>
                          <span
                            className={
                              c.replied
                                ? "tpl-convo__status tpl-convo__status--yes"
                                : "tpl-convo__status"
                            }
                          >
                            {c.replied
                              ? `Replied${c.response_hours != null ? ` · ${formatHours(c.response_hours)}` : ""}`
                              : "No reply"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="tpl-card__actions">
                  {t.sent === 0 ? (
                    <button className="tpl-btn" onClick={() => openEdit(t)}>
                      Edit
                    </button>
                  ) : (
                    <button
                      className="tpl-btn"
                      onClick={() => openDuplicate(t)}
                      title="Live templates are locked — duplicate to make changes"
                    >
                      Duplicate
                    </button>
                  )}
                  {t.sent === 0 ? (
                    <button
                      className="tpl-btn tpl-btn--muted"
                      onClick={() => handleArchive(t.id)}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      className="tpl-btn tpl-btn--accent"
                      onClick={() => navigate("/prospecting")}
                    >
                      Use in Prospecting
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {archived.length > 0 && (
        <details className="templates__archived">
          <summary>Archived templates ({archived.length})</summary>
          <div className="templates__list">
            {archived.map((t) => (
              <div
                key={t.id}
                className="templates__row templates__row--archived"
              >
                <div className="templates__row-main">
                  <span className="templates__row-name">{t.name}</span>
                  <span className="templates__row-stats">
                    {t.sent} sent · {t.replied} replied
                    {t.sent > 0
                      ? ` · ${Math.round(t.reply_rate * 100)}% reply rate`
                      : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {formOpen && (
        <div className="tpl-modal-backdrop" onClick={closeForm}>
          <div
            className="tpl-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tpl-modal__header">
              <h2>{editingId != null ? "Edit template" : "New template"}</h2>
              <button
                className="icon-btn icon-btn--ghost"
                onClick={closeForm}
                aria-label="Close"
              >
                <IconX size={15} />
              </button>
            </div>
            <input
              type="text"
              placeholder="Template name (e.g. Collab Pitch v1 - Direct & Punchy)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <textarea
              placeholder="Message body — use {{first_name}}-style placeholders"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="tpl-modal__footer">
              <span className="tpl-modal__count">
                {body.length} chars • {extractVariables(body).length} token
                {extractVariables(body).length === 1 ? "" : "s"}
              </span>
              <div className="templates__form-actions">
                <button className="secondary" onClick={closeForm}>
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !name.trim() || !body.trim()}
                >
                  {editingId != null ? "Save changes" : "Add template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
