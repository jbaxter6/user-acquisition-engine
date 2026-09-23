import { useState } from "react";

interface Props {
  src: string | null;
  label: string;
  size?: number;
}

export function Avatar({ src, label, size = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.42 };

  if (src && !failed) {
    return (
      <img
        className="avatar"
        style={style}
        src={src}
        alt={label}
        referrerPolicy="no-referrer"
        // Instagram CDN avatar URLs expire periodically — fall back to the
        // initial rather than showing a broken image icon.
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="avatar avatar--fallback" style={style}>
      {label.charAt(0).toUpperCase() || "?"}
    </span>
  );
}
