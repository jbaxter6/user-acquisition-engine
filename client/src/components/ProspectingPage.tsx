import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type {
  MessageTemplate,
  Platform,
  Prospect,
} from "../types";
import {
  applyMapping,
  autoMapColumns,
  detectWideLayout,
  downloadProspectTemplate,
  expandWideRows,
  FIELD_LABELS,
  parseSpreadsheet,
  PROSPECT_FIELDS,
  type MappedProspect,
  type ParsedSheet,
  type WideExpansion,
  type ProspectField,
} from "../lib/prospectImport";
import { Avatar } from "./Avatar";
import { PlatformBadge } from "./PlatformBadge";
import { PlatformIcon } from "./PlatformIcon";
import {
  IconDownload,
  IconFilter,
  IconGrid,
  IconList,
  IconSearch,
  IconShield,
  IconUpload,
  IconX,
  Spinner,
} from "./icons";
import { formatRelativeTime } from "../lib/relativeTime";

function highlightProspectCard(id: number): boolean {
  const el = document.getElementById(`prospect-card-${id}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("prospect-card--highlight");
  setTimeout(() => el.classList.remove("prospect-card--highlight"), 1500);
  return true;
}

// Cards load in pages, so the target may not be in the DOM yet; the page
// listens for this event and narrows the list to that prospect if needed.
function scrollToProspectCard(id: number, username: string) {
  if (highlightProspectCard(id)) return;
  window.dispatchEvent(
    new CustomEvent("reveal-prospect", { detail: { id, username } }),
  );
}

// YouTube handles are stored bare ("mychannel"); channel IDs ("UC" + 22
// chars) have no @-handle form and need the /channel/ path.
function youtubeChannelUrl(username: string): string {
  const id = username.replace(/^@/, "");
  return /^UC[\w-]{22}$/.test(id)
    ? `https://www.youtube.com/channel/${id}`
    : `https://www.youtube.com/@${encodeURIComponent(id)}`;
}

function profileUrl(platform: Platform, username: string): string {
  const handle = encodeURIComponent(username.replace(/^@/, ""));
  if (platform === "tiktok") return `https://www.tiktok.com/@${handle}`;
  if (platform === "twitch") return `https://www.twitch.tv/${handle}`;
  if (platform === "youtube") return youtubeChannelUrl(username);
  return `https://www.instagram.com/${handle}/`;
}

const STATUS_LABEL: Record<Prospect["status"], string> = {
  new: "Not Contacted",
  contacted: "Messaged",
  replied: "Responded",
  closed: "Closed",
};

const STATUS_FILTERS: Array<{
  label: string;
  value: Prospect["status"] | "all";
}> = [
  { label: "All", value: "all" },
  { label: "Not Contacted", value: "new" },
  { label: "Awaiting Reply", value: "contacted" },
  { label: "Replied", value: "replied" },
];

const PLATFORM_FILTERS: Array<{ label: string; value: Platform | "all" }> = [
  { label: "All platforms", value: "all" },
  { label: "Instagram", value: "instagram" },
  { label: "TikTok", value: "tiktok" },
  { label: "Twitch", value: "twitch" },
  { label: "YouTube", value: "youtube" },
];

type SortKey = "recent" | "newest" | "name";
const SORT_LABEL: Record<SortKey, string> = {
  recent: "Recent Activity",
  newest: "Newest",
  name: "Name A–Z",
};

const PAGE_SIZE = 24;
const MAX_THREADS_SHOWN = 3;

export function ProspectingPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  // Opens on "Not Contacted" — the prospects ready for first outreach.
  const [statusFilter, setStatusFilter] = useState<Prospect["status"] | "all">(
    "new",
  );
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [fabOpen, setFabOpen] = useState(false);
  const importPanelRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<
    Partial<Record<ProspectField, string>>
  >({});
  // Set when the sheet is one-row-per-creator (Instagram/TikTok/... columns);
  // then there's nothing to map, just a summary and Import.
  const [wide, setWide] = useState<WideExpansion | null>(null);
  const [defaultPlatform, setDefaultPlatform] = useState<Platform>("instagram");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({
    all: 0,
    new: 0,
    contacted: 0,
    replied: 0,
    closed: 0,
  });
  const [pipeline, setPipeline] = useState({ all: 0, contacted: 0 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const prospectsRef = useRef<Prospect[]>([]);
  prospectsRef.current = prospects;
  const revealRef = useRef<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const queryParams = () => ({
    status: statusFilter === "all" ? undefined : statusFilter,
    platform: platformFilter === "all" ? undefined : platformFilter,
    q: debouncedSearch || undefined,
    sort,
  });

  // Loads `limit` rows from `offset`; offset 0 replaces the list, anything
  // else appends. Stale responses (filters changed mid-flight) are dropped.
  const load = async (offset: number, limit = PAGE_SIZE) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const page = await api.listProspects({ ...queryParams(), limit, offset });
      if (requestId !== requestRef.current) return;
      setTotal(page.total);
      setProspects((current) =>
        offset === 0 ? page.items : [...current, ...page.items],
      );
    } catch (e) {
      if (requestId === requestRef.current) setError(String(e));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  const loadCounts = () => {
    api
      .prospectCounts({
        platform: platformFilter === "all" ? undefined : platformFilter,
        q: debouncedSearch || undefined,
      })
      .then(setCounts)
      .catch(() => {});
    api
      .prospectCounts()
      .then((c) => setPipeline({ all: c.all, contacted: c.contacted }))
      .catch(() => {});
  };

  // After an edit/sync, re-fetch everything already on screen so the
  // scroll position and loaded pages survive.
  const refresh = () => {
    void load(0, Math.max(prospectsRef.current.length, PAGE_SIZE));
    loadCounts();
  };

  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, platformFilter, debouncedSearch, sort]);

  useEffect(() => {
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformFilter, debouncedSearch]);

  useEffect(() => {
    window.addEventListener("accounts-synced", refresh);
    return () => window.removeEventListener("accounts-synced", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, platformFilter, debouncedSearch, sort]);

  const hasMore = prospects.length < total;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          void load(prospectsRef.current.length);
        }
      },
      // Root is the page's own scroll container so the margin pre-loads
      // the next page before the user reaches the bottom.
      { root: el.closest(".prospecting"), rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasMore, statusFilter, platformFilter, debouncedSearch, sort]);

  // "View card" on a linked prospect that hasn't been loaded yet: clear the
  // filters and search for it so it's guaranteed to be on the first page.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const { id, username } = (e as CustomEvent<{ id: number; username: string }>)
        .detail;
      revealRef.current = id;
      setStatusFilter("all");
      setPlatformFilter("all");
      setSearch(username);
      setDebouncedSearch(username);
    };
    window.addEventListener("reveal-prospect", onReveal);
    return () => window.removeEventListener("reveal-prospect", onReveal);
  }, []);

  useEffect(() => {
    if (revealRef.current == null) return;
    if (highlightProspectCard(revealRef.current)) revealRef.current = null;
  }, [prospects]);

  useEffect(() => {
    api
      .listTemplates()
      .then(setTemplates)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (sheet) {
      importPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sheet]);

  const handleFile = async (file: File) => {
    setImportResult(null);
    setFabOpen(false);
    const buffer = await file.arrayBuffer();
    const parsed = await parseSpreadsheet(buffer);
    setSheet(parsed);
    setMapping(autoMapColumns(parsed.headers));
    const layout = detectWideLayout(parsed.headers);
    setWide(layout ? expandWideRows(parsed.rows, layout) : null);
  };

  const handleImport = async () => {
    if (!sheet) return;
    const mapped: MappedProspect[] = wide
      ? wide.prospects
      : applyMapping(sheet.rows, mapping, defaultPlatform);
    if (mapped.length === 0) {
      setImportResult(
        wide
          ? "No valid rows — none of the social links had a usable handle."
          : "No valid rows — make sure a Username column is mapped.",
      );
      return;
    }
    setImporting(true);
    try {
      const result = await api.bulkImportProspects(mapped);
      setImportResult(
        `Imported ${result.inserted} new prospect(s), skipped ${result.skipped} already on file.`,
      );
      setSheet(null);
      setWide(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
    } catch (err) {
      setImportResult(`Import failed: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const countFor = (status: Prospect["status"] | "all") => counts[status];

  return (
    <div className="prospecting">
      <section className="prospecting-toolbar">
        <div className="prospecting-toolbar__row prospecting-toolbar__filters">
          <div className="filter-pills">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                className={
                  f.value === statusFilter
                    ? "filter-pill filter-pill--active"
                    : "filter-pill"
                }
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
                <span
                  className={`filter-pill__count filter-pill__count--${f.value}`}
                >
                  {countFor(f.value)}
                </span>
              </button>
            ))}
          </div>

          <label className="toolbar-select">
            <IconGrid size={14} />
            <select
              value={platformFilter}
              onChange={(e) =>
                setPlatformFilter(e.target.value as Platform | "all")
              }
            >
              {PLATFORM_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <div className="prospecting-toolbar__spacer" />

          <label className="toolbar-search">
            <IconSearch size={15} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search handle, name, brand"
            />
          </label>

          <label className="toolbar-select">
            <IconFilter size={14} />
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
          </label>

          <div className="view-toggle">
            <button
              className={view === "grid" ? "view-toggle--active" : ""}
              onClick={() => setView("grid")}
              title="Grid view"
              aria-label="Grid view"
            >
              <IconGrid size={16} />
            </button>
            <button
              className={view === "list" ? "view-toggle--active" : ""}
              onClick={() => setView("list")}
              title="List view"
              aria-label="List view"
            >
              <IconList size={16} />
            </button>
          </div>
        </div>
      </section>

      {(sheet || importResult) && (
      <div ref={importPanelRef}>
      {sheet && wide && (
        <section className="prospecting__import">
          <div className="prospecting__mapping">
            <p className="prospecting__hint">
              One-row-per-creator sheet detected: {wide.creators} creator(s) →{" "}
              {wide.prospects.length} prospect(s) ({wide.byPlatform.instagram}{" "}
              Instagram, {wide.byPlatform.tiktok} TikTok, {wide.byPlatform.twitch}{" "}
              Twitch, {wide.byPlatform.youtube} YouTube).
            </p>
            <button onClick={handleImport} disabled={importing || wide.prospects.length === 0}>
              {importing ? "Importing..." : `Import ${wide.prospects.length} prospect(s)`}
            </button>{" "}
            <button onClick={() => setWide(null)} disabled={importing}>
              Map columns manually instead
            </button>
          </div>
        </section>
      )}

      {sheet && !wide && (
        <section className="prospecting__import">
          <div className="prospecting__mapping">
            <p className="prospecting__hint">
              {sheet.rows.length} row(s) found. Map each field to a column:
            </p>

            <label className="prospecting__mapping-row">
              <span>
                Default platform (used when no Platform column is mapped, or a
                row's value isn't recognized)
              </span>
              <select
                value={defaultPlatform}
                onChange={(e) => setDefaultPlatform(e.target.value as Platform)}
              >
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="twitch">Twitch</option>
                <option value="youtube">YouTube</option>
              </select>
            </label>

            <div className="prospecting__mapping-grid">
              {PROSPECT_FIELDS.map((field) => (
                <label key={field} className="prospecting__mapping-row">
                  <span>{FIELD_LABELS[field]}</span>
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [field]: e.target.value || undefined,
                      }))
                    }
                  >
                    <option value="">— none —</option>
                    {sheet.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              onClick={handleImport}
              disabled={importing || !mapping.username}
            >
              {importing
                ? "Importing..."
                : `Import ${sheet.rows.length} row(s)`}
            </button>
          </div>
        </section>
      )}

      {importResult && <p className="prospecting__hint">{importResult}</p>}
      </div>
      )}
      {error && <div className="app__error">{error}</div>}

      <section className="prospecting__list">
        <div
          className={
            view === "list"
              ? "prospecting__cards prospecting__cards--list"
              : "prospecting__cards"
          }
        >
          {!loading && prospects.length === 0 && (
            <p className="empty-state">
              {pipeline.all === 0
                ? "No prospects yet — import a sheet to get started."
                : "No prospects match your filters."}
            </p>
          )}
          {prospects.map((p) => (
            <ProspectCard
              key={p.id}
              prospect={p}
              templates={templates}
              showStatusChip={statusFilter === "all"}
              onChange={refresh}
            />
          ))}
        </div>
        <div ref={sentinelRef} className="prospecting__sentinel">
          {loading && prospects.length > 0 && (
            <span className="prospecting__loading">
              <Spinner size={14} /> Loading more…
            </span>
          )}
          {!hasMore && prospects.length > 0 && (
            <span className="prospecting__end">
              Showing all {total} prospect{total === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <div className="import-fab">
        {fabOpen && (
          <div className="import-fab__menu">
            <button onClick={() => fileInputRef.current?.click()}>
              <IconUpload size={15} /> Upload CSV / Excel
            </button>
            <button onClick={() => downloadProspectTemplate()}>
              <IconDownload size={14} /> Download template
            </button>
            <span className="import-fab__note">
              <IconShield size={13} /> Auto-skips duplicates
            </span>
          </div>
        )}
        <button
          className="import-fab__btn"
          onClick={() => setFabOpen((o) => !o)}
          aria-label="Import prospects"
          aria-expanded={fabOpen}
        >
          {fabOpen ? <IconX size={18} /> : <IconUpload size={18} />}
          {!fabOpen && <span>Import</span>}
        </button>
      </div>
    </div>
  );
}

const ROLE_OPTIONS = [
  "manager",
  "agent",
  "assistant",
  "owner",
  "primary",
  "other",
];

function LinkPicker({
  excludeKeys,
  showRole,
  onSubmit,
  onCancel,
}: {
  excludeKeys: Set<string>;
  showRole: boolean;
  onSubmit: (input: {
    platform: Platform;
    username: string;
    role?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("manager");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryTrimmed = query.trim();
  const [candidates, setCandidates] = useState<Prospect[]>([]);
  const [searching, setSearching] = useState(false);

  // Searches the whole prospect table server-side (not just what's loaded on
  // the page); over-fetches a little since already-linked ones are dropped.
  useEffect(() => {
    if (!queryTrimmed) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const id = setTimeout(() => {
      api
        .listProspects({ q: queryTrimmed, limit: 20, sort: "name" })
        .then((page) => {
          if (!cancelled) setCandidates(page.items);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [queryTrimmed]);

  const matches = candidates
    .filter(
      (candidate) =>
        !excludeKeys.has(
          `${candidate.platform}:${candidate.username.toLowerCase()}`,
        ),
    )
    .slice(0, 6);

  const submit = async (p: Platform, u: string) => {
    if (!u.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        platform: p,
        username: u.trim(),
        role: showRole ? role : undefined,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="prospect-card__link-form">
      <div className="prospect-card__link-mode">
        <button
          type="button"
          className={
            mode === "search"
              ? "prospect-tab prospect-tab--active"
              : "prospect-tab"
          }
          onClick={() => setMode("search")}
        >
          Find existing
        </button>
        <button
          type="button"
          className={
            mode === "new"
              ? "prospect-tab prospect-tab--active"
              : "prospect-tab"
          }
          onClick={() => setMode("new")}
        >
          Add new
        </button>
      </div>

      {showRole && (
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
      )}

      {mode === "search" ? (
        <div className="prospect-card__link-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prospects by name or @handle…"
            autoFocus
          />
          {queryTrimmed && (
            <ul className="prospect-card__link-results">
              {matches.length === 0 ? (
                <li className="prospect-card__link-empty">
                  {searching ? "Searching…" : "No matching prospects."}
                </li>
              ) : (
                matches.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className="prospect-card__link-result"
                      disabled={submitting}
                      onClick={() =>
                        submit(candidate.platform, candidate.username)
                      }
                    >
                      <PlatformBadge platform={candidate.platform} />
                      <span>
                        {candidate.display_name || candidate.username}
                      </span>
                      <span className="prospect-card__handle-dim">
                        @{candidate.username}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : (
        <div className="prospect-card__link-new">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          >
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="twitch">Twitch</option>
            <option value="youtube">YouTube</option>
          </select>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@username"
          />
          <div className="prospect-card__composer-actions">
            <button
              onClick={() => submit(platform, username)}
              disabled={submitting || !username.trim()}
            >
              {submitting ? "Linking…" : "Link"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="composer-note">{error}</p>}
      <div className="prospect-card__composer-actions">
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProspectCard({
  prospect,
  templates,
  showStatusChip,
  onChange,
}: {
  prospect: Prospect;
  templates: MessageTemplate[];
  // Redundant when the list is already filtered to a single status.
  showStatusChip: boolean;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"outreach" | "accounts">("outreach");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [text, setText] = useState("");
  const [linkingChannel, setLinkingChannel] = useState(false);
  const [linkingManager, setLinkingManager] = useState(false);

  const messagedAt =
    prospect.first_outbound_message?.created_at ?? prospect.contacted_at;
  const outboundThreads = (prospect.threads ?? []).filter(
    (t) => t.first_outbound,
  );
  const existingConversationId =
    prospect.existing_conversation_id ?? prospect.conversation_id ?? null;

  const links = prospect.links ?? [];
  const legacyContacts = prospect.contacts ?? [];
  const tiedProfiles = links.filter((l) => l.relationship === "linked");
  const managerLinks = links.filter((l) =>
    ROLE_OPTIONS.includes(l.relationship),
  );
  const otherConnections = links.filter((l) =>
    l.relationship.startsWith("managed_by:"),
  );

  const selfKey = `${prospect.platform}:${prospect.username.toLowerCase()}`;
  const tiedKeys = new Set(
    tiedProfiles.map((l) => `${l.platform}:${l.username.toLowerCase()}`),
  );
  tiedKeys.add(selfKey);
  const managerKeys = new Set(
    managerLinks.map((l) => `${l.platform}:${l.username.toLowerCase()}`),
  );
  managerKeys.add(selfKey);

  const handleTemplatePick = (value: string) => {
    const id = value ? Number(value) : "";
    setTemplateId(id);
    if (id !== "") {
      const template = templates.find((t) => t.id === id);
      if (template) setText(template.body);
    }
  };

  // Instagram has a true DM deep link. TikTok doesn't (to our knowledge), so
  // this lands on the profile, one click from its Message button.
  const DM_LINKS: Partial<Record<Platform, { label: string; url: (u: string) => string }>> = {
    instagram: { label: "Instagram", url: (u) => `https://ig.me/m/${u}` },
    tiktok: { label: "TikTok", url: (u) => `https://www.tiktok.com/@${u}` },
    // YouTube has no DMs; the About tab is where creators list a business email.
    youtube: { label: "YouTube", url: (u) => `${youtubeChannelUrl(u)}/about` },
  };
  const dmLink = DM_LINKS[prospect.platform];

  const handleOpenDm = () => {
    const username = prospect.username?.replace(/^@/, "");
    if (!dmLink || !username || !text.trim()) return;
    // Kick off the clipboard write without awaiting so window.open still
    // runs inside the click's user-gesture window (Safari blocks it otherwise).
    navigator.clipboard?.writeText(text.trim()).catch(() => {});
    window.open(dmLink.url(username), "_blank", "noopener,noreferrer");
  };

  const handleLinkChannel = async ({
    platform,
    username,
  }: {
    platform: Platform;
    username: string;
  }) => {
    await api.linkProspectChannel(prospect.id, platform, username);
    setLinkingChannel(false);
    onChange();
  };

  const handleLinkManager = async ({
    platform,
    username,
    role,
  }: {
    platform: Platform;
    username: string;
    role?: string;
  }) => {
    await api.linkProspectManager(
      prospect.id,
      platform,
      username,
      role ?? "manager",
    );
    setLinkingManager(false);
    onChange();
  };

  return (
    <div className="prospect-card" id={`prospect-card-${prospect.id}`}>
      <div className="prospect-card__header">
        <span className="prospect-card__avatar-wrap">
          <Avatar
            src={prospect.avatar_url ?? null}
            label={prospect.display_name || prospect.username}
            size={52}
            engaged={Boolean(prospect.has_engaged)}
          />
          <span className="prospect-card__avatar-badge">
            <PlatformIcon platform={prospect.platform} size={16} />
          </span>
        </span>
        <div className="prospect-card__identity">
          <span className="prospect-card__name">
            {prospect.display_name || prospect.username}
          </span>
          <a
            className="prospect-card__handle"
            href={profileUrl(prospect.platform, prospect.username)}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{prospect.username}
          </a>
        </div>
      </div>

      {(messagedAt || showStatusChip) && (
        <div className="prospect-card__pills">
          {messagedAt && (
            <span className="pill pill--info">
              Messaged · {formatRelativeTime(messagedAt)}
            </span>
          )}
          {showStatusChip && (
            <span className={`pill pill--status-${prospect.status}`}>
              {STATUS_LABEL[prospect.status]}
            </span>
          )}
        </div>
      )}

      {(prospect.followers != null || prospect.notes) && (
        <div className="prospect-card__about">
          {prospect.followers != null && (
            <p className="prospect-card__meta">
              {prospect.followers.toLocaleString()} followers
            </p>
          )}
          {prospect.notes && (
            <p className="prospect-card__notes" title={prospect.notes}>
              {prospect.notes}
            </p>
          )}
        </div>
      )}

      <div className="prospect-card__tabs">
        <button
          className={
            tab === "outreach"
              ? "prospect-tab prospect-tab--active"
              : "prospect-tab"
          }
          onClick={() => setTab("outreach")}
        >
          Outreach &amp; DM
        </button>
        <button
          className={
            tab === "accounts"
              ? "prospect-tab prospect-tab--active"
              : "prospect-tab"
          }
          onClick={() => setTab("accounts")}
        >
          Connected Accounts
          {links.length > 0 && (
            <span className="prospect-tab__count">({links.length})</span>
          )}
        </button>
      </div>

      {tab === "outreach" ? (
        <div className="prospect-card__outreach">
          {existingConversationId != null ? (
            <>
              {outboundThreads.length === 0 && (
                <div className="prospect-card__existing-thread">
                  <div className="prospect-card__initial-message prospect-card__initial-message--empty">
                    No outbound message yet — they messaged you first.
                  </div>
                  <button
                    className="prospect-card__cta"
                    onClick={() =>
                      navigate(`/inbox?conversationId=${existingConversationId}`)
                    }
                  >
                    Continue in inbox
                  </button>
                </div>
              )}
              {outboundThreads.slice(0, MAX_THREADS_SHOWN).map((thread) => {
                const first = thread.first_outbound!;
                const accountName = thread.account?.username
                  ? `@${thread.account.username}`
                  : null;
                return (
                  <div
                    key={thread.conversation_id}
                    className="prospect-card__existing-thread"
                  >
                    <div className="prospect-card__thread-chips">
                      <span
                        className={
                          first.template_name
                            ? "prospect-card__template-tag"
                            : "prospect-card__template-tag prospect-card__template-tag--custom"
                        }
                      >
                        {first.template_name ?? "Custom Message"}
                      </span>
                      {thread.account && (
                        <Avatar
                          src={thread.account.profile_picture_url}
                          label={thread.account.username ?? "Account"}
                          title={
                            accountName
                              ? `Sent from ${accountName}`
                              : "Sent from a connected account"
                          }
                          size={22}
                        />
                      )}
                    </div>
                    <span className="prospect-card__existing-label">
                      Initial outbound message
                      {` · ${formatRelativeTime(first.created_at)}`}
                    </span>
                    <div
                      className="prospect-card__initial-message"
                      title="Open the inbox thread to read the full message"
                    >
                      <span className="prospect-card__initial-text">
                        {first.text}
                      </span>
                    </div>
                    <button
                      className="prospect-card__cta"
                      onClick={() =>
                        navigate(`/inbox?conversationId=${thread.conversation_id}`)
                      }
                    >
                      Continue in inbox
                    </button>
                  </div>
                );
              })}
              {outboundThreads.length > MAX_THREADS_SHOWN && (
                <p className="composer-note">
                  +{outboundThreads.length - MAX_THREADS_SHOWN} more thread
                  {outboundThreads.length - MAX_THREADS_SHOWN === 1 ? "" : "s"}{" "}
                  from other accounts — see them in the inbox.
                </p>
              )}
            </>
          ) : (
            <>
          {templates.length > 0 ? (
            <label className="prospect-card__field">
              <span>Message template</span>
              <select
                value={templateId}
                onChange={(e) => handleTemplatePick(e.target.value)}
              >
                <option value="">Select a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="composer-note">
              No message templates yet — create one on the Templates page before
              messaging prospects.
            </p>
          )}

          <div className="prospect-card__textarea-wrap">
            <textarea
              value={text}
              readOnly
              rows={5}
              placeholder="Select a template above…"
            />
            <span className="prospect-card__char-count">
              {text.length} chars
            </span>
          </div>

          {dmLink && (
            <div className="prospect-card__outreach-actions">
              <button
                className="prospect-card__open-btn"
                onClick={handleOpenDm}
                disabled={!prospect.username || templateId === "" || !text.trim()}
                title={
                  templateId === ""
                    ? "Select a template first"
                    : prospect.platform === "tiktok"
                      ? "Copies the template text, then opens their TikTok profile — tap Message and paste"
                      : prospect.platform === "youtube"
                        ? "Copies the template text, then opens their channel's About tab (business email / contact)"
                        : "Copies the template text, then opens the DM"
                }
              >
                Copy &amp; open in {dmLink.label}
              </button>
            </div>
          )}

          {!dmLink && (
            <p className="composer-note">
              No {prospect.platform} account integration yet — send from that
              platform's app directly.
            </p>
          )}
            </>
          )}
        </div>
      ) : (
        <div className="prospect-card__accounts">
          <div className="prospect-card__section-title">
            Tied social profiles ({tiedProfiles.length})
          </div>

          {tiedProfiles.length === 0 && !linkingChannel && (
            <button
              type="button"
              className="prospect-card__empty-linked prospect-card__empty-linked--clickable"
              onClick={() => setLinkingChannel(true)}
            >
              <span className="prospect-card__empty-linked-plus">+</span>
              <p className="prospect-card__empty-linked-title">
                No social accounts tied yet
              </p>
              <p className="prospecting__hint">
                Link additional Instagram, TikTok, Twitch, or YouTube handles to sync
                cross-platform communication.
              </p>
            </button>
          )}

          {tiedProfiles.length > 0 && (
            <div className="prospect-card__channel-grid">
              {tiedProfiles.map((link) => (
                <div key={link.id} className="prospect-card__channel-card">
                  <PlatformBadge platform={link.platform} />
                  <span className="prospect-card__channel-username">
                    {link.display_name || link.username}
                  </span>
                  <span className={`pill pill--status-${link.status}`}>
                    {STATUS_LABEL[link.status]}
                  </span>
                  <button
                    className="secondary"
                    onClick={() => scrollToProspectCard(link.id, link.username)}
                  >
                    View card
                  </button>
                  <button
                    className="secondary prospect-card__unlink"
                    title="Remove link"
                    onClick={async () => {
                      await api.unlinkProspect(prospect.id, link.id);
                      onChange();
                    }}
                  >
                    <IconX size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {tiedProfiles.length > 0 && !linkingChannel && (
            <button
              className="secondary"
              onClick={() => setLinkingChannel(true)}
            >
              + Link another account
            </button>
          )}

          {linkingChannel && (
            <LinkPicker
              excludeKeys={tiedKeys}
              showRole={false}
              onCancel={() => setLinkingChannel(false)}
              onSubmit={handleLinkChannel}
            />
          )}

          <div className="prospect-card__section-title">
            Connected managers &amp; reps (
            {managerLinks.length + legacyContacts.length})
          </div>

          {managerLinks.length === 0 &&
            legacyContacts.length === 0 &&
            !linkingManager && (
              <button
                type="button"
                className="prospect-card__empty-linked prospect-card__empty-linked--clickable"
                onClick={() => setLinkingManager(true)}
              >
                <span className="prospect-card__empty-linked-plus">+</span>
                <p className="prospect-card__empty-linked-title">
                  No managers or reps yet
                </p>
                <p className="prospecting__hint">
                  Link a manager, agent, or brand contact's own prospect card to
                  keep track of who you're actually talking to.
                </p>
              </button>
            )}

          {(managerLinks.length > 0 || legacyContacts.length > 0) && (
            <ul className="prospect-card__contact-list">
              {managerLinks.map((link) => (
                <li key={`link-${link.id}`}>
                  <Avatar
                    src={null}
                    label={link.display_name || link.username}
                    size={28}
                  />
                  <span className="prospect-card__contact-info">
                    <span className="prospect-card__contact-name">
                      {link.display_name || link.username}
                      <span className="prospect-card__contact-role">
                        {link.relationship}
                      </span>
                    </span>
                    <span className="prospect-card__handle-dim">
                      @{link.username}
                    </span>
                  </span>
                  <button
                    className="secondary"
                    onClick={() => scrollToProspectCard(link.id, link.username)}
                  >
                    View card
                  </button>
                  <button
                    className="secondary prospect-card__unlink"
                    title="Remove link"
                    onClick={async () => {
                      await api.unlinkProspect(prospect.id, link.id);
                      onChange();
                    }}
                  >
                    <IconX size={12} />
                  </button>
                </li>
              ))}
              {legacyContacts.map((contact) => (
                <li key={`contact-${contact.id}`}>
                  <Avatar
                    src={null}
                    label={contact.name || contact.handle}
                    size={28}
                  />
                  <span className="prospect-card__contact-info">
                    <span className="prospect-card__contact-name">
                      {contact.name || contact.handle}
                      {contact.role && (
                        <span className="prospect-card__contact-role">
                          {contact.role}
                        </span>
                      )}
                    </span>
                    <span className="prospect-card__handle-dim">
                      @{contact.handle}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(managerLinks.length > 0 || legacyContacts.length > 0) &&
            !linkingManager && (
              <button
                className="secondary"
                onClick={() => setLinkingManager(true)}
              >
                + Link another manager
              </button>
            )}

          {linkingManager && (
            <LinkPicker
              excludeKeys={managerKeys}
              showRole={true}
              onCancel={() => setLinkingManager(false)}
              onSubmit={handleLinkManager}
            />
          )}

          {otherConnections.length > 0 && (
            <>
              <div className="prospect-card__section-title">
                Other connections ({otherConnections.length})
              </div>
              <ul className="prospect-card__contact-list">
                {otherConnections.map((link) => {
                  const role = link.relationship.split(":")[1] || "manager";
                  return (
                    <li key={link.id}>
                      <Avatar
                        src={null}
                        label={link.display_name || link.username}
                        size={28}
                      />
                      <span className="prospect-card__contact-info">
                        <span className="prospect-card__contact-name">
                          {link.display_name || link.username}
                          <span className="prospect-card__contact-role">
                            {role[0].toUpperCase() + role.slice(1)} for this
                            account
                          </span>
                        </span>
                        <span className="prospect-card__handle-dim">
                          @{link.username}
                        </span>
                      </span>
                      <button
                        className="secondary"
                        onClick={() => scrollToProspectCard(link.id, link.username)}
                      >
                        View card
                      </button>
                      <button
                        className="secondary prospect-card__unlink"
                        title="Remove link"
                        onClick={async () => {
                          await api.unlinkProspect(prospect.id, link.id);
                          onChange();
                        }}
                      >
                        <IconX size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
