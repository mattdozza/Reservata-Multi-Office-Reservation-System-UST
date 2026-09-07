export function PageTabs({ id, label, tabs, value, onChange }) {
  return (
    <div className="page-tabs" role="tablist" aria-label={label}>
      {tabs.map(([key, title], index) => (
        <button
          id={`${id}-tab-${key}`}
          key={key}
          role="tab"
          type="button"
          aria-selected={value === key}
          aria-controls={`${id}-panel-${key}`}
          tabIndex={value === key ? 0 : -1}
          onClick={() => onChange(key)}
          onKeyDown={(event) => {
            const offsets = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - index - 1 };
            if (!(event.key in offsets)) return;
            event.preventDefault();
            const next = tabs[(index + offsets[event.key] + tabs.length) % tabs.length][0];
            onChange(next);
            document.getElementById(`${id}-tab-${next}`)?.focus();
          }}
        >
          {title}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, name, value, children }) {
  return (
    <section
      id={`${id}-panel-${name}`}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${name}`}
      hidden={value !== name}
    >
      {children}
    </section>
  );
}
