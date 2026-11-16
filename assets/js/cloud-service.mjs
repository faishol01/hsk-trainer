import { publishCloudStatus } from "./cloud-status.mjs";

// Authentication/status are shared by every page, without loading word data on Home.
let service;
export function ensureCloudSync(entries) {
  if (!service) {
    publishCloudStatus({ phase: "checking", online: true });
    service = import("./cloud-sync.mjs")
      .then((module) => module.initCloudSync([], { bindLaunch: false }))
      .catch((error) => {
        const message =
          "Cloud sync could not load. Local review is still available.";
        document.getElementById("cloud-status").textContent = message;
        publishCloudStatus({ phase: "error", online: true, message });
        console.error(error);
        return null;
      });
  }
  return service.then((controller) => {
    if (entries) controller?.setVocabulary(entries);
    return controller;
  });
}
