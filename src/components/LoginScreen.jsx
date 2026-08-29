import { useState } from "react";
import { CalendarCheck, ClipboardCheck, Eye, EyeOff, LockKeyhole, LogIn, Mail, ShieldCheck } from "lucide-react";

export default function LoginScreen({ store, onLogin, onSsoLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onLogin({ email: email.trim(), password });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-lockup">
          <img className="login-brand-logo" src="/images/logo2.svg" alt="University of Santo Tomas seal" />
          <div>
            <p className="brand-name">RESERVATA</p>
            <p className="brand-subtitle">UST Resource Reservation</p>
          </div>
        </div>

        <div className="login-heading">
          <p className="eyebrow">University resource portal</p>
          <h1 id="login-title">
            <span className="welcome-line">Welcome to</span>
            <span className="product-line">RESERVATA</span>
          </h1>
          <p className="login-copy">A unified UST operations portal for venue reservations, equipment and vehicle requests, payment verification, visitor access, and approval tracking.</p>
        </div>

        {store.backendMode === "aws" ? (
          <button className="primary-button sso-button" onClick={onSsoLogin} type="button">
            <LogIn aria-hidden="true" size={18} />
            Sign in with University SSO
          </button>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <label className="login-field">
              <span>University email</span>
              <span className="login-input-wrap">
                <Mail aria-hidden="true" size={18} />
                <input
                  autoComplete="username"
                  inputMode="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@ust.edu.ph"
                  required
                  type="email"
                  value={email}
                />
              </span>
            </label>

            <label className="login-field">
              <span>Password</span>
              <span className="login-input-wrap">
                <LockKeyhole aria-hidden="true" size={18} />
                <input
                  autoComplete="current-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? "Hide password" : "Show password"}
                  type="button"
                >
                  {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                </button>
              </span>
            </label>

            <button className="primary-button login-submit" disabled={submitting} type="submit">
              <LogIn aria-hidden="true" size={18} />
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </section>

      <aside className="login-preview" aria-label="University of Santo Tomas Main Building">
        <div className="preview-content">
          <div className="preview-kicker">
            <span className="preview-dot" aria-hidden="true" />
            Built for campus operations
          </div>
          <h2>One command center for UST spaces, assets, guests, and approvals.</h2>
          <p>RESERVATA keeps campus requests organized from submission to final confirmation, with routing, approvals, and status updates in one place.</p>

          <div className="preview-features" aria-label="Platform highlights">
            <article>
              <CalendarCheck aria-hidden="true" size={19} />
              <div>
                <strong>Availability first</strong>
                <span>Check venues, vehicles, and equipment before sending a request.</span>
              </div>
            </article>
            <article>
              <ClipboardCheck aria-hidden="true" size={19} />
              <div>
                <strong>Traceable approvals</strong>
                <span>Route decisions through the right offices with complete activity history.</span>
              </div>
            </article>
            <article>
              <ShieldCheck aria-hidden="true" size={19} />
              <div>
                <strong>Visitor-ready</strong>
                <span>Prepare guest access, parking needs, and arrival monitoring in one flow.</span>
              </div>
            </article>
          </div>
        </div>
      </aside>
    </main>
  );
}
