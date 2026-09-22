import { useState } from "react";
import type { Platform } from "../types";

interface Props {
  onSubmit: (input: {
    platform: Platform;
    participantHandle: string;
    participantName?: string;
    text: string;
  }) => Promise<void>;
}

export function ManualMessageForm({ onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) {
    return (
      <button className="manual-entry-toggle" onClick={() => setOpen(true)}>
        + Log a TikTok/Twitch message
      </button>
    );
  }

  const handleSubmit = async () => {
    if (!handle.trim() || !text.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ platform, participantHandle: handle.trim(), participantName: name.trim() || undefined, text: text.trim() });
      setHandle("");
      setName("");
      setText("");
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="manual-entry-form">
      <p className="manual-entry-form__title">Log a message seen on TikTok or Twitch</p>
      <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
        <option value="tiktok">TikTok</option>
        <option value="twitch">Twitch</option>
      </select>
      <input placeholder="Handle (e.g. @creator)" value={handle} onChange={(e) => setHandle(e.target.value)} />
      <input placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea placeholder="What they said" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
      <div className="manual-entry-form__actions">
        <button onClick={() => setOpen(false)} className="secondary">
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting || !handle.trim() || !text.trim()}>
          {submitting ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  );
}
