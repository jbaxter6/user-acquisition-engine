import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { InstagramAccount, MessageTemplate, Platform, Prospect } from "../types";
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

interface Props {
  accounts: InstagramAccount[];
}

const STATUS_FILTERS: Array<{ label: string; value: Prospect["status"] | "all" }> = [
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
  const [statusFilter, setStatusFilter] = useState<Prospect["status"] | "all">("all");
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ProspectField, string>>>({});
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
    api.listTemplates().then(setTemplates).catch((e) => setError(String(e)));
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
    const mapped: MappedProspect[] = applyMapping(sheet.rows, mapping, defaultPlatform);
    if (mapped.length === 0) {
      setImportResult("No valid rows — make sure a Username column is mapped.");
      return;
    }
    setImporting(true);
    try {
      const result = await api.bulkImportProspects(mapped);
      setImportResult(`Imported ${result.inserted} new prospect(s), skipped ${result.skipped} already on file.`);
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
          Upload an Excel/CSV sheet — map its columns below, then import. Duplicate username+platform pairs
          are skipped automatically. If your sheet doesn't have a platform column, everything imports as the
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
          <button className="secondary" onClick={() => downloadProspectTemplate()}>
            Download template
          </button>
        </div>

        {sheet && (
          <div className="prospecting__mapping">
            <p className="prospecting__hint">{sheet.rows.length} row(s) found. Map each field to a column:</p>

            <label className="prospecting__mapping-row">
              <span>Default platform (used when no Platform column is mapped, or a row's value isn't recognized)</span>
              <select value={defaultPlatform} onChange={(e) => setDefaultPlatform(e.target.value as Platform)}>
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
                      setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))
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
            <button onClick={handleImport} disabled={importing || !mapping.username}>
              {importing ? "Importing..." : `Import ${sheet.rows.length} row(s)`}
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
              className={f.value === statusFilter ? "filter-btn filter-btn--active" : "filter-btn"}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
          <select
            className="conversation-list__account-filter"
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as Platform | "all")}
          >
            {PLATFORM_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="prospecting__cards">
          {prospects.length === 0 && <p className="empty-state">No prospects yet — import a sheet to get started.</p>}
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
  const [composing, setComposing] = useState(false);
  const [accountId, setAccountId] = useState<number | "">(accounts[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [addingContact, setAddingContact] = useState(false);
  const [contactHandle, setContactHandle] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("manager");
  const [contactError, setContactError] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | "">("");
  const [mergeError, setMergeError] = useState<string | null>(null);

  const canOpenComposer = isInstagram ? accounts.length > 0 : true;
  const mergeTargets = allProspects.filter((candidate) => candidate.id !== prospect.id);

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
      await api.messageProspect(prospect.id, accountId, text.trim(), templateId || undefined);
      setComposing(false);
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
        templateId || undefined
      );
      setComposing(false);
      setText("");
      setSendError(null);
      onChange();
    } catch (err) {
      setSendError(String(err));
    } finally {
      setSending(false);
    }
  };

  const handleAddContact = async () => {
    if (!contactHandle.trim()) return;
    setContactError(null);
    try {
      await api.addProspectContact(prospect.id, {
        handle: contactHandle.trim(),
        name: contactName.trim() || undefined,
        role: contactRole,
        isPrimary: false,
      });
      setContactHandle("");
      setContactName("");
      setContactRole("manager");
      setAddingContact(false);
      onChange();
    } catch (err) {
      setContactError(String(err));
    }
  };

  const handleMerge = async () => {
    if (!mergeTargetId) return;
    setMergeError(null);
    try {
      await api.mergeProspects(prospect.id, Number(mergeTargetId));
      setMergeTargetId("");
      onChange();
    } catch (err) {
      setMergeError(String(err));
    }
  };

  return (
    <div className="prospect-card">
      <div className="prospect-card__header">
        <Avatar src={null} label={prospect.display_name || prospect.username} size={36} />
        <div className="prospect-card__identity">
          <span className="prospect-card__name">{prospect.display_name || `@${prospect.username}`}</span>
          <span className="prospect-card__handle">@{prospect.username}</span>
        </div>
        <PlatformBadge platform={prospect.platform} />
        <span className={`prospect-card__status prospect-card__status--${prospect.status}`}>{prospect.status}</span>
      </div>

      {prospect.followers != null && (
        <p className="prospect-card__meta">{prospect.followers.toLocaleString()} followers</p>
      )}
      {prospect.notes && <p className="prospect-card__notes">{prospect.notes}</p>}

      {prospect.channels && prospect.channels.length > 0 && (
        <div className="prospect-card__channels">
          {prospect.channels.map((channel) => (
            <div key={channel.id} className="prospect-card__channel">
              <span className="prospect-card__channel-label">
                <PlatformBadge platform={channel.platform} />
                @{channel.username}
              </span>
              {channel.conversation_id && (
                <button
                  className="secondary"
                  onClick={() => navigate(`/inbox?conversationId=${channel.conversation_id}`)}
                >
                  Open conversation
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {prospect.contacts && prospect.contacts.length > 0 && (
        <div className="prospect-card__contacts">
          {prospect.contacts.map((contact) => (
            <span key={contact.id} className="prospect-card__contact-tag">
              @{contact.handle}
              {contact.role ? ` · ${contact.role}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="prospect-card__contact-actions">
        {!addingContact ? (
          <button className="secondary" onClick={() => setAddingContact(true)}>
            Add contact
          </button>
        ) : (
          <div className="prospect-card__contact-form">
            <input
              value={contactHandle}
              onChange={(e) => setContactHandle(e.target.value)}
              placeholder="@handle"
            />
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Name (optional)"
            />
            <select value={contactRole} onChange={(e) => setContactRole(e.target.value)}>
              <option value="primary">Primary</option>
              <option value="manager">Manager</option>
              <option value="assistant">Assistant</option>
              <option value="owner">Owner</option>
              <option value="other">Other</option>
            </select>
            {contactError && <p className="composer-note">{contactError}</p>}
            <div className="prospect-card__composer-actions">
              <button className="secondary" onClick={() => setAddingContact(false)}>
                Cancel
              </button>
              <button onClick={handleAddContact} disabled={!contactHandle.trim()}>
                Save contact
              </button>
            </div>
          </div>
        )}
      </div>

      {prospect.status === "new" && (
        <>
          {!composing ? (
            <button onClick={() => setComposing(true)} disabled={!canOpenComposer}>
              {!canOpenComposer ? "Connect an account first" : "Message"}
            </button>
          ) : (
            <div className="prospect-card__composer">
              {isInstagram ? (
                <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username ?? a.igUserId}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="composer-note">
                  No {prospect.platform} account integration yet — send this from that platform's app
                  directly, then log it here.
                </p>
              )}
              {templates.length > 0 && (
                <select value={templateId} onChange={(e) => handleTemplatePick(e.target.value)}>
                  <option value="">— write from scratch —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Write a message..."
              />
              {sendError && (
                <p className="composer-note">
                  Send failed: {sendError} — you can send it yourself from the app and mark it below instead.
                </p>
              )}
              <div className="prospect-card__composer-actions">
                <button className="secondary" onClick={() => setComposing(false)}>
                  Cancel
                </button>
                <button className="secondary" onClick={handleMarkManually} disabled={sending || !text.trim()}>
                  Mark sent manually
                </button>
                {isInstagram && (
                  <button onClick={handleSend} disabled={sending || !text.trim()}>
                    {sending ? "Sending..." : "Send via API"}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {mergeTargets.length > 0 && (
        <div className="prospect-card__merge">
          <label className="prospect-card__merge-label">
            <span>Merge with duplicate</span>
            <select value={mergeTargetId} onChange={(e) => setMergeTargetId(Number(e.target.value) || "") }>
              <option value="">Select a prospect</option>
              {mergeTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.display_name || `@${target.username}`} ({target.platform})
                </option>
              ))}
            </select>
          </label>
          {mergeError && <p className="composer-note">{mergeError}</p>}
          <button className="secondary" onClick={handleMerge} disabled={!mergeTargetId}>
            Merge prospect
          </button>
        </div>
      )}
    </div>
  );
}
