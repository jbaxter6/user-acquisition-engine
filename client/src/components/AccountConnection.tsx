import { useEffect, useState } from "react";
// (add useRef back when re-enabling the auto-sync block below)
import { api, ApiError } from "../api/client";
import { Avatar } from "./Avatar";
import { PlatformIcon } from "./PlatformIcon";
import { IconRefresh, IconX, Spinner } from "./icons";
import { formatRelativeTime } from "../lib/relativeTime";
import type { InstagramAccount, MetaAccountUsage, MetaUsageLevel, MetaUsageResponse } from "../types";

const USAGE_POLL_MS = 60_000;
const RECONNECT_REDIRECT_MS = 2_000;
const reconnectUrl = `${api.baseUrl}/auth/instagram/login`;
const LEVEL_RANK: Record<MetaUsageLevel, number> = { ok: 0, warn: 1, over: 2 };
const KIND_LABELS: Record<string, string> = {
  "sync.list": "sync: conversation lists",
  "sync.thread": "sync: threads",
  "sync.message": "sync: messages",
  profile: "profile lookups",
  send: "sends",
  auth: "connect",
};

// One-line summary under each account in the panel; hover for the breakdown.
function usageLine(u: MetaAccountUsage): string {
  const parts = [`${u.calls.lastHour} calls/h`, `${u.calls.last24h}/24h`];
  if (u.meta?.highestPct != null) parts.push(`Meta ${Math.round(u.meta.highestPct)}%`);
  if (u.lastSyncCalls != null) parts.push(`last sync ${u.lastSyncCalls} calls`);
  return parts.join(" · ");
}

function usageTooltip(u: MetaAccountUsage, t: MetaUsageResponse["thresholds"]): string {
  const lines = [
    `Sends in the last hour: ${u.sendsLastHour} (amber at ${t.sendsWarn}, red at ${t.sendsOver})`,
    u.meta
      ? `Meta-reported usage: calls ${u.meta.callCountPct ?? "?"}%, time ${u.meta.totalTimePct ?? "?"}%, CPU ${u.meta.totalCputimePct ?? "?"}% (updated ${formatRelativeTime(u.meta.updatedAt)})`
      : "Meta-reported usage: no reading in the last 24h",
    "",
    "Calls in the last 24h:",
    ...Object.entries(u.calls.byKind).map(([kind, n]) => `  ${KIND_LABELS[kind] ?? kind}: ${n}`),
  ];
  if (u.calls.last24h === 0) lines.push("  none");
  if (u.lastThrottledAt) lines.push("", `Throttled by Meta ${formatRelativeTime(u.lastThrottledAt)}`);
  if (u.meta?.regainAccessMinutes) lines.push(`Meta estimates access back in ${u.meta.regainAccessMinutes} min`);
  return lines.join("\n");
}

interface Props {
  accounts: InstagramAccount[];
  onChange: () => void;
}

export function AccountConnection({ accounts, onChange }: Props) {
  const [banner, setBanner] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  // setSyncingAll is only used by the disabled auto-sync block below.
  const [syncingAll] = useState(false);
  const [usage, setUsage] = useState<MetaUsageResponse | null>(null);

  // Meta API usage meter (docs/meta-api-usage-meter.md). Reading it costs
  // no Meta calls, so polling is cheap.
  // Also refreshes the account list, so a token Meta rejected during a
  // send or background call shows up as "Reconnect" without a Sync.
  const refreshUsage = () => {
    api.metaUsage().then(setUsage).catch(() => {});
  };
  const refreshAfterMetaCall = () => {
    refreshUsage();
    onChange();
  };

  useEffect(() => {
    refreshUsage();
    const timer = window.setInterval(refreshUsage, USAGE_POLL_MS);
    window.addEventListener("meta-usage-changed", refreshAfterMetaCall);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("meta-usage-changed", refreshAfterMetaCall);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsReconnect = accounts.some((a) => a.needsReconnect);

  const usageById = new Map(usage?.accounts.map((u) => [u.accountId, u]));
  const worstLevel = (usage?.accounts ?? []).reduce<MetaUsageLevel>(
    (worst, u) => (LEVEL_RANK[u.level] > LEVEL_RANK[worst] ? u.level : worst),
    "ok",
  );
  const highestMetaPct = Math.max(0, ...(usage?.accounts ?? []).map((u) => u.meta?.highestPct ?? 0));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("instagram");
    if (result === "connected") setBanner(`Connected @${params.get("username") ?? "account"}.`);
    if (result === "error") setBanner(`Instagram connection failed: ${params.get("reason") ?? "unknown error"}`);
    if (result) {
      window.history.replaceState({}, "", window.location.pathname);
      setOpen(true);
      onChange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-sync on returning to the tab is disabled for now (was: syncs every
  // connected account on tab focus/visibility). Re-enable by uncommenting.
  // const accountsRef = useRef(accounts);
  // accountsRef.current = accounts;
  // const syncingAllRef = useRef(false);
  // const lastSyncAtRef = useRef(0);
  //
  // useEffect(() => {
  //   const syncAll = async () => {
  //     if (document.visibilityState !== "visible") return;
  //     if (syncingAllRef.current) return;
  //     if (Date.now() - lastSyncAtRef.current < 15_000) return;
  //     const current = accountsRef.current;
  //     if (current.length === 0) return;
  //
  //     syncingAllRef.current = true;
  //     lastSyncAtRef.current = Date.now();
  //     setSyncingAll(true);
  //     try {
  //       await Promise.allSettled(current.map((a) => api.syncInstagramAccount(a.id)));
  //       onChange();
  //       window.dispatchEvent(new Event("accounts-synced"));
  //     } finally {
  //       syncingAllRef.current = false;
  //       setSyncingAll(false);
  //     }
  //   };
  //
  //   document.addEventListener("visibilitychange", syncAll);
  //   window.addEventListener("focus", syncAll);
  //   return () => {
  //     document.removeEventListener("visibilitychange", syncAll);
  //     window.removeEventListener("focus", syncAll);
  //   };
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, []);

  const handleDisconnect = async (id: number) => {
    await api.disconnectInstagramAccount(id);
    onChange();
  };

  const handleSync = async (id: number) => {
    setSyncingId(id);
    try {
      const result = await api.syncInstagramAccount(id);
      setBanner(
        `Synced: ${result.conversations} conversation(s), ${result.newMessages} new message(s), ${result.apiCalls} Meta API call(s).`,
      );
      onChange();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { needsReconnect?: boolean }) : null;
      if (body?.needsReconnect) {
        // Meta invalidated the token (password change, security reset,
        // expiry). The only fix is logging in again, so take them there.
        const account = accounts.find((a) => a.id === id);
        setBanner(
          `Instagram signed @${account?.username ?? "this account"} out. Taking you to log in again...`,
        );
        window.setTimeout(() => window.location.assign(reconnectUrl), RECONNECT_REDIRECT_MS);
        return;
      }
      setBanner(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingId(null);
      refreshUsage();
    }
  };

  return (
    <div className="account-connection">
      <button
        className="platform-status-btn"
        onClick={() => setOpen((o) => !o)}
        title={
          accounts.length === 0
            ? "No Instagram accounts connected"
            : needsReconnect
            ? "An Instagram account was signed out and needs reconnecting"
            : `${accounts.length} Instagram account(s) connected. Meta API usage: ${
                worstLevel === "over" ? "over the limit, ease off" : worstLevel === "warn" ? "getting high" : "fine"
              } (highest Meta-reported ${Math.round(highestMetaPct)}%)`
        }
      >
        <span
          className={
            accounts.length === 0 || needsReconnect
              ? "platform-status-dot platform-status-dot--disconnected"
              : `platform-status-dot platform-status-dot--${worstLevel === "ok" ? "connected" : worstLevel}`
          }
        />
        <PlatformIcon platform="instagram" size={14} />
        <span>{accounts.length}</span>
        {accounts.length > 0 && (
          <span className={`usage-meter usage-meter--${worstLevel}`} aria-hidden="true">
            <span className="usage-meter__fill" style={{ width: `${Math.min(100, highestMetaPct)}%` }} />
          </span>
        )}
      </button>
      {open && (
        <div className="account-connection__panel">
          <div className="account-connection__panel-header">
            <span>Instagram accounts</span>
            <button className="icon-btn icon-btn--ghost" onClick={() => setOpen(false)} title="Close" aria-label="Close">
              <IconX size={13} />
            </button>
          </div>

          {banner && <div className="account-connection__banner">{banner}</div>}

          {accounts.length === 0 ? (
            <p className="empty-state">No accounts connected yet.</p>
          ) : (
            <ul className="account-connection__list">
              {accounts.map((a) => (
                <li key={a.id}>
                  <span className="account-connection__identity">
                    <Avatar src={a.profilePictureUrl} label={a.username ?? a.igUserId} size={26} />
                    <span className="account-connection__identity-text">
                      @{a.username ?? a.igUserId}
                      {a.needsReconnect && (
                        <span className="account-connection__usage account-connection__usage--over">
                          Signed out by Instagram. Reconnect to keep syncing.
                        </span>
                      )}
                      {usageById.get(a.id) && usage && (
                        <span
                          className={`account-connection__usage account-connection__usage--${usageById.get(a.id)!.level}`}
                          title={usageTooltip(usageById.get(a.id)!, usage.thresholds)}
                        >
                          {usageLine(usageById.get(a.id)!)}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="account-connection__actions">
                    {a.needsReconnect && (
                      <a className="account-connection__reconnect" href={reconnectUrl}>
                        Reconnect
                      </a>
                    )}
                    <button
                      className="icon-btn"
                      onClick={() => handleSync(a.id)}
                      disabled={syncingId === a.id || syncingAll}
                      title={syncingId === a.id ? "Syncing..." : "Sync now"}
                      aria-label="Sync now"
                    >
                      {syncingId === a.id || syncingAll ? <Spinner size={13} /> : <IconRefresh size={13} />}
                    </button>
                    <button
                      className="icon-btn icon-btn--danger"
                      onClick={() => handleDisconnect(a.id)}
                      title="Disconnect"
                      aria-label="Disconnect"
                    >
                      <IconX size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <a className="connect-btn" href={`${api.baseUrl}/auth/instagram/login`}>
            + Connect {accounts.length > 0 ? "another" : "an"} Instagram account
          </a>
        </div>
      )}
    </div>
  );
}
