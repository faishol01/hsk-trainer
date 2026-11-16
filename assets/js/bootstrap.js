// The chooser loads first. Data and feature modules load only when selected.
import("./shell.mjs")
  .then((module) => module.initFeatureShell())
  .catch((error) => {
    document.getElementById("feature-status").textContent =
      "Could not load the feature menu. Refresh the page to try again.";
    console.error(error);
  });
