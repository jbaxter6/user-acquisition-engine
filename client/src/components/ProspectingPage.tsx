import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { InstagramAccount, Prospect } from "../types";
import {
  applyMapping,
  autoMapColumns,
  FIELD_LABELS,
  parseSpreadsheet,
  PROSPECT_FIELDS,
  type MappedProspect,
  type ParsedSheet,
  type ProspectField,
} from "../lib/prospectImport";
import { Avatar } from "./Avatar";

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

export function ProspectingPage({ accounts }: Props) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [statusFilter, setStatusFilter] = useState<Prospect["status"] | "all">("all");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ProspectField, string>>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    api
      .listProspects(statusFilter === "all" ? undefined : { status: statusFilter })
      .then(setProspects)
      .catch((e) => setError(String(e)));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleFile = async (file: File) => {
    setImportResult(null);
    const buffer = await file.arrayBuffer();
    const parsed = await parseSpreadsheet(buffer);
    setSheet(parsed);
    setMapping(autoMapColumns(parsed.headers));
  };

  const handleImport = async () => {
    if (!sheet) return;
    const mapped: MappedProspect[] = applyMapping(sheet.rows, mapping);
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
          Upload an Excel/CSV sheet — map its columns below, then import. Duplicate usernames are skipped
          automatically.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {sheet && (
          <div className="prospecting__mapping">
            <p className="prospecting__hint">{sheet.rows.length} row(s) found. Map each field to a column:</p>
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
        </div>

        <div className="prospecting__cards">
          {prospects.length === 0 && <p className="empty-state">No prospects yet — import a sheet to get started.</p>}
          {prospects.map((p) => (
            <ProspectCard key={p.id} prospect={p} accounts={accounts} onChange={refresh} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ProspectCard({
  prospect,
  accounts,
  onChange,
}: {
  prospect: Prospect;
  accounts: InstagramAccount[];
  onChange: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [accountId, setAccountId] = useState<number | "">(accounts[0]?.id ?? "");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!accountId || !text.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await api.messageProspect(prospect.id, accountId, text.trim());
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
    if (!accountId || !text.trim()) return;
    setSending(true);
    try {
      await api.markProspectContactedManually(prospect.id, accountId, text.trim());
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

  return (
    <div className="prospect-card">
      <div className="prospect-card__header">
        <Avatar src={null} label={prospect.display_name || prospect.username} size={36} />
        <div className="prospect-card__identity">
          <span className="prospect-card__name">{prospect.display_name || `@${prospect.username}`}</span>
          <span className="prospect-card__handle">@{prospect.username}</span>
        </div>
        <span className={`prospect-card__status prospect-card__status--${prospect.status}`}>{prospect.status}</span>
      </div>

      {prospect.followers != null && (
        <p className="prospect-card__meta">{prospect.followers.toLocaleString()} followers</p>
      )}
      {prospect.notes && <p className="prospect-card__notes">{prospect.notes}</p>}

      {prospect.status === "new" && (
        <>
          {!composing ? (
            <button onClick={() => setComposing(true)} disabled={accounts.length === 0}>
              {accounts.length === 0 ? "Connect an account first" : "Message"}
            </button>
          ) : (
            <div className="prospect-card__composer">
              <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.username ?? a.igUserId}
                  </option>
                ))}
              </select>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Write a message..." />
              {sendError && (
                <p className="composer-note">
                  Send failed: {sendError} — you can send it yourself from Instagram and mark it below instead.
                </p>
              )}
              <div className="prospect-card__composer-actions">
                <button className="secondary" onClick={() => setComposing(false)}>
                  Cancel
                </button>
                <button className="secondary" onClick={handleMarkManually} disabled={sending || !text.trim()}>
                  Mark sent manually
                </button>
                <button onClick={handleSend} disabled={sending || !text.trim()}>
                  {sending ? "Sending..." : "Send via API"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
