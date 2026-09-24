import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import { LoginPage } from "./LoginPage";
import { Spinner } from "./icons";

type Status = "loading" | "login" | "ready";

interface AuthContextValue {
  // False when the server has no SITE_PASSWORD (e.g. local dev) — there's
  // nothing to sign out of, so the header hides the button.
  passwordRequired: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  passwordRequired: false,
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [failed, setFailed] = useState(false);

  const check = useCallback(() => {
    api
      .session()
      .then((s) => {
        setFailed(false);
        setPasswordRequired(s.required);
        setStatus(s.authenticated ? "ready" : "login");
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(check, [check]);

  useEffect(() => {
    const onAuthRequired = () => setStatus("login");
    window.addEventListener("auth-required", onAuthRequired);
    return () => window.removeEventListener("auth-required", onAuthRequired);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setStatus("login");
  }, []);

  if (failed) {
    return (
      <main className="login">
        <div className="login__card login__card--center">
          <h1 className="login__title">Can't reach the server</h1>
          <p className="login__subtitle">
            Check your connection, then try again.
          </p>
          <button className="login__submit" onClick={check}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (status === "loading") {
    return (
      <main className="login">
        <span className="login__loading">
          <Spinner size={22} />
        </span>
      </main>
    );
  }

  if (status === "login") {
    return <LoginPage onSuccess={() => setStatus("ready")} />;
  }

  return (
    <AuthContext.Provider value={{ passwordRequired, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
