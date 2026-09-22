import { useEffect, useState } from "react";
import { api } from "./api/client";
import { ConversationList } from "./components/ConversationList";
import { ThreadView } from "./components/ThreadView";
import { ManualMessageForm } from "./components/ManualMessageForm";
import { AccountConnection } from "./components/AccountConnection";
import type { Conversation, HealthResponse, InstagramAccount, Message, Platform } from "./types";
import "./index.css";

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshConversations = () => {
    api
      .listConversations(filter === "all" ? undefined : filter)
      .then(setConversations)
      .catch((e) => setError(String(e)));
  };

  const refreshAccounts = () => {
    api.health().then(setHealth).catch((e) => setError(String(e)));
    api.listInstagramAccounts().then(setAccounts).catch(() => setAccounts([]));
    refreshConversations();
  };

  useEffect(() => {
    refreshAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (selectedId == null) {
      setMessages([]);
      return;
    }
    api.listMessages(selectedId).then(setMessages).catch((e) => setError(String(e)));
  }, [selectedId]);

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  const accountLabel = (accountId: number | null): string | null => {
    if (accountId == null) return null;
    const account = accounts.find((a) => a.id === accountId);
    return account?.username ?? account?.igUserId ?? null;
  };

  const handleSend = async (text: string) => {
    if (selectedId == null) return;
    const message = await api.sendMessage(selectedId, text);
    setMessages((prev) => [...prev, message]);
    refreshConversations();
  };

  const handleManualAdd = async (input: {
    platform: Platform;
    participantHandle: string;
    participantName?: string;
    text: string;
  }) => {
    const { conversation } = await api.addManualMessage(input);
    refreshConversations();
    setSelectedId(conversation.id);
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>Unified Master Inbox</h1>
        <div className="app__header-right">
          {health && (
            <div className="app__health">
              {Object.entries(health.adapters).map(([platform, info]) => (
                <span key={platform} className={info.canSend ? "status-dot status-dot--live" : "status-dot"}>
                  {platform}: {info.canSend ? "live" : "manual"}
                </span>
              ))}
            </div>
          )}
          <AccountConnection accounts={accounts} onChange={refreshAccounts} />
        </div>
      </header>

      {error && <div className="app__error">{error}</div>}

      <div className="app__body">
        <aside className="app__sidebar">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            filter={filter}
            onFilterChange={setFilter}
            onSelect={setSelectedId}
            accountLabel={accountLabel}
          />
          <ManualMessageForm onSubmit={handleManualAdd} />
        </aside>

        <main className="app__main">
          <ThreadView
            conversation={selectedConversation}
            messages={messages}
            canSend={
              selectedConversation?.platform === "instagram" && selectedConversation.account_id != null
            }
            accountLabel={accountLabel}
            onSend={handleSend}
          />
        </main>
      </div>
    </div>
  );
}
