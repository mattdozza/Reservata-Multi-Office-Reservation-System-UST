import {
  Activity,
  Bell,
  Building2,
  CalendarDays,
  CarFront,
  CheckSquare,
  CircleParking,
  ClipboardList,
  CreditCard,
  FileArchive,
  GitBranch,
  Home,
  LogOut,
  Package,
  PlusCircle,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import { navItemsFor, PAGE_TITLES } from "../config.js";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const VIEW_ICONS = {
  dashboard: Home,
  resources: Search,
  newRequest: PlusCircle,
  myRequests: ClipboardList,
  calendar: CalendarDays,
  notifications: Bell,
  approvalQueue: CheckSquare,
  payments: CreditCard,
  activity: Activity,
  offices: Building2,
  users: UsersRound,
  workflows: GitBranch,
  officeSettings: Settings,
  visitorRequests: ShieldCheck,
  eventReviews: CheckSquare,
  parking: CircleParking,
  arrivals: CarFront,
  visitorRecords: FileArchive,
  newVisitor: PlusCircle,
  myVisitorRequests: ClipboardList,
  profile: UserRound
};

function navCount(store, view) {
  if (["approvalQueue", "eventReviews"].includes(view)) return store.actionableApprovalCount;
  if (view === "payments") return store.officePayments.filter((item) => item.status === "Pending Verification").length;
  if (view === "visitorRequests") return store.data.visitors.filter((item) => item.status === "Pending").length;
  if (view === "notifications") return store.visibleNotifications.filter((item) => item.unread).length;
  return 0;
}

export default function AppShell({ store, onNavigate, onLogout, onReset, onNotification, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const user = store.currentUser;
  const navItems = navItemsFor(store.session.activeRole, user.requesterType);
  const [title, subtitle] = PAGE_TITLES[store.session.activeView] || PAGE_TITLES.dashboard;
  const unread = store.visibleNotifications.filter((item) => item.unread).length;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "menu-open" : ""}`}>
        <header className="sidebar-header">
          <button className="brand-button" onClick={() => onNavigate(user.home)} type="button">
            <img className="brand-logo" src="/images/logo2.svg" alt="University of Santo Tomas seal" />
            <span>
              <span className="brand-name">RESERVATA</span>
              <span className="brand-subtitle">{user.portal}</span>
            </span>
          </button>
        </header>
        <button className="mobile-menu-button ghost-button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="portal-navigation" onClick={() => setMenuOpen((open) => !open)} type="button">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <div className="office-pill">{user.office}</div>
        <nav id="portal-navigation" className="sidebar-nav" aria-label="Portal navigation">
          {navItems.map(([view, label]) => {
            const Icon = VIEW_ICONS[view] || Package;
            const count = navCount(store, view);
            return (
              <button
                className={`nav-button ${store.session.activeView === view ? "active" : ""}`}
                onClick={() => { onNavigate(view); setMenuOpen(false); }}
                aria-current={store.session.activeView === view ? "page" : undefined}
                type="button"
                key={view}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{label}</span>
                {count > 0 && <b>{count}</b>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="ghost-button icon-text-button" onClick={onLogout} type="button">
            <LogOut aria-hidden="true" size={16} /> Sign out
          </button>
          {store.session.activeRole === "superAdmin" && store.backendMode === "local" && (
            <button className="danger-button icon-text-button" onClick={onReset} type="button">
              <RotateCcw aria-hidden="true" size={16} /> Reset Demo Data
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={onNotification} type="button" aria-label="Show notifications" title="Notifications">
              <Bell aria-hidden="true" size={18} />
              {unread > 0 && <b>{unread}</b>}
            </button>
            <button className="profile-chip" onClick={() => onNavigate("profile")} type="button">
              <span>{user.initials}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.roleLabel}</small>
              </span>
            </button>
          </div>
        </header>

        <section className="view-root" data-view={store.session.activeView} key={store.session.activeView}>{children}</section>
      </main>
    </div>
  );
}
