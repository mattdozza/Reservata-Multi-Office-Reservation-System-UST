import { useEffect, useState } from "react";
import { CalendarCheck, ClipboardCheck, LogIn, ShieldCheck } from "lucide-react";
import { prepareSsoLogin, ssoProviderLabel } from "../services/ssoAuth.js";

export default function LoginScreen() {
  const [loginUrl, setLoginUrl] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    let active = true;
    prepareSsoLogin()
      .then((url) => {
        if (active) setLoginUrl(url);
      })
      .catch((error) => {
        if (active) setLoginError(error.message || "University SSO sign-in is unavailable.");
      });
    return () => {
      active = false;
    };
  }, []);

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

        <a
          aria-disabled={!loginUrl}
          className="primary-button login-submit sso-button"
          href={loginUrl || undefined}
        >
          <LogIn aria-hidden="true" size={18} />
          Sign in with {ssoProviderLabel}
        </a>
        {loginError ? <p className="login-error" role="alert">{loginError}</p> : null}
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
