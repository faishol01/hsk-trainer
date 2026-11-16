export function initMobileLayout() {
  const mobile = window.matchMedia("(max-width:900px)");
  const sidebar = document.querySelector("#sidebar");
  const launch = document.querySelector("#browse-words");
  const close = document.querySelector("#browser-close");
  const backdrop = document.querySelector("#browser-backdrop");
  const header = document.querySelector("body > header");
  const main = document.querySelector(".layout > main");
  let open = false;
  function setOpen(next, restoreFocus = true) {
    open = next && mobile.matches;
    document.body.classList.toggle("mobile-browser-open", open);
    launch.setAttribute("aria-expanded", String(open));
    backdrop.hidden = !open;
    header.inert = open;
    main.inert = open;
    if (open) {
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
      sidebar.setAttribute("aria-labelledby", "browser-title");
      close.focus();
    } else {
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
      sidebar.removeAttribute("aria-labelledby");
      if (restoreFocus && mobile.matches) launch.focus();
    }
  }
  window.addEventListener("hsk-feature-leaving", () => setOpen(false, false));
  launch.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  document.querySelector("#list").addEventListener("click", (event) => {
    if (open && event.target.closest("[data-i]")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...sidebar.querySelectorAll("button,input,select,a[href],[tabindex]"),
    ].filter(
      (el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length,
    );
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  mobile.addEventListener("change", () => setOpen(false, false));
  function updateViewport() {
    document.documentElement.style.setProperty(
      "--mobile-viewport-height",
      (window.visualViewport?.height || window.innerHeight) + "px",
    );
  }
  window.visualViewport?.addEventListener("resize", updateViewport);
  window.addEventListener("resize", updateViewport);
  updateViewport();
}
