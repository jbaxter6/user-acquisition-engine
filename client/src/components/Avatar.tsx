import { useState } from "react";
import type { Platform } from "../types";
import { PlatformIcon } from "./PlatformIcon";

interface Props {
  src: string | null;
  label: string;
  size?: number;
  title?: string;
  // Set to false only for a conversation participant who hasn't actually
  // engaged with us yet (outbound-only so far) — Meta withholds their
  // profile/avatar until they do, so this isn't a "photo failed to load,"
  // it's a meaningful signal worth showing differently. Omit/true for
  // everything else (our own connected accounts, anyone who has replied).
  engaged?: boolean;
}

export function Avatar({ src, label, size = 28, title, engaged = true }: Props) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.42 };
  const tooltip = title ?? label;

  if (src && !failed) {
    return (
      <img
        className="avatar"
        style={style}
        src={src}
        alt={label}
        title={tooltip}
        referrerPolicy="no-referrer"
        // Instagram CDN avatar URLs expire periodically — fall back to the
        // initial rather than showing a broken image icon.
        onError={() => setFailed(true)}
      />
    );
  }

  if (!engaged) {
    return (
      <span
        className="avatar avatar--pending"
        style={style}
        title="Hasn't engaged yet — no photo available until they reply"
        aria-label="Not yet engaged"
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.68}
          height={size * 0.68}
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4.2" />
          <path d="M3.5 21c0-4.4 3.8-7 8.5-7s8.5 2.6 8.5 7z" />
        </svg>
      </span>
    );
  }

  return (
    <span className="avatar avatar--fallback" style={style} title={tooltip}>
      {label.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

// Avatar with the platform icon in its corner — the same look as the
// prospect cards, scaled to the avatar size.
export function PlatformAvatar({
  platform,
  ...avatarProps
}: Props & { platform: Platform }) {
  const size = avatarProps.size ?? 28;
  const badge = Math.round(size * 0.47);
  const offset = -Math.round(size * 0.09);
  return (
    <span className="avatar-wrap">
      <Avatar {...avatarProps} />
      <span
        className="avatar-wrap__badge"
        style={{ width: badge, height: badge, right: offset, bottom: offset }}
      >
        <PlatformIcon platform={platform} size={Math.round(badge * 0.62)} />
      </span>
    </span>
  );
}
