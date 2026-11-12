export function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

export function norm(v) {
  return v
    .toLowerCase()
    .replace(/ü/g, "v")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/v/g, "u");
}
