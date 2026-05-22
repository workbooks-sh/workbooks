export default function stage(target, props, _emit) {
  const root = document.createElement("div");
  root.className = "ugc-stage";
  target.appendChild(root);
  render(root, props);

  const observer = new MutationObserver(() => render(root, currentProps(target)));
  observer.observe(target, { attributes: true, attributeFilter: ["data-props"] });

  return () => {
    observer.disconnect();
    target.removeChild(root);
  };

  function currentProps(host) {
    const raw = host.getAttribute("data-props");
    if (!raw) return props;
    try {
      return JSON.parse(raw);
    } catch {
      return props;
    }
  }

  function render(el, p) {
    const body = (p?.content ?? p?.draft ?? "").toString();
    const filepath = (p?.filepath ?? "").toString();
    const header = filepath
      ? `<p class="filepath"><code>${escapeHtml(filepath)}</code></p>`
      : "";
    el.innerHTML = body
      ? header + renderMarkdown(stripSvelteShell(body))
      : '<p class="placeholder">script renders here as the agent writes</p>';
  }
}

/** The agent writes scripts inside src/App.svelte as a single <article>.
 *  Strip the outer Svelte/HTML shell so the stage shows just the prose. */
function stripSvelteShell(src) {
  const articleMatch = src.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1].trim();
  return src;
}

function renderMarkdown(src) {
  const blocks = src.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks.map(renderBlock).join("\n");
}

function renderBlock(block) {
  const trimmed = block.trim();
  if (!trimmed) return "";

  let m;
  if ((m = trimmed.match(/^#\s+(.*)$/))) return `<h1>${inline(m[1])}</h1>`;
  if ((m = trimmed.match(/^##\s+(.*)$/))) return `<h2>${inline(m[1])}</h2>`;
  if ((m = trimmed.match(/^###\s+(.*)$/))) return `<h3>${inline(m[1])}</h3>`;

  if (trimmed.startsWith("```")) {
    const body = trimmed.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
    return `<pre><code>${escapeHtml(body)}</code></pre>`;
  }

  const lines = trimmed.split("\n");
  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    const items = lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`).join("");
    return `<ul>${items}</ul>`;
  }

  return `<p>${lines.map(inline).join("<br>")}</p>`;
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
