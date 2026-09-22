import type { Conversation, Platform } from "../types";
import { PlatformBadge } from "./PlatformBadge";

const PLATFORM_FILTERS: Array<{ label: string; value: Platform | "all" }> = [
  { label: "All", value: "all" },
  { label: "Instagram", value: "instagram" },
  { label: "TikTok", value: "tiktok" },
  { label: "Twitch", value: "twitch" },
];

interface Props {
  conversations: Conversation[];
  selectedId: number | null;
  filter: Platform | "all";
  onFilterChange: (filter: Platform | "all") => void;
  onSelect: (id: number) => void;
  accountLabel: (accountId: number | null) => string | null;
}

export function ConversationList({
  conversations,
  selectedId,
  filter,
  onFilterChange,
  onSelect,
  accountLabel,
}: Props) {
  return (
    <div className="conversation-list">
      <div className="conversation-list__filters">
        {PLATFORM_FILTERS.map((f) => (
          <button
            key={f.value}
            className={f.value === filter ? "filter-btn filter-btn--active" : "filter-btn"}
            onClick={() => onFilterChange(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="conversation-list__items">
        {conversations.length === 0 && <p className="empty-state">No conversations yet.</p>}
        {conversations.map((c) => (
          <button
            key={c.id}
            className={c.id === selectedId ? "conversation-item conversation-item--active" : "conversation-item"}
            onClick={() => onSelect(c.id)}
          >
            <div className="conversation-item__row">
              <span className="conversation-item__name">{c.participant_name || c.participant_handle}</span>
              <PlatformBadge platform={c.platform} />
            </div>
            <div className="conversation-item__handle">
              {c.participant_handle}
              {accountLabel(c.account_id) && <span className="conversation-item__account"> · via {accountLabel(c.account_id)}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
