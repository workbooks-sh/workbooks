// workbook/correctness/no-composio-slug
//
// Warn on hardcoded `"composio:<toolkit>"` slugs in workbook source.
//
// Composio is being phased out (wb-q6rb) in favor of:
//   - Custom OAuth per provider (Google, Microsoft, Slack, Meta,
//     TikTok, etc.) with tokens stored KEK-wrapped in broker D1
//   - Env-var API keys via providerKeys (OpenAI, Anthropic, Stripe,
//     Resend, Twilio, Supabase, Cloudflare, etc.)
//
// Any string literal of the form `composio:<slug>` points at the
// deprecated path. Existing connections continue to work during the
// sunset window, but new code should not be added against that
// surface — once `wb-q6rb` Phase 4 is fully complete (the legacy
// surface is removed), these slugs resolve to nothing.

const RULE_ID = "workbook/correctness/no-composio-slug";

// Match string literals like:
//   "composio:gmail"        — most common (in tools: [...] arrays)
//   'composio:google_drive' — same, single-quoted
//   `composio:slack`        — backticked (template literal)
//
// Toolkit slugs are lowercase + underscore/dash. The pattern stays
// conservative to avoid matching prose mentions like "composio:" at
// the end of a sentence.
const SLUG_PATTERN = /(['"`])composio:([a-z][a-z0-9_-]*)\1/g;

export default {
  id: RULE_ID,
  severity: "warn",
  fixable: false,
  description: "Composio slug — toolkit is deprecated, migrate to custom OAuth or providerKeys",
  rationale: `
Composio is being phased out (wb-q6rb). Existing connections still
work during the sunset window, but new bindings against
\`composio:<toolkit>\` will stop resolving once Phase 4 cleanup lands.

Two replacement paths, picked per provider:

  1. **Custom OAuth (Lane A)** — broker handles the dance, tokens
     are KEK-wrapped in D1. Wire it via Studio → Integrations →
     Add Connection. Current Lane A targets: Google (Workspace +
     Ads + YouTube), Microsoft (Graph), Slack, Meta (Facebook +
     IG + WhatsApp), TikTok for Business.

  2. **Env-var API keys (Lane B)** — for providers that issue
     long-lived API keys (OpenAI, Anthropic, Stripe, Resend,
     Twilio, Supabase, Cloudflare). Set the key in your group's
     env via \`workbook env set\`, then reference it from the
     agent the same way you would any other env var.

If you have a working Composio connection and explicitly want to
keep it through the sunset window, suppress the warning per
call-site:

    // workbook-disable-next-line workbook/correctness/no-composio-slug
    tools: ["composio:gmail"]

See docs/RESEARCH-composio-removal.md for the full migration plan.
`.trim(),
  exampleBefore: `// workbook.config.mjs
export default {
  agent: {
    tools: ["composio:gmail", "composio:slack"],
  },
};`,
  exampleAfter: `// workbook.config.mjs — after migrating to custom OAuth + env-var keys
export default {
  agent: {
    // Lane A: custom OAuth (provisioned via Studio → Integrations)
    tools: ["oauth:gmail.send", "oauth:slack.post_message"],
    // Lane B: env-var API keys for providers that issue long-lived keys
    env: { OPENAI_API_KEY: "$OPENAI_API_KEY" },
  },
};`,
  extensions: ["js", "mjs", "ts", "mts", "svelte", "json"],

  check({ filePath, content }) {
    const diagnostics = [];
    const lineStarts = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") lineStarts.push(i + 1);
    }
    const lines = content.split("\n");
    const indexToLineCol = (idx) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= idx) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, col: idx - lineStarts[lo] + 1 };
    };

    SLUG_PATTERN.lastIndex = 0;
    let m;
    while ((m = SLUG_PATTERN.exec(content)) !== null) {
      const slug = m[2];
      // Position of the opening quote — matches what users will
      // see in their editor.
      const literalStart = m.index;
      const { line, col } = indexToLineCol(literalStart);

      const suppressed =
        (lines[line - 1] && lines[line - 1].includes(`workbook-disable ${RULE_ID}`)) ||
        (lines[line - 1] && lines[line - 1].includes(`workbook-disable-line ${RULE_ID}`)) ||
        (lines[line - 2] && lines[line - 2].includes(`workbook-disable-next-line ${RULE_ID}`));
      if (suppressed) continue;

      diagnostics.push({
        ruleId: RULE_ID,
        severity: "warn",
        filePath,
        line,
        col,
        endLine: line,
        endCol: col + m[0].length,
        message:
          `'composio:${slug}' — Composio is deprecated (wb-q6rb). ` +
          `Migrate to custom OAuth (Lane A) or env-var keys (Lane B).`,
        advice:
          "see docs/RESEARCH-composio-removal.md for the per-provider migration target",
      });
    }
    return diagnostics;
  },
};
