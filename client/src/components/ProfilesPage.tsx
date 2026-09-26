import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { AttributeRegistry, Platform, TargetProfile } from "../types";
import { describeCriterion } from "../lib/profileCriteria";
import { formatRelativeTime } from "../lib/relativeTime";
import { IconPlus, IconSearch } from "./icons";
import { PlatformBadge } from "./PlatformBadge";
import { ProfileEditor } from "./ProfileEditor";
import { apiErrorMessage } from "../lib/apiError";

const FILTERS: { value: Platform | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "twitch", label: "Twitch" },
  { value: "youtube", label: "YouTube" },
];

const PREVIEW_CHIPS = 3;

// Profiles: saved per-platform criteria describing who we want to reach.
// Phase 1 of docs/profiles-architecture.md — define and manage them. Later
// phases match prospects against them and drive Discovery from them.
export function ProfilesPage() {
  const [params, setParams] = useSearchParams();
  const [profiles, setProfiles] = useState<TargetProfile[]>([]);
  const [registry, setRegistry] = useState<AttributeRegistry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [search, setSearch] = useState("");
  // Bumped to remount the editor with fresh state (after save / switching).
  const [editorKey, setEditorKey] = useState(0);
  const dirtyRef = useRef(false);

  const selected = params.get("id");
  const selectedProfile =
    selected && selected !== "new"
      ? profiles.find((p) => String(p.id) === selected) ?? null
      : null;
  const editorOpen = selected === "new" || selectedProfile != null;

  const refresh = useCallback(
    () =>
      api
        .listProfiles(true)
        .then(setProfiles)
        .catch((e) => setError(apiErrorMessage(e))),
    [],
  );

  useEffect(() => {
    Promise.all([
      api.profileAttributes().then(setRegistry),
      refresh(),
    ])
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoaded(true));
  }, [refresh]);

  // Browser close / reload with unsaved edits.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const select = (id: number | "new" | null) => {
    if (String(id) === selected) return;
    if (dirtyRef.current && !confirm("Discard unsaved changes to this profile?")) return;
    dirtyRef.current = false;
    setEditorKey((k) => k + 1);
    setParams(id == null ? {} : { id: String(id) });
  };

  const upsertLocal = (p: TargetProfile) =>
    setProfiles((prev) =>
      prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [p, ...prev],
    );

  const handleSaved = (p: TargetProfile) => {
    upsertLocal(p);
    dirtyRef.current = false;
    setEditorKey((k) => k + 1);
    setParams({ id: String(p.id) }, { replace: selected === "new" });
  };

  const handleDuplicate = async (p: TargetProfile) => {
    if (dirtyRef.current && !confirm("Discard unsaved changes and duplicate the saved version?")) return;
    try {
      const copy = await api.duplicateProfile(p.id);
      upsertLocal(copy);
      dirtyRef.current = false;
      setEditorKey((k) => k + 1);
      setParams({ id: String(copy.id) });
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const handleArchive = async (p: TargetProfile) => {
    if (!confirm(`Archive "${p.name}"? You can restore it later.`)) return;
    try {
      await api.archiveProfile(p.id);
      dirtyRef.current = false;
      setParams({});
      await refresh();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const handleRestore = async (p: TargetProfile) => {
    try {
      upsertLocal(await api.restoreProfile(p.id));
      setEditorKey((k) => k + 1);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const defs = useMemo(
    () => new Map(registry?.attributes.map((a) => [a.key, a]) ?? []),
    [registry],
  );

  const active = profiles.filter((p) => !p.archived_at);
  const archived = profiles.filter((p) => p.archived_at);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: active.length };
    for (const p of active) c[p.platform] = (c[p.platform] ?? 0) + 1;
    return c;
  }, [active]);

  const q = search.trim().toLowerCase();
  const matchesSearch = (p: TargetProfile) =>
    !q ||
    p.name.toLowerCase().includes(q) ||
    (p.description ?? "").toLowerCase().includes(q) ||
    p.criteria.some((c) => {
      const def = defs.get(c.attribute);
      return def && describeCriterion(c, def).toLowerCase().includes(q);
    });
  const visible = active.filter(
    (p) => (filter === "all" || p.platform === filter) && matchesSearch(p),
  );

  const renderItem = (p: TargetProfile) => {
    const must = p.criteria.filter((c) => c.mode === "required").length;
    const nice = p.criteria.length - must;
    const chips = p.criteria.slice(0, PREVIEW_CHIPS);
    return (
      <li key={p.id}>
        <button
          type="button"
          className={
            String(p.id) === selected ? "profile-item profile-item--selected" : "profile-item"
          }
          onClick={() => select(p.id)}
          style={{ "--profile-color": p.color ?? `var(--${p.platform})` } as React.CSSProperties}
        >
          <div className="profile-item__head">
            <span className="profile-item__dot" aria-hidden="true" />
            <span className="profile-item__name">{p.name}</span>
            <PlatformBadge platform={p.platform} />
          </div>
          {chips.length > 0 ? (
            <div className="profile-item__chips">
              {chips.map((c) => {
                const def = defs.get(c.attribute);
                return (
                  def && (
                    <span
                      key={c.id}
                      className={c.mode === "required" ? "profile-chip profile-chip--must" : "profile-chip"}
                    >
                      {describeCriterion(c, def)}
                    </span>
                  )
                );
              })}
              {p.criteria.length > PREVIEW_CHIPS && (
                <span className="profile-chip profile-chip--more">
                  +{p.criteria.length - PREVIEW_CHIPS}
                </span>
              )}
            </div>
          ) : (
            <div className="profile-item__none">No criteria yet</div>
          )}
          <div className="profile-item__meta">
            {must} must · {nice} nice · edited {formatRelativeTime(p.updated_at)}
          </div>
        </button>
      </li>
    );
  };

  return (
    <div className={editorOpen ? "profiles profiles--editing" : "profiles"}>
      <aside className="profiles__list">
        <div className="profiles__list-head">
          <div>
            <h1>Profiles</h1>
            <p>Who you want to reach, per platform.</p>
          </div>
          <button type="button" className="tpl-add-btn" onClick={() => select("new")}>
            <IconPlus size={15} /> New
          </button>
        </div>

        <label className="toolbar-search profiles__search">
          <IconSearch size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search profiles"
            aria-label="Search profiles"
          />
        </label>

        <div className="profiles__filters" role="tablist" aria-label="Platform">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={filter === f.value ? "profiles__filter profiles__filter--on" : "profiles__filter"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              {counts[f.value] ? <span>{counts[f.value]}</span> : null}
            </button>
          ))}
        </div>

        {error && <div className="app__error">{error}</div>}

        <ul className="profiles__items">
          {loaded && visible.length === 0 && (
            <li className="empty-state">
              {active.length === 0 ? "No profiles yet." : "No profiles match."}
            </li>
          )}
          {visible.map(renderItem)}
        </ul>

        {archived.length > 0 && (
          <details className="profiles__archived">
            <summary>Archived ({archived.length})</summary>
            <ul className="profiles__items">{archived.map(renderItem)}</ul>
          </details>
        )}
      </aside>

      <main className="profiles__editor">
        {registry && editorOpen ? (
          <ProfileEditor
            key={`${selected}-${editorKey}`}
            profile={selectedProfile}
            defaultPlatform={filter === "all" ? "instagram" : filter}
            registry={registry}
            onSaved={handleSaved}
            onDuplicate={handleDuplicate}
            onArchive={handleArchive}
            onRestore={handleRestore}
            onDirtyChange={onDirtyChange}
            onBack={() => select(null)}
          />
        ) : (
          loaded && (
            <div className="profiles__intro">
              <h2>Describe who you're looking for</h2>
              <p>
                A profile is a set of criteria for one platform — follower range,
                engagement, niche, location, and so on. Mark each as a{" "}
                <strong>must have</strong> or a <strong>nice to have</strong>.
              </p>
              <p>
                Profiles will be used to match your prospects and, later, to
                discover new ones automatically.
              </p>
              <button type="button" onClick={() => select("new")}>
                Create a profile
              </button>
            </div>
          )
        )}
      </main>
    </div>
  );
}
