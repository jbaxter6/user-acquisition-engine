import { useEffect, useState } from "react";
import { api } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import type { BurnerAccount, BurnerAccountDetail, Platform } from "../types";
import { IconPlus, IconSearch } from "./icons";
import { PlatformBadge } from "./PlatformBadge";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "twitch", label: "Twitch" },
  { value: "youtube", label: "YouTube" },
];

const FILTERS: { value: Platform | "all"; label: string }[] = [
  { value: "all", label: "All" },
  ...PLATFORMS,
];

const EMPTY_FORM = {
  platform: "instagram" as Platform,
  username: "",
  password: "",
  email: "",
  notes: "",
};

export function BurnersPage() {
  const [accounts, setAccounts] = useState<BurnerAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<BurnerAccountDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () =>
    api
      .listBurners()
      .then(setAccounts)
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    refresh().finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (selectedId == null || creating) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setRevealed(false);
    api
      .getBurner(selectedId)
      .then((row) => {
        if (!cancelled) setDetail(row);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, creating]);

  const visible = accounts.filter((a) => {
    if (filter !== "all" && a.platform !== filter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      a.username.includes(q) ||
      (a.email ?? "").toLowerCase().includes(q) ||
      (a.notes ?? "").toLowerCase().includes(q)
    );
  });

  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f.value] =
      f.value === "all" ? accounts.length : accounts.filter((a) => a.platform === f.value).length;
    return acc;
  }, {});

  const openNew = () => {
    setCreating(true);
    setEditing(false);
    setSelectedId(null);
    setForm({ ...EMPTY_FORM, platform: filter === "all" ? "instagram" : filter });
    setError(null);
  };

  const openEdit = () => {
    if (!detail) return;
    setEditing(true);
    setCreating(false);
    setForm({
      platform: detail.platform,
      username: detail.username,
      password: "",
      email: detail.email ?? "",
      notes: detail.notes ?? "",
    });
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const created = await api.createBurner({
          platform: form.platform,
          username: form.username,
          password: form.password,
          email: form.email,
          notes: form.notes,
        });
        await refresh();
        setCreating(false);
        setSelectedId(created.id);
      } else if (detail) {
        await api.updateBurner(detail.id, {
          platform: form.platform,
          username: form.username,
          password: form.password || undefined,
          email: form.email,
          notes: form.notes,
        });
        await refresh();
        setEditing(false);
        const next = await api.getBurner(detail.id);
        setDetail(next);
        setRevealed(false);
      }
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (account: BurnerAccount) => {
    if (!window.confirm(`Remove @${account.username}?`)) return;
    setError(null);
    try {
      await api.deleteBurner(account.id);
      if (selectedId === account.id) {
        setSelectedId(null);
        setDetail(null);
      }
      await refresh();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  };

  const formOpen = creating || editing;
  const detailOpen = formOpen || detail != null;

  return (
    <div className={detailOpen ? "burners burners--editing" : "burners"}>
      <aside className="burners__list">
        <div className="profiles__list-head">
          <div>
            <h1>Burners</h1>
            <p>Throwaway logins for WAR. Never a Smooth account.</p>
          </div>
          <button type="button" className="tpl-add-btn" onClick={openNew}>
            <IconPlus size={15} /> New
          </button>
        </div>

        <label className="toolbar-search profiles__search">
          <IconSearch size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search burners"
            aria-label="Search burners"
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

        {error && !detailOpen && <div className="app__error">{error}</div>}

        <ul className="profiles__items">
          {loaded && visible.length === 0 && (
            <li className="empty-state">
              {accounts.length === 0 ? "No burner accounts yet." : "No burners match."}
            </li>
          )}
          {visible.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={a.id === selectedId && !creating ? "profile-item profile-item--selected" : "profile-item"}
                onClick={() => {
                  setCreating(false);
                  setEditing(false);
                  setSelectedId(a.id);
                }}
                style={{ "--profile-color": `var(--${a.platform})` } as React.CSSProperties}
              >
                <div className="profile-item__head">
                  <span className="profile-item__name">@{a.username}</span>
                  <PlatformBadge platform={a.platform} />
                </div>
                <div className="profile-item__meta">{a.email || a.notes || "No notes"}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="burners__editor">
        {formOpen ? (
          <form
            className="profile-editor"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <div className="profile-editor__top">
              <h2>{creating ? "New burner" : `Edit @${detail?.username}`}</h2>
            </div>
            {error && <div className="app__error">{error}</div>}
            <div className="profile-editor__fields">
              <label className="field">
                <span>Platform</span>
                <select
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Username</span>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="@handle"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={creating ? "Password" : "Leave blank to keep the current password"}
                  autoComplete="new-password"
                  required={creating}
                />
              </label>
              <label className="field">
                <span>Login email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </label>
              <label className="field field--wide">
                <span>Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Which browser profile this is for, recovery notes, anything the team needs"
                  rows={4}
                />
              </label>
            </div>
            <div className="burner-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="secondary" onClick={closeForm}>
                Cancel
              </button>
            </div>
          </form>
        ) : detail ? (
          <div className="profile-editor">
            <div className="profile-editor__top">
              <PlatformBadge platform={detail.platform} />
              <h2>@{detail.username}</h2>
            </div>
            {error && <div className="app__error">{error}</div>}
            <div className="profile-editor__fields">
              <div className="field field--wide">
                <span>Password</span>
                <div className="burner-secret">
                  <code className="burner-secret__value">
                    {revealed ? detail.password : "••••••••"}
                  </code>
                  <button type="button" className="secondary" onClick={() => setRevealed((v) => !v)}>
                    {revealed ? "Hide" : "Show"}
                  </button>
                  <button type="button" className="secondary" onClick={() => copy("password", detail.password)}>
                    {copied === "password" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="field">
                <span>Username</span>
                <div className="burner-secret">
                  <code className="burner-secret__value">@{detail.username}</code>
                  <button type="button" className="secondary" onClick={() => copy("username", detail.username)}>
                    {copied === "username" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="field">
                <span>Login email</span>
                {detail.email ? (
                  <div className="burner-secret">
                    <code className="burner-secret__value">{detail.email}</code>
                    <button type="button" className="secondary" onClick={() => copy("email", detail.email!)}>
                      {copied === "email" ? "Copied" : "Copy"}
                    </button>
                  </div>
                ) : (
                  <span className="profile-item__meta">None</span>
                )}
              </div>
              {detail.notes && (
                <div className="field field--wide">
                  <span>Notes</span>
                  <p className="burner-note">{detail.notes}</p>
                </div>
              )}
            </div>
            <div className="burner-actions">
              <button type="button" onClick={openEdit}>
                Edit
              </button>
              <button type="button" className="secondary" onClick={() => handleDelete(detail)}>
                Remove
              </button>
              <button type="button" className="secondary burner-back" onClick={() => setSelectedId(null)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          loaded && (
            <div className="profiles__intro">
              <h2>Save the throwaway logins</h2>
              <p>
                WAR has to be logged into a throwaway on Instagram and TikTok, never a Smooth
                account. Store those usernames and passwords here so anyone on the team can copy
                them into the scraper browser.
              </p>
              <p>Passwords are encrypted before they are written to the database. The account list does not include them.</p>
              <button type="button" onClick={openNew}>
                Add a burner
              </button>
            </div>
          )
        )}
      </main>
    </div>
  );
}
