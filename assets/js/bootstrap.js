// Run after the document and the bundled network library have loaded.
const quizLaunch = document.getElementById("quiz-open");
quizLaunch.onclick = () => {
  window.__openQuizWhenReady = true;
};
function reportLoadError(error) {
  const loader = document.getElementById("network-loading");
  loader.hidden = false;
  loader.innerHTML =
    '<div class="loading-card"><strong>Could not load the viewer</strong><span>Refresh the page to try again.</span></div>';
  console.error(error);
}
import("./mobile.mjs")
  .then((module) => module.initMobileLayout())
  .catch(reportLoadError);
import("./app.mjs").then((module) => module.startApp()).catch(reportLoadError);
