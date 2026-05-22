// Component contract: default export is (target, props, emit) => unmount.
// `target` is a fresh element to render into; `props` updates on each
// render call; `emit(name, detail)` sends an event to the host.
export default function stage(target, props, _emit) {
  const root = document.createElement("div");
  root.className = "agent-stage";
  render(root, props);
  target.appendChild(root);
  return () => {
    target.removeChild(root);
  };

  function render(el, p) {
    const draft = p?.draft ?? "";
    el.innerHTML = "";
    const pre = document.createElement("pre");
    pre.textContent = draft || "(no draft yet — the agent will write here)";
    el.appendChild(pre);
  }
}
