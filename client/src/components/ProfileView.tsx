import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type {
  AttributeRegistry,
  Criterion,
  ProfileSummary,
  ProspectStatus,
  TargetProfile,
} from "../types";
import { describeValue, WEIGHT_LABEL } from "../lib/profileCriteria";
import { parseServerDate } from "../lib/relativeTime";
import { apiErrorMessage } from "../lib/apiError";
import { IconLock } from "./icons";
import { PlatformIcon } from "./PlatformIcon";

const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", twitch: "Twitch", youtube: "YouTube" } as const;

const STATUS_FILTERS: { value: ProspectStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "closed", label: "Closed" },
];

interface Props {
  profile: TargetProfile;
  registry: AttributeRegistry;
  onUseAsTemplate: (profile: TargetProfile) => void;
  onArchive: (profile: TargetProfile) => void;
  onRestore: (profile: TargetProfile) => void;
  onBack: () => void;
}

// A saved profile, read-only: profiles are locked once created (see
// docs/profiles-live-view-architecture.md). Shows how many prospects on the
// profile's platform match it right now.
export function ProfileView({ profile, registry, onUseAsTemplate, onArchive, onRestore, onBack }: Props) {
  const [status, setStatus] = useState<ProspectStatus | "all">("all");
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archived = !!profile.archived_at;

  useEffect(() => {
    if (archived) return;
    let cancelled = false;
    setError(null);
    api
      .profileSummary(profile.id, status === "all" ? undefined : status)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => !cancelled && setError(apiErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [profile.id, status, archived]);

  const defs = useMemo(() => new Map(registry.attributes.map((a) => [a.key, a])), [registry]);
  const platformLabel = PLATFORM_LABEL[profile.platform];
  const created = parseServerDate(profile.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const statusLabel = status === "all" ? "" : ` ${STATUS_FILTERS.find((f) => f.value === status)?.label.toLowerCase()}`;

  const row = (c: Criterion) => {
    const def = defs.get(c.attribute);
    if (!def) return null;
    const counts = summary?.criteria[c.id];
    const known = counts ? counts.pass + counts.fail : 0;
    const hasData = def.hasData.includes(profile.platform);
    return (
      <li key={c.id} className="pv-criterion">
        <div className="pv-criterion__main">
          <span className="pv-criterion__label" title={def.description}>
            {def.label}
          </span>
          <span className="pv-criterion__value">{describeValue(c, def)}</span>
          {c.mode === "preferred" && (
            <span className="weight" title={`${WEIGHT_LABEL[c.weight ?? 2]} importance`}>
              {([1, 2, 3] as const).map((w) => (
                <span key={w} className={(c.weight ?? 2) >= w ? "weight__dot weight__dot--on" : "weight__dot"} />
              ))}
            </span>
          )}
          {!hasData && <span className="criterion__nodata">No data yet</span>}
        </div>
        {counts && summary && summary.total > 0 && !archived && (
          <div className="pv-criterion__coverage">
            <div className="pv-bar" aria-hidden="true">
              <span className="pv-bar__pass" style={{ flexGrow: counts.pass }} />
              <span className="pv-bar__fail" style={{ flexGrow: counts.fail }} />
              <span className="pv-bar__unknown" style={{ flexGrow: counts.unknown }} />
            </div>
            <span className="pv-criterion__counts">
              {known === 0 ? (
                "No data for any prospect yet"
              ) : (
                <>
                  <b>{counts.pass}</b> pass · {counts.fail} fail · {counts.unknown} no data
                </>
              )}
            </span>
          </div>
        )}
      </li>
    );
  };

  const section = (mode: Criterion["mode"]) => {
    const rows = profile.criteria.filter((c) => c.mode === mode);
    return (
      <section className="pv-section">
        <h3>
          {mode === "required" ? "Must have" : "Nice to have"}
          <span>{rows.length}</span>
        </h3>
        {rows.length === 0 ? (
          <div className="profile-editor__empty-section">
            {mode === "required" ? "No hard filters — every prospect passes." : "No nice-to-haves."}
          </div>
        ) : (
          <ul className="pv-criteria">{rows.map(row)}</ul>
        )}
      </section>
    );
  };

  return (
    <div
      className="profile-view"
      style={{ "--profile-color": profile.color ?? `var(--${profile.platform})` } as React.CSSProperties}
    >
      <button type="button" className="profile-editor__back secondary" onClick={onBack}>
        ← Profiles
      </button>

      <header className="pv-header">
        <div className="pv-header__text">
          <h2>
            <span className="profile-item__dot" aria-hidden="true" />
            {profile.name}
          </h2>
          <div className="pv-header__meta">
            <span className={`pv-platform pv-platform--${profile.platform}`}>
              <PlatformIcon platform={profile.platform} size={12} />
              {platformLabel}
            </span>
            <span>Created {created}</span>
            <span className="pv-locked" title="Profiles can't be changed once created. Use one as a template to make a variation.">
              <IconLock size={11} /> Locked
            </span>
          </div>
          {profile.description && <p className="pv-header__desc">{profile.description}</p>}
        </div>
        <div className="pv-header__actions">
          {archived ? (
            <button type="button" onClick={() => onRestore(profile)}>
              Restore
            </button>
          ) : (
            <>
              <button type="button" className="secondary pv-archive" onClick={() => onArchive(profile)}>
                Archive
              </button>
              <button type="button" onClick={() => onUseAsTemplate(profile)}>
                Use as template
              </button>
            </>
          )}
        </div>
      </header>

      {archived && (
        <div className="profile-editor__archived">
          This profile is archived. Restore it to see its matches again.
        </div>
      )}

      {error && <div className="app__error">{error}</div>}

      {!archived && (
        <section className="pv-matches">
          <div className="pv-matches__head">
            <h3>Prospect matches</h3>
            <div className="profiles__filters" role="tablist" aria-label="Prospect status">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={status === f.value}
                  className={status === f.value ? "profiles__filter profiles__filter--on" : "profiles__filter"}
                  onClick={() => setStatus(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className={summary ? "pv-stats" : "pv-stats pv-stats--loading"}>
            <div className="pv-stat pv-stat--match">
              <span className="pv-stat__value">{summary?.match ?? "–"}</span>
              <span className="pv-stat__label">Match</span>
              <span className="pv-stat__hint">Pass every must-have</span>
            </div>
            <div className="pv-stat">
              <span className="pv-stat__value">{summary?.possible ?? "–"}</span>
              <span className="pv-stat__label">Possible</span>
              <span className="pv-stat__hint">Nothing fails, but some data is missing</span>
            </div>
            <div className="pv-stat">
              <span className="pv-stat__value">{summary?.total ?? "–"}</span>
              <span className="pv-stat__label">
                {platformLabel}
                {statusLabel} prospects
              </span>
              <span className="pv-stat__hint">
                {summary && summary.total > 0
                  ? `${summary.total - summary.match - summary.possible} ruled out`
                  : "Nothing to compare yet"}
              </span>
            </div>
          </div>
        </section>
      )}

      {section("required")}
      {section("preferred")}
    </div>
  );
}
