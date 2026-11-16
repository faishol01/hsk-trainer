export function cloudStatusLabel({
  phase = "checking",
  account = null,
  online = true,
} = {}) {
  if (account && !online) return "Cloud sync: offline";
  return (
    {
      checking: "Cloud sync: checking...",
      disabled: "Cloud sync: off",
      "signed-out": "Cloud sync: signed out",
      syncing: "Cloud sync: syncing...",
      pending: "Cloud sync: waiting to sync",
      synced: "Cloud sync: up to date",
      error: "Cloud sync: unavailable",
    }[phase] || "Cloud sync: checking..."
  );
}

export function publishCloudStatus(state) {
  const indicator = document.getElementById("cloud-sync-indicator");
  if (!indicator) return;
  indicator.hidden = false;
  indicator.dataset.state =
    state.account && !state.online ? "offline" : state.phase;
  document.getElementById("cloud-sync-summary").textContent =
    cloudStatusLabel(state);
  document.getElementById("cloud-sync-account").textContent =
    state.account?.email ||
    (state.account ? "Signed-in account" : "Local progress only");
  if (state.message) indicator.title = state.message;
}
