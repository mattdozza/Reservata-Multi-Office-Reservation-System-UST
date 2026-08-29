import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "./components/AppShell.jsx";
import { LoadingScreen } from "./components/Common.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import { isViewAllowed, NAV_ITEMS } from "./config.js";
import { ReservataStore } from "./store.js";
import { completeSsoLogin, startSsoLogin } from "./ssoAuth.js";
import ViewRouter from "./views/ViewRouter.jsx";

export default function App() {
  const storeRef = useRef(new ReservataStore());
  const initializedRef = useRef(false);
  const toastTimerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [, setRevision] = useState(0);
  const [toast, setToast] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const store = storeRef.current;

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2800);
  }, []);

  useEffect(() => {
    if (initializedRef.current) return undefined;
    initializedRef.current = true;
    let active = true;
    completeSsoLogin()
      .then(() => store.init())
      .then(() => {
        if (!active) return;
        setReady(true);
      })
      .catch((error) => {
        if (!active) return;
        showToast(error.message || "RESERVATA could not start.");
        setReady(true);
      });
    return () => {
      active = false;
      clearTimeout(toastTimerRef.current);
    };
  }, [showToast, store]);

  const navigate = useCallback(
    (view) => {
      if (!isViewAllowed(store.session.activeRole, view)) {
        store.setView(store.currentUser.home);
        refresh();
        showToast("That page is not available for this role.");
        return;
      }
      store.setView(view);
      refresh();
    },
    [refresh, showToast, store],
  );

  const perform = useCallback(
    async (operation, successMessage) => {
      try {
        await operation();
        refresh();
        if (successMessage) showToast(successMessage);
        return true;
      } catch (error) {
        showToast(error.message || "The action could not be completed.");
        return false;
      }
    },
    [refresh, showToast],
  );

  async function login({ email, password }) {
    const signedIn = await perform(() => store.login(email, password));
    if (signedIn) setSelectedResourceId("");
    return signedIn;
  }

  async function logout() {
    await store.logout();
    setSelectedResourceId("");
    refresh();
  }

  async function reset() {
    const confirmed = window.confirm(
      "Reset all local demonstration data to the original sample records?",
    );
    if (!confirmed) return;
    await perform(() => store.reset(), "Demo data has been reset.");
  }

  function reserve(resourceId) {
    setSelectedResourceId(resourceId);
    navigate("newRequest");
  }

  function showNotifications() {
    const canOpen = NAV_ITEMS[store.session.activeRole]?.some(
      ([view]) => view === "notifications",
    );
    if (canOpen) navigate("notifications");
    else
      showToast(
        `${store.visibleNotifications.filter((item) => item.unread).length} unread system notifications.`,
      );
  }

  if (!ready) return <LoadingScreen />;

  return (
    <>
      <div
        className={`toast ${toast ? "show" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
      {!store.session.activeRole ? (
        <LoginScreen
          store={store}
          onLogin={login}
          onSsoLogin={() => perform(startSsoLogin)}
        />
      ) : (
        <AppShell
          store={store}
          onNavigate={navigate}
          onLogout={logout}
          onReset={reset}
          onNotification={showNotifications}
        >
          <ViewRouter
            store={store}
            selectedResourceId={selectedResourceId}
            onAction={perform}
            onNavigate={navigate}
            onReserve={reserve}
          />
        </AppShell>
      )}
    </>
  );
}
