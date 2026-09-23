import { useEffect, useState } from "react";
import { api } from "./api/client";
import { ConversationList } from "./components/ConversationList";
import { ThreadView } from "./components/ThreadView";
import { ManualMessageForm } from "./components/ManualMessageForm";
import { AccountConnection } from "./components/AccountConnection";
import { PlatformStatusChip } from "./components/PlatformStatusChip";
import { ProspectingPage } from "./components/ProspectingPage";
import { TemplatesPanel } from "./components/TemplatesPanel";
import type { Conversation, InstagramAccount, Message, Platform } from "./types";
import "./index.css";

const VIEW_LABELS = { inbox: "JB", prospecting: "Prospecting", templates: "Templates" } as const;

export default function App() {
  const [view, setView] = useState<"inbox" | "prospecting" | "templates">("inbox");
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [accountFilter, setAccountFilter] = useState<number | "all">("all");
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

  const accountFor = (accountId: number | null): InstagramAccount | null => {
    if (accountId == null) return null;
    return accounts.find((a) => a.id === accountId) ?? null;
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
        <div className="app__header-left">
          <h1>{VIEW_LABELS[view]}</h1>
          <nav className="app__nav">
            <button
              className={view === "inbox" ? "nav-btn nav-btn--active" : "nav-btn"}
              onClick={() => setView("inbox")}
            >
              Inbox
            </button>
            <button
              className={view === "prospecting" ? "nav-btn nav-btn--active" : "nav-btn"}
              onClick={() => setView("prospecting")}
            >
              Prospecting
            </button>
            <button
              className={view === "templates" ? "nav-btn nav-btn--active" : "nav-btn"}
              onClick={() => setView("templates")}
            >
              Templates
            </button>
          </nav>
        </div>
        <div className="app__header-right">
          <AccountConnection accounts={accounts} onChange={refreshAccounts} />
          <PlatformStatusChip platform="tiktok" count={0} title="No TikTok integration yet — messages are logged manually" />
          <PlatformStatusChip platform="twitch" count={0} title="No Twitch integration yet — messages are logged manually" />
        </div>
      </header>

      {error && <div className="app__error">{error}</div>}

      {view === "inbox" ? (
        <div className={selectedId != null ? "app__body app__body--thread-open" : "app__body"}>
          <aside className="app__sidebar">
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              filter={filter}
              onFilterChange={setFilter}
              accounts={accounts}
              accountFilter={accountFilter}
              onAccountFilterChange={setAccountFilter}
              onSelect={setSelectedId}
              accountFor={accountFor}
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
              accountFor={accountFor}
              onSend={handleSend}
              onBack={() => setSelectedId(null)}
            />
          </main>
        </div>
      ) : view === "prospecting" ? (
        <ProspectingPage accounts={accounts} />
      ) : (
        <TemplatesPanel />
      )}
    </div>
  );
}
