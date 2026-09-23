import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Avatar } from "./Avatar";
import { PlatformIcon } from "./PlatformIcon";
import { IconRefresh, IconX, Spinner } from "./icons";
import type { InstagramAccount } from "../types";

interface Props {
  accounts: InstagramAccount[];
  onChange: () => void;
}

export function AccountConnection({ accounts, onChange }: Props) {
  const [banner, setBanner] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);

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

  const handleDisconnect = async (id: number) => {
    await api.disconnectInstagramAccount(id);
    onChange();
  };

  const handleSync = async (id: number) => {
    setSyncingId(id);
    try {
      const result = await api.syncInstagramAccount(id);
      setBanner(`Synced: ${result.conversations} conversation(s), ${result.newMessages} new message(s).`);
      onChange();
    } catch (err) {
      setBanner(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="account-connection">
      <button
        className="platform-status-btn"
        onClick={() => setOpen((o) => !o)}
        title={accounts.length > 0 ? `${accounts.length} Instagram account(s) connected` : "No Instagram accounts connected"}
      >
        <span
          className={
            accounts.length > 0 ? "platform-status-dot platform-status-dot--connected" : "platform-status-dot platform-status-dot--disconnected"
          }
        />
        <PlatformIcon platform="instagram" size={14} />
        <span>{accounts.length}</span>
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
                    @{a.username ?? a.igUserId}
                  </span>
                  <span className="account-connection__actions">
                    <button
                      className="icon-btn"
                      onClick={() => handleSync(a.id)}
                      disabled={syncingId === a.id}
                      title={syncingId === a.id ? "Syncing..." : "Sync now"}
                      aria-label="Sync now"
                    >
                      {syncingId === a.id ? <Spinner size={13} /> : <IconRefresh size={13} />}
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
