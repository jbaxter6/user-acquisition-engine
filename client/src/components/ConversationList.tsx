import type { Conversation, InstagramAccount, Platform } from "../types";
import { PlatformBadge } from "./PlatformBadge";
import { PlatformIcon } from "./PlatformIcon";
import { Avatar } from "./Avatar";
import { formatRelativeTime, parseServerDate } from "../lib/relativeTime";

const PLATFORMS: Platform[] = ["instagram", "tiktok", "twitch"];

interface Props {
  conversations: Conversation[];
  selectedId: number | null;
  filter: Platform | "all";
  onFilterChange: (filter: Platform | "all") => void;
  accounts: InstagramAccount[];
  accountFilter: number | "all";
  onAccountFilterChange: (accountId: number | "all") => void;
  onSelect: (id: number) => void;
  accountFor: (accountId: number | null) => InstagramAccount | null;
}

export function ConversationList({
  conversations,
  selectedId,
  filter,
  onFilterChange,
  accounts,
  accountFilter,
  onAccountFilterChange,
  onSelect,
  accountFor,
}: Props) {
  const visible = conversations.filter((c) => accountFilter === "all" || c.account_id === accountFilter);

  return (
    <div className="conversation-list">
      <div className="conversation-list__filters">
        <button
          className={filter === "all" ? "filter-btn filter-btn--active" : "filter-btn"}
          onClick={() => onFilterChange("all")}
        >
          All
        </button>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            className={p === filter ? "filter-btn filter-btn--icon filter-btn--active" : "filter-btn filter-btn--icon"}
            onClick={() => onFilterChange(p)}
            title={p}
            aria-label={`Filter by ${p}`}
          >
            <PlatformIcon platform={p} size={15} />
          </button>
        ))}

        {accounts.length > 0 && (
          <select
            className="conversation-list__account-filter"
            value={accountFilter}
            onChange={(e) => onAccountFilterChange(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username ?? a.igUserId}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="conversation-list__items">
        {visible.length === 0 && <p className="empty-state">No conversations yet.</p>}
        {visible.map((c) => {
          const account = accountFor(c.account_id);
          return (
            <button
              key={c.id}
              className={c.id === selectedId ? "conversation-item conversation-item--active" : "conversation-item"}
              onClick={() => onSelect(c.id)}
            >
              <div className="conversation-item__row">
                <span className="conversation-item__identity">
                  <Avatar
                    src={c.participant_avatar_url}
                    label={c.participant_name || c.participant_handle}
                    size={32}
                    engaged={Boolean(c.has_engaged)}
                  />
                  <span className="conversation-item__name">{c.participant_name || c.participant_handle}</span>
                </span>
                <span className="conversation-item__right">
                  <span className="conversation-item__badges">
                    {account && (
                      <Avatar
                        src={account.profilePictureUrl}
                        label={account.username ?? account.igUserId}
                        title={`via @${account.username ?? account.igUserId}`}
                        size={18}
                      />
                    )}
                    <PlatformBadge platform={c.platform} />
                  </span>
                  <span className="conversation-item__time" title={parseServerDate(c.last_message_at).toLocaleString()}>
                    {formatRelativeTime(c.last_message_at)}
                  </span>
                </span>
              </div>
              <div className="conversation-item__preview">
                {c.last_message_text
                  ? `${c.last_message_direction === "outbound" ? "You: " : ""}${c.last_message_text}`
                  : c.participant_handle}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
