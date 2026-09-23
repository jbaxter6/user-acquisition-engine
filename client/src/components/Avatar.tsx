import { useState } from "react";

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
      />
    );
  }

  return (
    <span className="avatar avatar--fallback" style={style} title={tooltip}>
      {label.charAt(0).toUpperCase() || "?"}
    </span>
  );
}
