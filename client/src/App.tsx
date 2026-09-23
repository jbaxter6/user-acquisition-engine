import { useEffect, useState } from "react";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { api } from "./api/client";
import { ConversationList } from "./components/ConversationList";
import { ThreadView } from "./components/ThreadView";
import { AccountConnection } from "./components/AccountConnection";
import { PlatformStatusChip } from "./components/PlatformStatusChip";
import { ProspectingPage } from "./components/ProspectingPage";
import { TemplatesPanel } from "./components/TemplatesPanel";
import type {
  Conversation,
  InstagramAccount,
  Message,
  Platform,
} from "./types";
import "./index.css";

const VIEW_LABELS = {
  inbox: "Inbox",
  prospecting: "Prospecting",
  templates: "Templates",
} as const;
const BRAND_NAME = "JB";

type View = keyof typeof VIEW_LABELS;

function getViewFromPath(pathname: string): View {
  if (pathname.startsWith("/prospecting")) return "prospecting";
  if (pathname.startsWith("/templates")) return "templates";
  return "inbox";
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const location = useLocation();
  const view = getViewFromPath(location.pathname);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [accountFilter, setAccountFilter] = useState<number | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const requestedId = Number(searchParams.get("conversationId"));
    if (Number.isFinite(requestedId) && requestedId > 0) {
      setSelectedId(requestedId);
    }
  }, [location.search]);

  const refreshConversations = () => {
    api
      .listConversations(filter === "all" ? undefined : filter)
      .then(setConversations)
      .catch((e) => setError(String(e)));
  };

  const refreshAccounts = () => {
    api
      .listInstagramAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
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
    api
      .listMessages(selectedId)
      .then(setMessages)
      .catch((e) => setError(String(e)));
  }, [selectedId]);

  const selectedConversation =
    conversations.find((c) => c.id === selectedId) ?? null;

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
          <div className="app__brand" aria-label="JB brand">
            <span className="app__brand-mark">{BRAND_NAME}</span>
            <span className="app__brand-page">{VIEW_LABELS[view]}</span>
          </div>

          <nav className="app__nav" aria-label="Main navigation">
            <NavLink
              to="/inbox"
              className={({ isActive }) =>
                isActive ? "nav-btn nav-btn--active" : "nav-btn"
              }
            >
              Inbox
            </NavLink>
            <NavLink
              to="/prospecting"
              className={({ isActive }) =>
                isActive ? "nav-btn nav-btn--active" : "nav-btn"
              }
            >
              Prospecting
            </NavLink>
            <NavLink
              to="/templates"
              className={({ isActive }) =>
                isActive ? "nav-btn nav-btn--active" : "nav-btn"
              }
            >
              Templates
            </NavLink>
          </nav>
        </div>
        <div className="app__header-right">
          <AccountConnection accounts={accounts} onChange={refreshAccounts} />
          <PlatformStatusChip
            platform="tiktok"
            count={0}
            title="No TikTok integration yet — messages are logged manually"
          />
          <PlatformStatusChip
            platform="twitch"
            count={0}
            title="No Twitch integration yet — messages are logged manually"
          />
        </div>
      </header>

      {error && <div className="app__error">{error}</div>}

      <Routes>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route
          path="/inbox"
          element={
            <InboxPage
              accounts={accounts}
              conversations={conversations}
              filter={filter}
              accountFilter={accountFilter}
              selectedId={selectedId}
              messages={messages}
              selectedConversation={selectedConversation}
              accountFor={accountFor}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              onFilterChange={setFilter}
              onAccountFilterChange={setAccountFilter}
              onSelect={setSelectedId}
              onSend={handleSend}
              onManualAdd={handleManualAdd}
              onBack={() => setSelectedId(null)}
            />
          }
        />
        <Route
          path="/prospecting"
          element={<ProspectingPage accounts={accounts} />}
        />
        <Route path="/templates" element={<TemplatesPanel />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </div>
  );
}

const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 600;

function InboxPage(props: {
  accounts: InstagramAccount[];
  conversations: Conversation[];
  filter: Platform | "all";
  accountFilter: number | "all";
  selectedId: number | null;
  messages: Message[];
  selectedConversation: Conversation | null;
  accountFor: (accountId: number | null) => InstagramAccount | null;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: Platform | "all") => void;
  onAccountFilterChange: (value: number | "all") => void;
  onSelect: (id: number | null) => void;
  onSend: (text: string) => Promise<void>;
  onManualAdd: (input: {
    platform: Platform;
    participantHandle: string;
    participantName?: string;
    text: string;
  }) => Promise<void>;
  onBack: () => void;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 300;
  });

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let latest = startWidth;
    document.body.classList.add("is-resizing");

    const onMove = (ev: PointerEvent) => {
      latest = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX),
      );
      setSidebarWidth(latest);
    };
    const onUp = () => {
      document.body.classList.remove("is-resizing");
      localStorage.setItem("sidebarWidth", String(latest));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={
        props.selectedId != null
          ? "app__body app__body--thread-open"
          : "app__body"
      }
    >
      <aside className="app__sidebar" style={{ width: sidebarWidth }}>
        <ConversationList
          conversations={props.conversations}
          selectedId={props.selectedId}
          filter={props.filter}
          onFilterChange={props.onFilterChange}
          accounts={props.accounts}
          accountFilter={props.accountFilter}
          onAccountFilterChange={props.onAccountFilterChange}
          onSelect={props.onSelect}
          accountFor={props.accountFor}
          searchTerm={props.searchTerm}
          onSearchChange={props.onSearchChange}
        />
        <div className="conversation-list__search conversation-list__search--sidebar">
          <input
            type="search"
            value={props.searchTerm}
            onChange={(e) => props.onSearchChange(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </div>
      </aside>

      <div
        className="app__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation list"
        onPointerDown={startResize}
        onDoubleClick={() => {
          setSidebarWidth(300);
          localStorage.setItem("sidebarWidth", "300");
        }}
      />

      <main className="app__main">
        <ThreadView
          conversation={props.selectedConversation}
          messages={props.messages}
          canSend={
            props.selectedConversation?.platform === "instagram" &&
            props.selectedConversation.account_id != null
          }
          accountFor={props.accountFor}
          onSend={props.onSend}
          onBack={props.onBack}
        />
      </main>
    </div>
  );
}

export default App;
