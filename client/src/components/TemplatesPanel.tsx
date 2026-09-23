import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { MessageTemplateStats } from "../types";

export function TemplatesPanel() {
  const [stats, setStats] = useState<MessageTemplateStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const refresh = () => {
    api.templateStats().then(setStats).catch((e) => setError(String(e)));
  };

  useEffect(refresh, []);

  const startEdit = (id: number, currentName: string, currentBody: string) => {
    setEditingId(id);
    setName(currentName);
    setBody(currentBody);
  };

  const cancelEdit = () => {
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
      cancelEdit();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: number) => {
    if (!confirm("Archive this template? Past stats will be kept, but it won't be selectable anymore.")) return;
    await api.archiveTemplate(id);
    if (editingId === id) cancelEdit();
    refresh();
  };

  const active = stats.filter((t) => !t.archived_at);
  const archived = stats.filter((t) => t.archived_at);

  return (
    <div className="prospecting">
      <section className="prospecting__import">
        <h2>Message templates</h2>
        <p className="prospecting__hint">
          Save reusable outreach copy, then pick one when messaging a prospect. Sent/replied counts below show which
          pitches actually work.
        </p>

        <div className="templates__form">
          <input
            type="text"
            placeholder="Template name (e.g. Collab pitch v1)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            placeholder="Message body..."
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="templates__form-actions">
            {editingId != null && (
              <button className="secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
            <button onClick={handleSave} disabled={saving || !name.trim() || !body.trim()}>
              {editingId != null ? "Save changes" : "Add template"}
            </button>
          </div>
        </div>

        {error && <div className="app__error">{error}</div>}

        <div className="templates__list">
          {active.length === 0 && <p className="empty-state">No templates yet — add one above.</p>}
          {active.map((t) => (
            <div key={t.id} className="templates__row">
              <div className="templates__row-main">
                <span className="templates__row-name">{t.name}</span>
                <p className="templates__row-body">{t.body}</p>
                <span className="templates__row-stats">
                  {t.sent} sent · {t.replied} replied
                  {t.sent > 0 ? ` · ${Math.round(t.reply_rate * 100)}% reply rate` : ""}
                </span>
              </div>
              <div className="templates__row-actions">
                <button className="secondary" onClick={() => startEdit(t.id, t.name, t.body)}>
                  Edit
                </button>
                <button className="secondary" onClick={() => handleArchive(t.id)}>
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>

        {archived.length > 0 && (
          <details className="templates__archived">
            <summary>Archived templates ({archived.length})</summary>
            <div className="templates__list">
              {archived.map((t) => (
                <div key={t.id} className="templates__row templates__row--archived">
                  <div className="templates__row-main">
                    <span className="templates__row-name">{t.name}</span>
                    <span className="templates__row-stats">
                      {t.sent} sent · {t.replied} replied
                      {t.sent > 0 ? ` · ${Math.round(t.reply_rate * 100)}% reply rate` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
