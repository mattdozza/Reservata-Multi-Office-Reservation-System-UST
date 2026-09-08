const guards = new Set();

export function registerFormGuard(guard) {
  guards.add(guard);
  return () => guards.delete(guard);
}

export function confirmLeaveForms() {
  if (![...guards].some((guard) => guard())) return true;
  return window.confirm("You have unsaved changes. Leave this page? Reservation drafts will remain saved on this device.");
}
