import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type {
  InstagramAccount,
  MessageTemplate,
  Platform,
  Prospect,
} from "../types";
import {
  applyMapping,
  autoMapColumns,
  downloadProspectTemplate,
  FIELD_LABELS,
  parseSpreadsheet,
  PROSPECT_FIELDS,
  type MappedProspect,
  type ParsedSheet,
  type ProspectField,
} from "../lib/prospectImport";
import { Avatar } from "./Avatar";
import { PlatformBadge } from "./PlatformBadge";
import { PlatformIcon } from "./PlatformIcon";
import { IconX } from "./icons";
import { formatRelativeTime } from "../lib/relativeTime";

function scrollToProspectCard(id: number) {
  const el = document.getElementById(`prospect-card-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("prospect-card--highlight");
  setTimeout(() => el.classList.remove("prospect-card--highlight"), 1500);
}

const STATUS_LABEL: Record<Prospect["status"], string> = {
  new: "New",
  contacted: "Messaged",
  replied: "Responded",
  closed: "Closed",
};

interface Props {
  accounts: InstagramAccount[];
}

const STATUS_FILTERS: Array<{
  label: string;
  value: Prospect["status"] | "all";
}> = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Contacted", value: "contacted" },
  { label: "Replied", value: "replied" },
  { label: "Closed", value: "closed" },
];

const PLATFORM_FILTERS: Array<{ label: string; value: Platform | "all" }> = [
  { label: "All platforms", value: "all" },
  { label: "Instagram", value: "instagram" },
  { label: "TikTok", value: "tiktok" },
  { label: "Twitch", value: "twitch" },
];

export function ProspectingPage({ accounts }: Props) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [statusFilter, setStatusFilter] = useState<Prospect["status"] | "all">(
    "all",
  );
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<
    Partial<Record<ProspectField, string>>
  >({});
  const [defaultPlatform, setDefaultPlatform] = useState<Platform>("instagram");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    api
      .listProspects({
        status: statusFilter === "all" ? undefined : statusFilter,
        platform: platformFilter === "all" ? undefined : platformFilter,
      })
      .then(setProspects)
      .catch((e) => setError(String(e)));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, platformFilter]);

  useEffect(() => {
    api
      .listTemplates()
      .then(setTemplates)
      .catch((e) => setError(String(e)));
  }, []);

  const handleFile = async (file: File) => {
    setImportResult(null);
    const buffer = await file.arrayBuffer();
    const parsed = await parseSpreadsheet(buffer);
    setSheet(parsed);
    setMapping(autoMapColumns(parsed.headers));
  };

  const handleImport = async () => {
    if (!sheet) return;
    const mapped: MappedProspect[] = applyMapping(
      sheet.rows,
      mapping,
      defaultPlatform,
    );
    if (mapped.length === 0) {
      setImportResult("No valid rows — make sure a Username column is mapped.");
      return;
    }
    setImporting(true);
    try {
      const result = await api.bulkImportProspects(mapped);
      setImportResult(
        `Imported ${result.inserted} new prospect(s), skipped ${result.skipped} already on file.`,
      );
      setSheet(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
    } catch (err) {
      setImportResult(`Import failed: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="prospecting">
      <section className="prospecting__import">
        <h2>Import prospects</h2>
        <p className="prospecting__hint">
          Upload an Excel/CSV sheet — map its columns below, then import.
          Duplicate username+platform pairs are skipped automatically. If your
          sheet doesn't have a platform column, everything imports as the
          default platform below.
        </p>
        <div className="prospecting__import-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <button
            className="secondary"
            onClick={() => downloadProspectTemplate()}
          >
            Download template
          </button>
        </div>

        {sheet && (
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
        )}

        {importResult && <p className="prospecting__hint">{importResult}</p>}
      </section>

      {error && <div className="app__error">{error}</div>}

      <section className="prospecting__list">
        <div className="prospecting__filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              className={
                f.value === statusFilter
                  ? "filter-btn filter-btn--active"
                  : "filter-btn"
              }
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
          <select
            className="conversation-list__account-filter"
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
        </div>

        <div className="prospecting__cards">
          {prospects.length === 0 && (
            <p className="empty-state">
              No prospects yet — import a sheet to get started.
            </p>
          )}
          {prospects.map((p) => (
            <ProspectCard
              key={p.id}
              prospect={p}
              accounts={accounts}
              templates={templates}
              allProspects={prospects}
              onChange={refresh}
            />
          ))}
        </div>
      </section>
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
  allProspects,
  excludeKeys,
  showRole,
  onSubmit,
  onCancel,
}: {
  allProspects: Prospect[];
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

  const queryTrimmed = query.trim().toLowerCase();
  const matches = queryTrimmed
    ? allProspects
        .filter(
          (candidate) =>
            !excludeKeys.has(
              `${candidate.platform}:${candidate.username.toLowerCase()}`,
            ),
        )
        .filter(
          (candidate) =>
            candidate.username.toLowerCase().includes(queryTrimmed) ||
            (candidate.display_name ?? "").toLowerCase().includes(queryTrimmed),
        )
        .slice(0, 6)
    : [];

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
                  No matching prospects.
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
                        {candidate.display_name || `@${candidate.username}`}
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
  accounts,
  templates,
  allProspects,
  onChange,
}: {
  prospect: Prospect;
  accounts: InstagramAccount[];
  templates: MessageTemplate[];
  allProspects: Prospect[];
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const isInstagram = prospect.platform === "instagram";
  const [tab, setTab] = useState<"outreach" | "accounts">("outreach");
  const [accountId, setAccountId] = useState<number | "">(
    accounts[0]?.id ?? "",
  );
  const [templateId, setTemplateId] = useState<number | "">("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkingChannel, setLinkingChannel] = useState(false);
  const [linkingManager, setLinkingManager] = useState(false);

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

  const handleSend = async () => {
    if (!accountId || !text.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await api.messageProspect(
        prospect.id,
        accountId,
        text.trim(),
        templateId || undefined,
      );
      setText("");
      onChange();
    } catch (err) {
      setSendError(String(err));
    } finally {
      setSending(false);
    }
  };

  const handleMarkManually = async () => {
    if (!text.trim()) return;
    if (isInstagram && !accountId) return;
    setSending(true);
    try {
      await api.markProspectContactedManually(
        prospect.id,
        isInstagram ? (accountId as number) : null,
        text.trim(),
        templateId || undefined,
      );
      setText("");
      setSendError(null);
      onChange();
    } catch (err) {
      setSendError(String(err));
    } finally {
      setSending(false);
    }
  };

  const handleCopyMessage = async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — user can still select/copy manually
    }
  };

  const handleOpenInstagram = () => {
    const username = prospect.username?.replace(/^@/, "");
    if (!username) return;
    window.open(`https://ig.me/m/${username}`, "_blank", "noopener,noreferrer");
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
            src={null}
            label={prospect.display_name || prospect.username}
            size={40}
          />
          <span className="prospect-card__avatar-badge">
            <PlatformIcon platform={prospect.platform} size={10} />
          </span>
        </span>
        <div className="prospect-card__identity">
          <span className="prospect-card__name">
            {prospect.display_name || `@${prospect.username}`}
          </span>
          <a
            className="prospect-card__handle"
            href={
              isInstagram
                ? `https://instagram.com/${prospect.username}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            @{prospect.username}
          </a>
        </div>
      </div>

      <div className="prospect-card__pills">
        {prospect.contacted_at && (
          <span className="pill pill--info">
            Messaged · {formatRelativeTime(prospect.contacted_at)}
          </span>
        )}
        <span className={`pill pill--status-${prospect.status}`}>
          {STATUS_LABEL[prospect.status]}
        </span>
        {prospect.conversation_id != null && (
          <button
            className="pill pill--link"
            onClick={() =>
              navigate(`/inbox?conversationId=${prospect.conversation_id}`)
            }
          >
            Open conversation
          </button>
        )}
      </div>

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
        </button>
      </div>

      {tab === "outreach" ? (
        <div className="prospect-card__outreach">
          {prospect.followers != null && (
            <p className="prospect-card__meta">
              {prospect.followers.toLocaleString()} followers
            </p>
          )}
          {prospect.notes && (
            <p className="prospect-card__notes">{prospect.notes}</p>
          )}

          {templates.length > 0 && (
            <label className="prospect-card__field">
              <span>Message template</span>
              <select
                value={templateId}
                onChange={(e) => handleTemplatePick(e.target.value)}
              >
                <option value="">— write from scratch —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="prospect-card__textarea-wrap">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Write a message..."
            />
            <span className="prospect-card__char-count">
              {text.length} chars
            </span>
          </div>

          {sendError && (
            <p className="composer-note">
              Send failed: {sendError} — copy the message and send it yourself,
              then mark it below.
            </p>
          )}

          <div className="prospect-card__outreach-actions">
            <button
              className="secondary"
              onClick={handleCopyMessage}
              disabled={!text.trim()}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            {isInstagram && (
              <button
                className="secondary"
                onClick={handleOpenInstagram}
                disabled={!prospect.username}
              >
                Open in Instagram
              </button>
            )}
            <button
              className="secondary"
              onClick={handleMarkManually}
              disabled={sending || !text.trim()}
            >
              Mark sent manually
            </button>
          </div>

          {isInstagram ? (
            accounts.length > 0 ? (
              <div className="prospect-card__send-row">
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(Number(e.target.value))}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username ?? a.igUserId}
                    </option>
                  ))}
                </select>
                <button
                  className="prospect-card__cta"
                  onClick={handleSend}
                  disabled={sending || !text.trim()}
                >
                  <PlatformIcon platform="instagram" size={15} />
                  {sending ? "Sending..." : "Message with template"}
                </button>
              </div>
            ) : (
              <p className="composer-note">
                Connect an Instagram account to send via the API — you can still
                copy/mark manually above.
              </p>
            )
          ) : (
            <p className="composer-note">
              No {prospect.platform} account integration yet — send from that
              platform's app, then mark it above.
            </p>
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
                Link additional Instagram, TikTok, or Twitch handles to sync
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
                    {link.display_name || `@${link.username}`}
                  </span>
                  <span className={`pill pill--status-${link.status}`}>
                    {STATUS_LABEL[link.status]}
                  </span>
                  <button
                    className="secondary"
                    onClick={() => scrollToProspectCard(link.id)}
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
              allProspects={allProspects}
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
                      {link.display_name || `@${link.username}`}
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
                    onClick={() => scrollToProspectCard(link.id)}
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
                      {contact.name || `@${contact.handle}`}
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
              allProspects={allProspects}
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
                          {link.display_name || `@${link.username}`}
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
                        onClick={() => scrollToProspectCard(link.id)}
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
