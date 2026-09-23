import { useState } from "react";
import type { Conversation, InstagramAccount, Message } from "../types";
import { PlatformBadge } from "./PlatformBadge";
import { Avatar } from "./Avatar";

interface Props {
  conversation: Conversation | null;
  messages: Message[];
  canSend: boolean;
  accountFor: (accountId: number | null) => InstagramAccount | null;
  onSend: (text: string) => Promise<void>;
  onBack: () => void;
}

export function ThreadView({ conversation, messages, canSend, accountFor, onSend, onBack }: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  if (!conversation) {
    return (
      <div className="thread-view thread-view--empty">
        <p className="empty-state">Select a conversation to view its messages.</p>
      </div>
    );
  }

  const account = accountFor(conversation.account_id);

  const handleSend = async () => {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await onSend(draft.trim());
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="thread-view">
      <div className="thread-view__header">
        <div className="thread-view__header-left">
          <button className="thread-view__back secondary" onClick={onBack} aria-label="Back to conversations">
            ← Back
          </button>
          <Avatar
            src={conversation.participant_avatar_url}
            label={conversation.participant_name || conversation.participant_handle}
            size={36}
          />
          <div>
            <h2>{conversation.participant_name || conversation.participant_handle}</h2>
            <span className="thread-view__handle">{conversation.participant_handle}</span>
          </div>
        </div>
        <div className="thread-view__header-right">
          {account && (
            <Avatar
              src={account.profilePictureUrl}
              label={account.username ?? account.igUserId}
              title={`via @${account.username ?? account.igUserId}`}
              size={22}
            />
          )}
          <PlatformBadge platform={conversation.platform} />
        </div>
      </div>

      <div className="thread-view__messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.direction === "outbound" ? "message message--outbound" : "message message--inbound"}
          >
            <p>{m.text}</p>
            <span className="message__meta">
              {new Date(m.created_at).toLocaleString()}
              {m.source === "manual" && " · logged manually"}
            </span>
          </div>
        ))}
      </div>

      <div className="thread-view__composer">
        {!canSend && (
          <p className="composer-note">
            No API access for {conversation.platform} yet — sending here just logs that you replied on
            the platform directly.
          </p>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a reply..."
          rows={2}
        />
        <button onClick={handleSend} disabled={sending || !draft.trim()}>
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
