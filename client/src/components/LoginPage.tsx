import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { IconEye, IconEyeOff, IconLock, Spinner } from "./icons";

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login login--stacked">
      <div className="login__glow" aria-hidden="true" />
      <form className="login__card" onSubmit={handleSubmit}>
        <span className="app__brand-mark login__mark">JB</span>
        <h1 className="login__title">Welcome back</h1>
        <p className="login__subtitle">
          Enter the team password to open the Smooth Unified Mailbox.
        </p>

        <label className="login__field">
          <span className="login__label">Password</span>
          <span
            className={
              error ? "login__input login__input--error" : "login__input"
            }
          >
            <IconLock size={16} />
            <input
              type={visible ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter password"
              autoComplete="current-password"
              autoFocus
              aria-invalid={error != null}
            />
            <button
              type="button"
              className="login__toggle"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </span>
        </label>

        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}

        <button
          className="login__submit"
          type="submit"
          disabled={!password || submitting}
        >
          {submitting ? (
            <>
              <Spinner size={16} /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>

        <p className="login__footer">Smooth Media Technologies LLC</p>
      </form>

      <span className="login__links">
        <a className="login__privacy" href={`${api.baseUrl}/about`}>
          About Smooth
        </a>
      <a
        className="login__privacy"
        href={`${api.baseUrl}/privacy`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Privacy Policy
      </a>
      </span>
    </main>
  );
}
