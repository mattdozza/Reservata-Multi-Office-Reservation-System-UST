import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { LoadingScreen } from "./components/Common.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import { isViewAllowed, navItemsFor } from "./config.js";
import { ReservataStore } from "./store.js";
import { completeSsoLogin } from "./services/ssoAuth.js";
import { confirmLeaveForms } from "./shared/formSafety.js";

const AppShell = lazy(() => import("./components/AppShell.jsx"));
const ViewRouter = lazy(() => import("./views/ViewRouter.jsx"));

export default function App() {
  const storeRef = useRef(new ReservataStore());
  const initializedRef = useRef(false);
  const toastTimerRef = useRef(null);
  const operationRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [, setRevision] = useState(0);
  const [toast, setToast] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [selectedSchedule, setSelectedSchedule] = useState(null);
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
      if (view !== store.session.activeView && !confirmLeaveForms()) return;
      if (!isViewAllowed(store.session.activeRole, view, store.currentUser.requesterType)) {
        store.setView(store.currentUser.home);
        refresh();
        showToast("That page is not available for this role.");
        return;
      }
      store.setView(view);
      if (view !== "newRequest") {
        setSelectedResourceId("");
        setSelectedSchedule(null);
      }
      refresh();
    },
    [refresh, showToast, store],
  );

  const perform = useCallback(
    async (operation, successMessage) => {
      if (operationRef.current) return false;
      operationRef.current = true;
      try {
        await operation();
        window.dispatchEvent(new Event("reservata:action-success"));
        refresh();
        if (successMessage) showToast(successMessage);
        return true;
      } catch (error) {
        window.dispatchEvent(new CustomEvent("reservata:action-error", { detail: error.message || "The action could not be completed." }));
        showToast(error.message || "The action could not be completed.");
        return false;
      } finally {
        operationRef.current = false;
      }
    },
    [refresh, showToast],
  );

  async function logout() {
    if (!confirmLeaveForms()) return;
    await store.logout();
    setSelectedResourceId("");
    setSelectedSchedule(null);
    refresh();
  }

  async function reset() {
    const confirmed = window.confirm(
      "Reset all local demonstration data to the original sample records?",
    );
    if (!confirmed) return;
    await perform(() => store.reset(), "Demo data has been reset.");
  }

  function reserve(resourceId, schedule = null) {
    setSelectedResourceId(resourceId);
    setSelectedSchedule(schedule);
    navigate("newRequest");
  }

  function showNotifications() {
    const canOpen = navItemsFor(store.session.activeRole, store.currentUser.requesterType).some(
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
        <LoginScreen />
      ) : (
        <Suspense fallback={<LoadingScreen />}>
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
              selectedSchedule={selectedSchedule}
              onAction={perform}
              onNavigate={navigate}
              onReserve={reserve}
            />
          </AppShell>
        </Suspense>
      )}
    </>
  );
}
