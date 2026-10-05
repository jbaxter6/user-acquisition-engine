import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import {
  TEMPLATE_AUTHORS,
  authorLabel,
  isTemplateAuthor,
  type TemplateAuthor,
} from "../lib/templateAuthors";
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
import { hasTag, tagsInUse } from "../lib/templateTags";

type ViewKey =
  | "all"
  | "top"
  | "drafts"
  | "newest"
  | "sent"
  | "replies"
  | "lowest"
  | "quickest"
  | "slowest"
  | "longest"
  | "shortest"
  | "mostTokens"
  | "leastTokens";

const VIEW_LABEL: Record<ViewKey, string> = {
  all: "All Pitches",
  top: "Top Performers (Best hit rate)",
  drafts: "New Drafts (Unused)",
  newest: "Newest",
  sent: "Most Sent",
  replies: "Most Replies",
  lowest: "Lowest Hit Rate",
  quickest: "Quickest Response Time",
  slowest: "Slowest Response Time",
  longest: "Most Characters",
  shortest: "Least Characters",
  mostTokens: "Most Tokens",
  leastTokens: "Least Tokens",
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

function knownAuthors(authors: string[] | undefined): TemplateAuthor[] {
  return (authors ?? []).filter(isTemplateAuthor);
}

function tagSummary(selected: string[]): string {
  if (selected.length === 0) return "All";
  if (selected.length <= 2) return selected.join(", ");
  return `${selected.length} selected`;
}

function TagFilterSelect({
  tags,
  counts,
  value,
  onChange,
}: {
  tags: string[];
  counts: Map<string, number>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = tags.filter((tag) => value.some((item) => hasTag([item], tag)));
  const needle = query.trim().toLowerCase();
  const shown = needle ? tags.filter((tag) => tag.toLowerCase().includes(needle)) : tags;

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (tag: string) => {
    const on = selected.some((item) => hasTag([item], tag));
    onChange(on ? selected.filter((item) => !hasTag([item], tag)) : [...selected, tag]);
  };

  return (
    <div className="tpl-tag-select" ref={rootRef}>
      <button
        type="button"
        className={
          selected.length
            ? "tpl-tag-select__button tpl-tag-select__button--active"
            : "tpl-tag-select__button"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected.length ? selected.join(", ") : "All tags"}
        onClick={() => setOpen((current) => !current)}
      >
        <IconTag size={14} />
        <span className="toolbar-select__prefix">Tags</span>
        <span className="tpl-tag-select__value">{tagSummary(selected)}</span>
        <IconChevronDown size={14} />
      </button>
      {open && (
        <div
          className="tpl-tag-select__menu"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Filter by tag"
        >
          {tags.length > 6 && (
            <input
              className="tpl-tag-select__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a tag"
              aria-label="Find a tag"
              autoFocus
            />
          )}
          <div className="tpl-tag-select__options">
            {shown.length === 0 && <p className="tpl-tag-select__empty">No matching tags</p>}
            {shown.map((tag) => {
              const on = selected.some((item) => hasTag([item], tag));
              return (
                <label
                  key={tag}
                  className={
                    on
                      ? "tpl-tag-select__option tpl-tag-select__option--on"
                      : "tpl-tag-select__option"
                  }
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(tag)}
                  />
                  <span className="tpl-tag-select__label">{tag}</span>
                  <span className="filter-pill__count">{counts.get(tag) ?? 0}</span>
                </label>
              );
            })}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              className="tpl-tag-select__clear"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AuthorSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: TemplateAuthor[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = TEMPLATE_AUTHORS.filter((author) => value.includes(author));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  const toggle = (author: TemplateAuthor) => {
    const next = new Set(selected);
    if (next.has(author)) next.delete(author);
    else next.add(author);
    onChange(TEMPLATE_AUTHORS.filter((item) => next.has(item)));
  };

  return (
    <div className="tpl-tag-field">
      <span className="tpl-tag-field__label">Author</span>
      <div className="tpl-author-select" ref={rootRef}>
        <button
          type="button"
          className={
            selected.length === 0
              ? "tpl-author-select__button tpl-author-select__button--empty"
              : "tpl-author-select__button"
          }
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>
            {selected.length === 0 ? "Select authors…" : selected.map(authorLabel).join(", ")}
          </span>
          <IconChevronDown size={14} />
        </button>
        {open && (
          <div className="tpl-author-menu" role="listbox" aria-multiselectable="true" aria-label="Authors">
            {TEMPLATE_AUTHORS.map((author) => (
              <label key={author}>
                <input
                  type="checkbox"
                  checked={selected.includes(author)}
                  onChange={() => toggle(author)}
                />
                {authorLabel(author)}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TemplatesPanel() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<MessageTemplateStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [menuId, setMenuId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [authors, setAuthors] = useState<TemplateAuthor[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState<TemplateAuthor | null>(null);
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
        setDetailId(null);
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
    setTags([]);
    setAuthors([]);
    setTagDraft("");
    setFormOpen(true);
  };

  const openDuplicate = (t: MessageTemplateStats) => {
    setEditingId(null);
    setName(`${t.name} (copy)`);
    setBody(t.body);
    setTags(t.tags);
    setAuthors(knownAuthors(t.authors));
    setTagDraft("");
    setFormOpen(true);
  };

  const openEdit = (t: MessageTemplateStats) => {
    setEditingId(t.id);
    setName(t.name);
    setBody(t.body);
    setTags(t.tags);
    setAuthors(knownAuthors(t.authors));
    setTagDraft("");
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setName("");
    setBody("");
    setTags([]);
    setAuthors([]);
    setTagDraft("");
  };

  const addTag = (raw: string) => {
    const next = raw
      .split(",")
      .map((part) => part.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (next.length === 0) return;
    setTags((current) => {
      const seen = new Set(current.map((tag) => tag.toLowerCase()));
      const added = [...current];
      for (const tag of next) {
        if (seen.has(tag.toLowerCase()) || added.length >= 8) continue;
        seen.add(tag.toLowerCase());
        added.push(tag);
      }
      return added;
    });
    setTagDraft("");
  };

  const handleSave = async () => {
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    const pending = tagDraft.trim()
      ? [
          ...tags,
          ...tagDraft
            .split(",")
            .map((part) => part.trim().replace(/\s+/g, " "))
            .filter(
              (part) =>
                part && !tags.some((tag) => tag.toLowerCase() === part.toLowerCase()),
            ),
        ].slice(0, 8)
      : tags;
    try {
      if (editingId != null) {
        await api.updateTemplate(editingId, name.trim(), body.trim(), pending, authors);
      } else {
        await api.createTemplate(name.trim(), body.trim(), pending, authors);
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
  const tagChoices = tagsInUse(active);
  const tagCounts = new Map(
    tagChoices.map((tag) => [tag, active.filter((t) => hasTag(t.tags, tag)).length]),
  );
  const selectedTags = tagFilter.filter((tag) =>
    tagChoices.some((choice) => hasTag([choice], tag)),
  );
  const authorChoices = TEMPLATE_AUTHORS.filter((author) =>
    active.some((t) => knownAuthors(t.authors).includes(author)),
  );
  const focusTag = (tag: string) => {
    setTagFilter((current) =>
      current.length === 1 && hasTag(current, tag) ? [] : [tag],
    );
  };
  const editing = stats.find((t) => t.id === editingId) ?? null;
  const textLocked = editing != null && editing.sent > 0;

  const query = search.trim().toLowerCase();
  const byHit = (a: MessageTemplateStats, b: MessageTemplateStats) =>
    b.reply_rate - a.reply_rate || b.sent - a.sent;
  const visible = active
    .filter((t) => {
      if (view === "top") return t.sent > 0 && t.reply_rate >= TOP_PERFORMER_RATE;
      if (view === "drafts") return t.sent === 0;
      if (view === "lowest") return t.sent > 0;
      if (view === "quickest" || view === "slowest")
        return t.avg_response_hours != null;
      return true;
    })
    .filter(
      (t) => selectedTags.length === 0 || selectedTags.some((tag) => hasTag(t.tags, tag)),
    )
    .filter((t) => authorFilter == null || knownAuthors(t.authors).includes(authorFilter))
    .filter(
      (t) =>
        !query ||
        t.name.toLowerCase().includes(query) ||
        t.body.toLowerCase().includes(query) ||
        t.tags.some((tag) => tag.toLowerCase().includes(query)) ||
        knownAuthors(t.authors).some(
          (author) =>
            author.includes(query) || authorLabel(author).toLowerCase().includes(query),
        ),
    )
    .sort((a, b) => {
      switch (view) {
        case "newest":
        case "drafts":
          return b.id - a.id;
        case "sent":
          return b.sent - a.sent || byHit(a, b);
        case "replies":
          return b.replied - a.replied || byHit(a, b);
        case "lowest":
          return a.reply_rate - b.reply_rate || b.sent - a.sent;
        case "quickest":
          return (a.avg_response_hours ?? 0) - (b.avg_response_hours ?? 0);
        case "slowest":
          return (b.avg_response_hours ?? 0) - (a.avg_response_hours ?? 0);
        case "longest":
          return b.body.length - a.body.length;
        case "shortest":
          return a.body.length - b.body.length;
        case "mostTokens":
          return (
            extractVariables(b.body).length - extractVariables(a.body).length
          );
        case "leastTokens":
          return (
            extractVariables(a.body).length - extractVariables(b.body).length
          );
        default:
          return byHit(a, b);
      }
    });

  const detail = stats.find((t) => t.id === detailId) ?? null;

  return (
    <div className="prospecting tpl-page">
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
        </label>

        {authorChoices.length > 0 && (
          <label
            className={
              authorFilter
                ? "toolbar-select tpl-toolbar__author toolbar-select--active"
                : "toolbar-select tpl-toolbar__author"
            }
          >
            <span className="toolbar-select__prefix">Author</span>
            <select
              aria-label="Filter by author"
              value={authorFilter ?? ""}
              onChange={(e) =>
                setAuthorFilter(
                  e.target.value && isTemplateAuthor(e.target.value) ? e.target.value : null,
                )
              }
            >
              <option value="">All</option>
              {authorChoices.map((author) => (
                <option key={author} value={author}>
                  {authorLabel(author)} (
                  {active.filter((t) => knownAuthors(t.authors).includes(author)).length})
                </option>
              ))}
            </select>
            <IconChevronDown size={14} />
          </label>
        )}

        {tagChoices.length > 0 && (
          <TagFilterSelect
            tags={tagChoices}
            counts={tagCounts}
            value={selectedTags}
            onChange={setTagFilter}
          />
        )}

        <label className="toolbar-select tpl-toolbar__sort">
          <span className="toolbar-select__prefix">View:</span>
          <select
            value={view}
            onChange={(e) => setView(e.target.value as ViewKey)}
          >
            {(Object.keys(VIEW_LABEL) as ViewKey[]).map((k) => (
              <option key={k} value={k}>
                {VIEW_LABEL[k]}
              </option>
            ))}
          </select>
          <IconChevronDown size={14} />
        </label>

        <button className="tpl-add-btn" onClick={openNew}>
          <IconPlus size={16} /> Add template
        </button>
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
            <article
              key={t.id}
              className={`tpl-card tpl-card--${tier}`}
              onClick={() => setDetailId(t.id)}
            >
              <div className="tpl-card__body">
                <div className="tpl-card__top">
                  <span className={`tpl-rate tpl-rate--${tier}`}>
                    {tier === "draft" ? "NEW DRAFT" : `${rate}% HIT RATE`}
                  </span>
                  <div
                    className="tpl-card__menu"
                    onClick={(e) => e.stopPropagation()}
                  >
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
                          <>
                            <button onClick={() => openEdit(t)}>Edit tags & author</button>
                            <button onClick={() => openDuplicate(t)}>
                              Duplicate
                            </button>
                          </>
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
                {knownAuthors(t.authors).length > 0 && (
                  <div className="tpl-tag-list">
                    {knownAuthors(t.authors).map((author) => (
                      <button
                        key={author}
                        type="button"
                        className="tpl-tag tpl-author"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAuthorFilter(author);
                        }}
                      >
                        {authorLabel(author)}
                      </button>
                    ))}
                  </div>
                )}
                {t.tags.length > 0 && (
                  <div className="tpl-tag-list">
                    {t.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="tpl-tag"
                        onClick={(e) => {
                          e.stopPropagation();
                          focusTag(tag);
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}

                <div className="tpl-card__preview">
                  <div className="tpl-card__preview-text">{renderBody(t.body)}</div>
                </div>

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

                <div
                  className="tpl-card__actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.sent === 0 ? (
                    <button className="tpl-btn" onClick={() => openEdit(t)}>
                      Edit
                    </button>
                  ) : (
                    <>
                      <button className="tpl-btn" onClick={() => openEdit(t)}>
                        Edit tags & author
                      </button>
                      <button
                        className="tpl-btn"
                        onClick={() => openDuplicate(t)}
                        title="Live templates are locked — duplicate to change the message"
                      >
                        Duplicate
                      </button>
                    </>
                  )}
                  <button
                    className="tpl-btn tpl-btn--muted"
                    onClick={() => handleArchive(t.id)}
                  >
                    Archive
                  </button>
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

      {detail && (
        <div className="tpl-modal-backdrop" onClick={() => setDetailId(null)}>
          <div
            className="tpl-modal tpl-modal--detail"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tpl-modal__header">
              <h2>
                {detail.name}
                {detail.sent > 0 && <span className="tpl-live">LIVE</span>}
              </h2>
              <button
                className="icon-btn icon-btn--ghost"
                onClick={() => setDetailId(null)}
                aria-label="Close"
              >
                <IconX size={15} />
              </button>
            </div>

            <div className="tpl-detail__stats">
              <div>
                <span>HIT RATE</span>
                <strong>
                  {detail.sent > 0
                    ? `${Math.round(detail.reply_rate * 1000) / 10}%`
                    : "—"}
                </strong>
              </div>
              <div>
                <span>SENT</span>
                <strong>{detail.sent}</strong>
              </div>
              <div>
                <span>REPLIED</span>
                <strong>{detail.replied}</strong>
              </div>
              <div>
                <span>AVG RESPONSE</span>
                <strong>{formatHours(detail.avg_response_hours)}</strong>
              </div>
            </div>

            <div className="tpl-card__preview tpl-card__preview--full">
              {renderBody(detail.body)}
            </div>
            {knownAuthors(detail.authors).length > 0 && (
              <div className="tpl-tag-list">
                {knownAuthors(detail.authors).map((author) => (
                  <button
                    key={author}
                    type="button"
                    className="tpl-tag tpl-author"
                    onClick={() => {
                      setDetailId(null);
                      setAuthorFilter(author);
                    }}
                  >
                    {authorLabel(author)}
                  </button>
                ))}
              </div>
            )}
            {detail.tags.length > 0 && (
              <div className="tpl-tag-list">
                {detail.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="tpl-tag"
                    onClick={() => {
                      setDetailId(null);
                      focusTag(tag);
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            <div className="tpl-card__meta">
              <span>
                <IconTag size={14} /> {extractVariables(detail.body).length}{" "}
                Token{extractVariables(detail.body).length === 1 ? "" : "s"}
              </span>
              <span>{detail.body.length} chars</span>
            </div>

            <div className="tpl-detail__section">
              Used on ({detail.conversations.length})
            </div>
            {detail.conversations.length === 0 ? (
              <p className="empty-state">Not sent to anyone yet.</p>
            ) : (
              <ul className="tpl-convos">
                {detail.conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      className="tpl-convo"
                      onClick={() => navigate(`/inbox?conversationId=${c.id}`)}
                      title="Open in inbox"
                    >
                      <PlatformBadge platform={c.platform} />
                      <span className="tpl-convo__who">
                        {c.participant_name || c.participant_handle}
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
              {detail.sent === 0 ? (
                <button
                  className="tpl-btn"
                  onClick={() => {
                    setDetailId(null);
                    openEdit(detail);
                  }}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    className="tpl-btn"
                    onClick={() => {
                      setDetailId(null);
                      openEdit(detail);
                    }}
                  >
                    Edit tags & author
                  </button>
                  <button
                    className="tpl-btn"
                    onClick={() => {
                      setDetailId(null);
                      openDuplicate(detail);
                    }}
                    title="Live templates are locked — duplicate to change the message"
                  >
                    Duplicate
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
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
              <h2>
                {editingId != null
                  ? textLocked
                    ? "Edit tags & author"
                    : "Edit template"
                  : "New template"}
              </h2>
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
              readOnly={textLocked}
              autoFocus
            />
            <textarea
              placeholder="Message body — use {{first_name}}-style placeholders"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              readOnly={textLocked}
            />
            <AuthorSelect value={authors} onChange={setAuthors} />
            <div className="tpl-tag-field">
              <span className="tpl-tag-field__label">Tags</span>
              {tags.length > 0 && (
                <div className="tpl-tag-list">
                  {tags.map((tag) => (
                    <span key={tag} className="tpl-tag">
                      {tag}
                      <button
                        type="button"
                        className="tpl-tag__remove"
                        aria-label={`Remove ${tag}`}
                        onClick={() =>
                          setTags((current) => current.filter((item) => item !== tag))
                        }
                      >
                        <IconX size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                placeholder="Add a tag, like opener or follow-up, then press Enter"
                value={tagDraft}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.includes(",")) addTag(value);
                  else setTagDraft(value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagDraft);
                  }
                }}
              />
              {tagsInUse(active)
                .filter((tag) => !tags.some((item) => item.toLowerCase() === tag.toLowerCase()))
                .length > 0 && (
                <div className="tpl-tag-suggest">
                  {tagsInUse(active)
                    .filter((tag) => !tags.some((item) => item.toLowerCase() === tag.toLowerCase()))
                    .map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="tpl-tag tpl-tag--add"
                        onClick={() => addTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <p className="tpl-modal__hint">
              Tags group a kind of prompt so the list can be filtered. Author
              can be John, Justin, or both. Use {"{{variable}}"} placeholders
              (e.g. {"{{first_name}}"}) for anything that changes per
              recipient. Once a template has been sent, the message is locked
              — tags and author can still be changed, and duplicate copies the
              text.
            </p>
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
                  {textLocked ? "Save tags & author" : editingId != null ? "Save changes" : "Add template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
