import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type {
  AttributeDef,
  AttributeRegistry,
  Criterion,
  Platform,
  TargetProfile,
  TargetProfileInput,
} from "../types";
import {
  GROUP_LABEL,
  attributesFor,
  criterionProblem,
  defaultCriterion,
  toCriterion,
  type DraftCriterion,
} from "../lib/profileCriteria";
import { apiErrorMessage } from "../lib/apiError";
import { CriterionRow } from "./CriterionRow";
import { PlatformIcon } from "./PlatformIcon";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "twitch", label: "Twitch" },
  { value: "youtube", label: "YouTube" },
];

const SWATCHES = ["#5b8cff", "#7d5cff", "#e1306c", "#ff7a45", "#f5c542", "#34d399", "#25c7d9", "#9aa1ad"];

interface Draft {
  name: string;
  description: string;
  platform: Platform;
  color: string | null;
  criteria: DraftCriterion[];
}

function toDraft(profile: TargetProfile | null, platform: Platform): Draft {
  return profile
    ? {
        name: profile.name,
        description: profile.description ?? "",
        platform: profile.platform,
        color: profile.color,
        criteria: profile.criteria,
      }
    : { name: "", description: "", platform, color: null, criteria: [] };
}

interface Props {
  profile: TargetProfile | null;
  defaultPlatform: Platform;
  registry: AttributeRegistry;
  onSaved: (profile: TargetProfile) => void;
  onDuplicate: (profile: TargetProfile) => void;
  onArchive: (profile: TargetProfile) => void;
  onRestore: (profile: TargetProfile) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}

export function ProfileEditor({
  profile,
  defaultPlatform,
  registry,
  onSaved,
  onDuplicate,
  onArchive,
  onRestore,
  onDirtyChange,
  onBack,
}: Props) {
  const initial = useMemo(() => toDraft(profile, defaultPlatform), [profile, defaultPlatform]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    if (!profile) nameRef.current?.focus();
  }, [profile]);

  const defs = useMemo(
    () => new Map(registry.attributes.map((a) => [a.key, a])),
    [registry],
  );
  const available = attributesFor(registry.attributes, draft.platform).filter((a) => a.filterable);
  const archived = !!profile?.archived_at;

  const problems = draft.criteria.filter((c) => {
    const def = defs.get(c.attribute);
    return !def || criterionProblem(c, def) != null;
  }).length;
  const nameMissing = !draft.name.trim();

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const updateCriterion = (id: string, next: DraftCriterion) =>
    update({ criteria: draft.criteria.map((c) => (c.id === id ? next : c)) });

  const changePlatform = (platform: Platform) => {
    const dropped = draft.criteria.filter(
      (c) => !defs.get(c.attribute)?.platforms.includes(platform),
    );
    if (dropped.length) {
      const names = dropped.map((c) => defs.get(c.attribute)?.label ?? c.attribute).join(", ");
      const label = PLATFORMS.find((p) => p.value === platform)?.label;
      if (!confirm(`${names} ${dropped.length === 1 ? "isn't" : "aren't"} available on ${label} and will be removed. Continue?`))
        return;
    }
    update({
      platform,
      criteria: draft.criteria.filter((c) => !dropped.includes(c)),
    });
  };

  const addCriterion = (key: string, mode: Criterion["mode"]) => {
    const def = defs.get(key);
    if (def) update({ criteria: [...draft.criteria, defaultCriterion(def, mode)] });
  };

  const toggleMode = (c: DraftCriterion) => {
    const next: DraftCriterion =
      c.mode === "required" ? { ...c, mode: "preferred", weight: 2 } : { ...c, mode: "required" };
    if (next.mode === "required") delete next.weight;
    updateCriterion(c.id, next);
  };

  const save = async () => {
    if (saving || archived) return;
    if (nameMissing || problems) {
      setShowErrors(true);
      if (nameMissing) nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    const input: TargetProfileInput = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      platform: draft.platform,
      color: draft.color,
      criteria: draft.criteria.map(toCriterion),
    };
    try {
      const saved = profile
        ? await api.updateProfile(profile.id, input)
        : await api.createProfile(input);
      setShowErrors(false);
      onSaved(saved);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+S saves.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const section = (mode: Criterion["mode"]) => {
    const rows = draft.criteria.filter((c) => c.mode === mode);
    return (
      <section className="profile-editor__section">
        <header className="profile-editor__section-head">
          <div>
            <h3>{mode === "required" ? "Must have" : "Nice to have"}</h3>
            <p>
              {mode === "required"
                ? "Hard filters — a prospect that fails any of these isn't a match."
                : "Nice-to-haves that raise a prospect's match score. Dots set how much each one counts."}
            </p>
          </div>
        </header>
        {rows.length === 0 && (
          <div className="profile-editor__empty-section">
            {mode === "required" ? "No hard filters yet." : "No nice-to-haves yet."}
          </div>
        )}
        {rows.map((c) => {
          const def = defs.get(c.attribute);
          if (!def) return null;
          return (
            <CriterionRow
              key={c.id}
              criterion={c}
              def={def}
              hasData={def.hasData.includes(draft.platform)}
              operators={registry.operators[def.type]}
              showErrors={showErrors}
              onChange={(next) => updateCriterion(c.id, next)}
              onRemove={() => update({ criteria: draft.criteria.filter((x) => x.id !== c.id) })}
              onToggleMode={() => toggleMode(c)}
            />
          );
        })}
        <AddCriterion
          attributes={available}
          platform={draft.platform}
          onAdd={(key) => addCriterion(key, mode)}
        />
      </section>
    );
  };

  return (
    <div className="profile-editor">
      <div className="profile-editor__top">
        <button type="button" className="profile-editor__back secondary" onClick={onBack}>
          ← Profiles
        </button>
        <h2>{profile ? profile.name || "Untitled profile" : "New profile"}</h2>
        {dirty && !archived && <span className="profile-editor__dirty">Unsaved changes</span>}
      </div>

      {archived && profile && (
        <div className="profile-editor__archived">
          This profile is archived.
          <button type="button" onClick={() => onRestore(profile)}>
            Restore
          </button>
        </div>
      )}

      {error && <div className="app__error">{error}</div>}

      <fieldset className="profile-editor__body" disabled={archived}>
        <div className="profile-editor__fields">
          <label className="field">
            <span>Name</span>
            <input
              ref={nameRef}
              value={draft.name}
              maxLength={120}
              placeholder="e.g. Mid-tier IG fitness creators"
              onChange={(e) => update({ name: e.target.value })}
              className={showErrors && nameMissing ? "field--invalid" : undefined}
            />
          </label>

          <div className="field">
            <span>Platform</span>
            <div className="platform-picker" role="radiogroup" aria-label="Platform">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.platform === p.value}
                  className={
                    draft.platform === p.value
                      ? `platform-picker__btn platform-picker__btn--on platform-picker__btn--${p.value}`
                      : "platform-picker__btn"
                  }
                  onClick={() => draft.platform !== p.value && changePlatform(p.value)}
                >
                  <PlatformIcon platform={p.value} size={14} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Description</span>
            <textarea
              rows={2}
              value={draft.description}
              maxLength={2000}
              placeholder="Who this is and why we want them (optional)"
              onChange={(e) => update({ description: e.target.value })}
            />
          </label>

          <div className="field">
            <span>Color</span>
            <div className="swatches" role="radiogroup" aria-label="Color">
              <button
                type="button"
                role="radio"
                aria-checked={draft.color == null}
                className={draft.color == null ? "swatch swatch--none swatch--on" : "swatch swatch--none"}
                onClick={() => update({ color: null })}
                title="Platform color"
              />
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === c}
                  className={draft.color === c ? "swatch swatch--on" : "swatch"}
                  style={{ background: c }}
                  onClick={() => update({ color: c })}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>

        {section("required")}
        {section("preferred")}
      </fieldset>

      {!archived && (
        <footer className="profile-editor__footer">
          {profile && (
            <div className="profile-editor__footer-left">
              <button type="button" className="secondary" onClick={() => onDuplicate(profile)}>
                Duplicate
              </button>
              <button type="button" className="secondary" onClick={() => onArchive(profile)}>
                Archive
              </button>
            </div>
          )}
          <div className="profile-editor__footer-right">
            {showErrors && (nameMissing || problems > 0) && (
              <span className="profile-editor__problems">
                {nameMissing ? "Name is required" : `${problems} criteria need attention`}
              </span>
            )}
            <button type="button" onClick={save} disabled={saving || (!dirty && !!profile)}>
              {saving ? "Saving…" : profile ? "Save changes" : "Create profile"}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

function AddCriterion({
  attributes,
  platform,
  onAdd,
}: {
  attributes: AttributeDef[];
  platform: Platform;
  onAdd: (key: string) => void;
}) {
  const groups = (Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[])
    .map((g) => ({ group: g, items: attributes.filter((a) => a.group === g) }))
    .filter((g) => g.items.length);

  return (
    <label className="add-criterion">
      <span aria-hidden="true">+ Add criterion</span>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
        }}
        aria-label="Add criterion"
      >
        <option value="" disabled>
          Add criterion
        </option>
        {groups.map(({ group, items }) => (
          <optgroup key={group} label={GROUP_LABEL[group]}>
            {items.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
                {a.hasData.includes(platform) ? "" : " (no data yet)"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
