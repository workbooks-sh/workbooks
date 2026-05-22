-- Initial population of the question tracker.
--
-- Pure SQL so the seed is diff-friendly. Each question is registered
-- once; an initial assessment row captures the status as of 2026-05-20.
-- Subsequent reassessments INSERT new rows into `assessments` rather
-- than UPDATE — history is queryable.
--
-- Conventions:
--   id            kebab-case, prefixed by domain (q-authoring-cli-build)
--   evidence      naming convention: "<spec-path> @ <pass-k>=<result>"
--                 OR "no spec yet" for untouched / partial gaps
--   bears_on      directly | partially | tangentially
--                 (a tangential mapping is a spec that exercises the
--                  surface but doesn't isolate the question)

BEGIN TRANSACTION;

-- ─────────────────────────────────────────────────────────────────────
-- AUTHORING — the CLI surface that authors use directly
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-authoring-cli-init', 'authoring',
    'Does `workbook init` scaffold a working workbook from a blank directory?',
    'init is the entry point; if it produces a broken scaffold no downstream step works.'),
  ('q-authoring-cli-build', 'authoring',
    'Does `workbook build` emit a self-contained single-file .html artifact?',
    'The .html artifact is the unit of distribution. If build is unreliable nothing ships.'),
  ('q-authoring-cli-unbundle', 'authoring',
    'Does `workbook unbundle` recover the source tree byte-for-byte from a built .html?',
    'Source bundling is what makes workbooks portable + auditable. A lossy unbundle breaks the trust model.'),
  ('q-authoring-cli-dev', 'authoring',
    'Does `workbook dev` serve and hot-reload on source edits?',
    'Dev loop quality determines authoring throughput. Untested means we do not know if local-dev is regression-free.'),
  ('q-authoring-cli-check', 'authoring',
    'Does `workbook check` catch known-broken workbook configs before build?',
    'Validation pre-flight saves real build failures from reaching CI. Untested = no signal.');

-- ─────────────────────────────────────────────────────────────────────
-- SUBSTRATE — the broker + git-worker + R2 storage path
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-substrate-write-visibility', 'substrate',
    'When an agent push exits 0, is the new ref visible to a fresh fetch from an independent clone?',
    'This is the substrate''s core durability promise. wb-n9zq showed the v2 fetch handler had a silent failure mode that violated it.'),
  ('q-substrate-bytes-preserved', 'substrate',
    'Does the substrate preserve arbitrary binary payloads without munging?',
    'Workbooks bundle binary assets (images, wasm, etc.). Any byte-level corruption silently breaks artifacts.'),
  ('q-substrate-gitignore', 'substrate',
    'Does the substrate honor .gitignore so secrets (.env etc.) never leak?',
    'Substrate is multi-tenant. A leaked .env is a tier-1 incident.'),
  ('q-substrate-tree-lands-atomically', 'substrate',
    'Does a full workbook tree land in the substrate in one push, with no missing files?',
    'Half-pushed workbooks would be diagnostically confusing and break recipients silently.'),
  ('q-substrate-context-files-visible', 'substrate',
    'Are agent-context files (AGENTS.md, .pi/SYSTEM.md, .gitignore) visible to the agent at session boot?',
    'These files are how authors steer agent behavior. If they are not visible the agent behaves as if uninstructed.');

-- ─────────────────────────────────────────────────────────────────────
-- SESSION — agent session machinery
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-session-multi-turn-memory', 'session',
    'Does the agent recall context from earlier turns when distractors are interleaved?',
    'Multi-turn collaboration is the headline UX. Memory loss breaks the contract.'),
  ('q-session-idle-resume', 'session',
    'Does a session resume correctly after a short idle (~30s)?',
    'Cancelled-then-resumed is a real pattern. Idle resume failure surfaces as "the agent forgot what we just did."'),
  ('q-session-long-idle-resume', 'session',
    'Does a session resume correctly past a >5 min idle (compaction window)?',
    'Compaction is when many state-handoff bugs surface. Short-idle passing does not imply long-idle passing.'),
  ('q-session-persisted-to-db', 'session',
    'After a turn completes, is the full session state durably persisted (recoverable from DB alone)?',
    'In-memory-only state is invisible to other surfaces (Studio, analytics, audit).');

-- ─────────────────────────────────────────────────────────────────────
-- SHAPES — workbook templates (8 total)
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-shape-spa', 'shapes',
    'When the user asks for an interactive web app, does the agent pick type:"spa" and build it?',
    'SPA is the default shape and the most common ask. Shape misfit means wrong scaffold.'),
  ('q-shape-agent', 'shapes',
    'When the user asks for an AI helper, does the agent pick type:"agent" with systemPrompt+tools?',
    'Agent-shape is Studio''s differentiator. Choosing SPA instead silently loses the agent surface.'),
  ('q-shape-document', 'shapes',
    'When the user asks for prose-shaped content, does the agent pick type:"document"?',
    'Document shape changes the render container materially. Misfit looks ugly + non-functional.'),
  ('q-shape-notebook', 'shapes',
    'When the user asks for runnable analysis cells, does the agent pick type:"notebook"?',
    'Notebook shape ships a different runtime (cells); SPA cannot substitute.'),
  ('q-shape-presentation', 'shapes',
    'When the user asks for slides, does the agent pick type:"presentation" with substantive content?',
    'Slide shape implies slide navigation; SPA falsework would not advance properly.'),
  ('q-shape-playground', 'shapes',
    'When the user asks for an interactive sandbox, does the agent pick the SPA + stage playground idiom?',
    'Playground is SPA-with-stage; agent has to recognize "playground" semantics, not just "SPA".'),
  ('q-shape-video', 'shapes',
    'Does type:"video" build + render a HyperFrames composition?',
    'Video shape ships a different runtime (HyperFrames). Untested means we cannot trust author handoff.'),
  ('q-shape-playground-wrapped', 'shapes',
    'Does type:"playground-wrapped" build and present its wrapped UI correctly?',
    'Less-used shape but still part of the contract; untested = silent breakage on use.');

-- ─────────────────────────────────────────────────────────────────────
-- LIFECYCLE — init → build → publish → pull → MCP
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-lifecycle-publish-pull-roundtrip', 'lifecycle',
    'Does publish + pull round-trip source files byte-for-byte through workbooks.sh?',
    'Round-trip integrity is what makes workbooks auditable post-distribution.'),
  ('q-lifecycle-mcp-call', 'lifecycle',
    'Do published workbook tools register with the broker and remain callable via `workbook call`?',
    'MCP exposure is how workbooks compose with other agents. Silently-broken MCP breaks the network effect.'),
  ('q-lifecycle-agent-publish-roundtrip', 'lifecycle',
    'Can an agent author + publish an agent-shape workbook that the broker then recognizes?',
    'Self-replication loop: agent makes an agent. If this breaks, the platform stops compounding.');

-- ─────────────────────────────────────────────────────────────────────
-- SECURITY — sandbox isolation, signed provenance, secrets
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-security-baked-creds-refusal', 'security',
    'Does `workbook build --bake-public-db` refuse service-role keys while accepting anon keys?',
    'Misuse here would bake a god-key into every recipient''s .html. Critical guardrail.'),
  ('q-security-csp-iframe', 'security',
    'Do workbooks load inside the viewer in a cross-origin sandboxed iframe with strict CSP?',
    'This is the SECURITY.md non-negotiable. If CSP is missing, agent-authored workbooks become an attack surface.'),
  ('q-security-signed-provenance', 'security',
    'Are workbooks shipped with verifiable signed provenance the viewer enforces?',
    'Provenance prevents impostor workbooks from claiming a trusted author.'),
  ('q-security-agent-output-validation', 'security',
    'Do agent-emitted artifacts pass through the documented 3-layer validation before rendering?',
    'A bypass would mean an agent can ship arbitrary HTML to a recipient; loss-of-control.'),
  ('q-security-share-link-cross-org', 'security',
    'Do share links never expose data from orgs other than the publishing org?',
    'Cross-org leakage via share is a privacy incident; untested = unknown.');

-- ─────────────────────────────────────────────────────────────────────
-- AUTH — broker token / RBAC enforcement
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-auth-boundary-token', 'auth',
    'Does the broker reject missing/expired/cross-org tokens at every endpoint?',
    'Token boundary is the perimeter. Holes here propagate to every downstream surface.'),
  ('q-auth-rate-limit', 'auth',
    'Does the broker rate-limit failed auth attempts?',
    'Brute-force resistance. wb-gp8g open.'),
  ('q-auth-token-refresh', 'auth',
    'Does long-running session token refresh work without dropping context?',
    'Multi-hour authoring sessions need refresh; failure here looks like spontaneous logout.'),
  ('q-auth-rbac-member-admin', 'auth',
    'Are member vs admin scopes enforced consistently across CLI + Studio + broker?',
    'RBAC drift across surfaces creates "this works in CLI but not in Studio" support tickets.');

-- ─────────────────────────────────────────────────────────────────────
-- SKILLS — resolution, composition, overrides
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  -- Quality of skill USE
  ('q-skills-resolution', 'skills',
    'Does the agent reliably resolve the right skill for a request?',
    'Wrong skill = wrong tools = wrong work. R3.'),
  ('q-skills-composition', 'skills',
    'When a request spans two skills, does the agent compose them?',
    'Realistic asks are multi-skill. Failing here means narrow-task success only.'),
  ('q-skills-precedence-order', 'skills',
    'When the same skill key appears in multiple sources (agent-authored, bundled, model-bundled, core, installed), does the documented precedence hold?',
    'agents.ts::runSession merges 5 sources with deterministic precedence. Drift breaks per-agent customization. (Renamed from override-priority — system uses explicit precedence, not free-form overrides.)'),
  ('q-skills-decline-when-none', 'skills',
    'When no skill matches, does the agent decline explicitly rather than hallucinate tools?',
    'Hallucinated tools are silent failures the user only catches downstream.'),
  ('q-skills-cache-consistency', 'skills',
    'Do parallel sessions on the same org resolve to the same skill set?',
    'Torn caches mean two sessions disagree on what tools exist; reproducibility breaks.'),

  -- Extensibility — adding skills
  ('q-skills-install-via-ui', 'skills',
    'Can a user install a skill via the Studio /integrations Skills tab (paste / URL / GitHub / file upload)?',
    'Primary extensibility path today. AddSkillDialog is the surface; if it does not work, no one extends.'),
  ('q-skills-cli-add', 'skills',
    'Can a user install a skill via `workbook skill` CLI verbs (add / list / remove)?',
    'CLI is the canonical authoring surface per CLAUDE.md. Currently NO `workbook skill` verbs exist — gap to close.'),
  ('q-skills-uninstall-via-ui', 'skills',
    'Does uninstalling a skill via Studio remove it from subsequent session loads?',
    'Lifecycle correctness: revoked skills must actually disappear, not linger via cache.'),

  -- Scope + sharing
  ('q-skills-org-scope-visibility', 'skills',
    'Are ownerScope="org" skills visible to all members of the installing org?',
    'Org-scope is the team-sharing story. If it does not propagate, teams cannot standardize.'),
  ('q-skills-user-scope-isolation', 'skills',
    'Are ownerScope="user" skills NOT visible to other members of the same org?',
    'User-scope is the privacy boundary. Leakage = "my teammate sees my custom skill" surprise.'),
  ('q-skills-group-share', 'skills',
    'Do group-shared skills (sharedGroupIds set) appear only to members of the named groups?',
    'Fine-grained sharing between team-wide and personal. Group leakage = broken access model.'),

  -- Runtime gates
  ('q-skills-audit-status-filter', 'skills',
    'Does auditStatus="rejected" prevent a skill from loading at session boot?',
    'wb-9et closed this at runtime. Audit gate must hold under regression.'),
  ('q-skills-core-disable-effect', 'skills',
    'When an org sets disabledSkillIds, are those core skills omitted from every session in that org?',
    'Per-org core toggling is the de-noising control. If it does not propagate, agents drag in unwanted bundled context.'),
  ('q-skills-mounted-at-runner-path', 'skills',
    'Are resolved skills mounted at /home/user/work/<sessionId>/skills/<key>.md in the runner sandbox?',
    'The runner expects this layout. Path drift = skills exist in metadata but agent cannot read them.'),
  ('q-skills-content-hash-integrity', 'skills',
    'Does a skill''s stored contentHash match the content the runner actually mounts?',
    'Integrity check — a hash mismatch means a tampered or corrupted skill is being served.'),

  -- Agent-authored skills
  ('q-skills-agent-published', 'skills',
    'Can an agent author a new skill in a workbook and register it for future sessions to use?',
    'Self-replication loop for skills. Bits exist (manifest.skills, broker endpoint) but no documented end-to-end workflow.'),

  -- Integrations
  ('q-skills-integration-cred-binding', 'skills',
    'When a skill references a Composio toolkit, do the toolkit''s credentials reach the runner sandbox correctly?',
    'Integration-bound skills are the high-value use case. If creds do not arrive, skill is dead code.'),
  ('q-skills-overlap-detection', 'skills',
    'When an installed skill mentions a connected toolkit slug, does the UI surface the overlap?',
    'Overlap UX prevents users from installing redundant skills. Detection must be reliable.'),
  ('q-skills-cred-no-leak', 'skills',
    'Can a hostile skill body (or a skill''s prompt-injected output) exfiltrate the credentials of toolkits it has access to?',
    'Adversarial probe — credential containment is core to integration trust. Bridges to R8.');

-- ─────────────────────────────────────────────────────────────────────
-- AGENTS — agent-spawning-agent, custom agents
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-agent-author-agent', 'agents',
    'Can the agent scaffold a workbook that defines another agent (systemPrompt + tools)?',
    'Foundation of agent-spawning-agent. Scaffold-correct is necessary but not sufficient.'),
  ('q-agent-spawned-runtime', 'agents',
    'Does an agent-shape workbook authored by one agent actually run when invoked by another?',
    'Without this, agent-authoring-agent is just a paperwork exercise. R4.'),
  ('q-agent-delegate-to-agent', 'agents',
    'Does `delegate_to_agent` route a subtask to the named agent and surface the result?',
    'Delegation is the orchestration primitive. R4.'),
  ('q-agent-parent-child-linkage', 'agents',
    'Are parent/child sessions observably linked (auditable from a single trace)?',
    'Without linkage, multi-agent runs are unobservable. R4.');

-- ─────────────────────────────────────────────────────────────────────
-- CONCURRENCY — races, failure injection
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-concurrent-two-session-race', 'concurrency',
    'Do two sessions writing the same substrate path resolve cleanly (one wins, no silent merge)?',
    'Concurrent agent use is the multi-team future. Silent merges = data corruption.'),
  ('q-concurrent-upstream-errors', 'concurrency',
    'Does the agent surface 402/429/5xx upstream errors cleanly (not silent-retry-forever)?',
    'Provider outages are reality. Bad handling looks like "the agent is broken" to users.'),
  ('q-concurrent-sandbox-death-midturn', 'concurrency',
    'When the sandbox dies mid-tool-call, does the next turn recover with substrate intact?',
    'Sandbox crashes happen. Hard-fail on crash kills the session UX.'),
  ('q-concurrent-cancelled-session-cleanup', 'concurrency',
    'When a session is cancelled mid-turn, are orchestrator + sandbox + locks all torn down?',
    'Orphaned cancelled sessions burn quota and pollute traces.'),
  ('q-concurrent-push-event-fanout', 'concurrency',
    'Do Convex subscribers see new substrate pushes within N seconds (broker push fan-out)?',
    'Studio''s reactive views depend on this. Delayed fan-out breaks "live" feel.');

-- ─────────────────────────────────────────────────────────────────────
-- REALISTIC — minimal-prompt scenarios that ship to users daily
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-realistic-scratch-spa', 'realistic',
    'Given a one-sentence request, can the agent scaffold + build a SPA workbook?',
    'Shortest possible UX. If this is flaky, the marketing demo is flaky.'),
  ('q-realistic-conversational-additions', 'realistic',
    'Across multiple casual turns, does the agent add features to the same workbook coherently?',
    'Authoring is iterative. Coherent-additions failure = author leaves.'),
  ('q-realistic-terse-fix', 'realistic',
    'When given only a directory and "fix this", can the agent diagnose + fix a bug?',
    'Bug-fix loop is the most common return visit. Failing here = users do not come back.');

-- ─────────────────────────────────────────────────────────────────────
-- BROKER — independent broker behaviors
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-broker-kek-unwrap', 'broker',
    'Does the broker correctly unwrap KEK-wrapped secrets for authorized requests only?',
    'Secret routing is core to baked-creds and skill-credential workflows.'),
  ('q-broker-org-pin', 'broker',
    'Does the broker reject requests whose token org does not match the URL org?',
    'Cross-org via path forgery is a primary attack vector.');

-- ─────────────────────────────────────────────────────────────────────
-- STUDIO UI — admin / viewer / lander surfaces
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-studio-orchestrator-kanban', 'studio-ui',
    'Does the Studio /orchestrator Kanban reflect filesystem .wb-orch/ state reactively?',
    'Orchestrator is Studio''s headline view. Stale data here = visible bug.'),
  ('q-studio-viewer-decrypts', 'studio-ui',
    'Does the viewer correctly decrypt + render sealed workbooks for authorized recipients?',
    'Viewer is the recipient experience. Broken decrypt = unusable artifact.'),
  ('q-studio-admin-integrations-tabs', 'studio-ui',
    'Does the admin Integrations area show only Connections + Skills (no Capabilities bento)?',
    'Visual contract; tab regressions are user-noticed.');

-- ─────────────────────────────────────────────────────────────────────
-- WORKBENCH — meta-eval: do our evals actually catch real bugs?
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-workbench-catches-real-bugs', 'workbench',
    'When a known real bug is reintroduced, does the eval suite catch it before merge?',
    'Meta-eval: prove the suite has signal. Without this we may be running theater.'),
  ('q-workbench-otel-trace', 'workbench',
    'Do `workbench observe --format=otel` traces export cleanly to any OTel backend?',
    'Trace portability is the integration story. Untested = vendor lock-in by accident.'),
  ('q-workbench-improver-converges', 'workbench',
    'Does `workbench eval --improve` converge on a passing agent without harming other specs?',
    'End-state of the loop. Until this is measured we cannot claim the loop works.');

-- ─────────────────────────────────────────────────────────────────────
-- ADVERSARIAL — security under hostile inputs
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-adversarial-prompt-injection-user', 'adversarial',
    'When user-supplied content contains injection text, does the agent refuse to follow it?',
    'Prompt injection is the most common attack. Failing this means user-data IS code.'),
  ('q-adversarial-prompt-injection-skill', 'adversarial',
    'When a skill manifest contains injection text, does it not escalate the agent''s permissions?',
    'Skill supply chain is a real attack surface as more skills are installed.'),
  ('q-adversarial-jwt-replay', 'adversarial',
    'Can a revoked JWT be replayed against the broker?',
    'Revocation is meaningless if replay works. Critical.'),
  ('q-adversarial-baked-creds-via-share', 'adversarial',
    'When a workbook with baked creds is shared, can a recipient extract those creds?',
    'Baked-creds is opt-in trust. Extraction would silently break the trust model.');

-- ─────────────────────────────────────────────────────────────────────
-- GROUPS / TIERS — multi-user / multi-org
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO questions (id, domain, question, why) VALUES
  ('q-groups-member-vs-admin-scope', 'groups',
    'Do member and admin roles see correctly-scoped data in Studio + broker?',
    'RBAC test in practice. Surfaces drift = "I see X but my teammate does not" bugs.'),
  ('q-groups-archive-restore', 'groups',
    'Does the group archive flow followed by restore preserve state intact?',
    'Reversible operations are a big retention surface.'),
  ('q-groups-tier-gating', 'groups',
    'Do tier-gated features surface upsell paths instead of breaking?',
    'Tier hits are user-facing; broken gates = "why doesn''t this work" tickets.');

-- ─────────────────────────────────────────────────────────────────────
-- INITIAL ASSESSMENTS (2026-05-20)
-- ─────────────────────────────────────────────────────────────────────

-- ANSWERED with medium-high confidence (covered by ≥1 spec, pass-k ≥ 3)
INSERT INTO assessments (question_id, status, confidence, evidence, gaps, notes) VALUES
  ('q-authoring-cli-init', 'answered', 'medium',
    'evals/lifecycle/init_build_publish.eval.md + evals/realistic/scratch_spa.eval.md exercise init via the agent path',
    'No direct unit-test-style probe of `workbook init` itself outside of agent invocation.',
    NULL),
  ('q-authoring-cli-build', 'answered', 'high',
    'evals/lifecycle/init_build_publish.eval.md, evals/shapes/*, evals/realistic/scratch_spa.eval.md all gate on workbook.build success',
    NULL,
    NULL),
  ('q-authoring-cli-unbundle', 'partial', 'medium',
    'evals/lifecycle/published_roundtrip.eval.md verifies bytes round-trip via publish→pull',
    'No spec directly exercises `workbook unbundle <file.html> <dir>` from disk to disk.',
    NULL),

  ('q-substrate-write-visibility', 'answered', 'high',
    'evals/xsurface/orchestrator_task_propagates.eval.md GREEN at pass-k=5 (post wb-n9zq); evals/xsurface/agent_write_then_cli_clone.eval.md + cli_push_then_agent_sees.eval.md',
    NULL,
    'wb-n9zq fixed 2026-05-20: v2 fetch was silently no-op''ing when client sent have lines'),
  ('q-substrate-bytes-preserved', 'answered', 'high',
    'evals/substrate/binary_roundtrip.eval.md verifies 256-byte 0x00-0xFF payload',
    NULL,
    NULL),
  ('q-substrate-gitignore', 'answered', 'high',
    'evals/substrate/gitignored_does_not_leak.eval.md',
    NULL,
    NULL),
  ('q-substrate-tree-lands-atomically', 'answered', 'high',
    'evals/substrate/workbook_tree_lands.eval.md verifies tree + build',
    NULL,
    NULL),
  ('q-substrate-context-files-visible', 'answered', 'medium',
    'evals/substrate/contextually_added_files.eval.md',
    'Not yet stress-tested under concurrent writes',
    NULL),

  ('q-session-multi-turn-memory', 'answered', 'medium',
    'evals/session/multi_turn_memory.eval.md with distractor',
    'Single spec; no pass-k 5 yet',
    NULL),
  ('q-session-idle-resume', 'answered', 'medium',
    'evals/session/resume_after_idle.eval.md uses 30s idle',
    'Long-idle (compaction window) not covered — see q-session-long-idle-resume',
    NULL),
  ('q-session-persisted-to-db', 'partial', 'low',
    'evals/session/multi_turn_memory.eval.md uses session.persisted_to_db as a probe',
    'Not validated by a fresh-process readback; persistence may be process-local cache hit',
    NULL),

  ('q-shape-spa', 'answered', 'high',
    'evals/lifecycle/init_build_publish.eval.md + evals/realistic/scratch_spa.eval.md',
    NULL,
    NULL),
  ('q-shape-agent', 'answered', 'medium',
    'evals/shapes/agent_recursive.eval.md verifies scaffold',
    'Runtime behavior of the spawned agent is q-agent-spawned-runtime',
    NULL),
  ('q-shape-document', 'answered', 'medium',
    'evals/shapes/document_stub.eval.md',
    NULL,
    NULL),
  ('q-shape-notebook', 'answered', 'medium',
    'evals/shapes/notebook_stub.eval.md',
    NULL,
    NULL),
  ('q-shape-presentation', 'answered', 'medium',
    'evals/shapes/presentation_stub.eval.md',
    NULL,
    NULL),
  ('q-shape-playground', 'answered', 'medium',
    'evals/shapes/playground_stub.eval.md',
    NULL,
    NULL),

  ('q-lifecycle-publish-pull-roundtrip', 'answered', 'high',
    'evals/lifecycle/published_roundtrip.eval.md with substrate.bytes_equal',
    NULL,
    NULL),
  ('q-lifecycle-mcp-call', 'answered', 'medium',
    'evals/lifecycle/mcp_serve_and_call.eval.md',
    NULL,
    NULL),
  ('q-lifecycle-agent-publish-roundtrip', 'answered', 'medium',
    'evals/lifecycle/agent_published_then_pulled.eval.md',
    NULL,
    NULL),

  ('q-security-baked-creds-refusal', 'answered', 'medium',
    'evals/lifecycle/baked_public_db_refusal.eval.md',
    'Only tests CLI refusal path; broker-side refusal not separately verified',
    NULL),

  ('q-auth-boundary-token', 'answered', 'low',
    'evals/auth/boundaries.eval.md',
    'Single spec; needs expanded probes per scope + per endpoint',
    NULL),

  ('q-agent-author-agent', 'answered', 'medium',
    'evals/shapes/agent_recursive.eval.md',
    'Scaffold-correct only; runtime not validated',
    NULL),

  ('q-realistic-scratch-spa', 'answered', 'medium',
    'evals/realistic/scratch_spa.eval.md',
    NULL,
    NULL),
  ('q-realistic-conversational-additions', 'answered', 'medium',
    'evals/realistic/conversational.eval.md (3-turn)',
    NULL,
    NULL),
  ('q-realistic-terse-fix', 'answered', 'medium',
    'evals/realistic/terse_fix.eval.md',
    NULL,
    NULL);

-- PARTIAL (some coverage, known gaps OR low confidence)
INSERT INTO assessments (question_id, status, confidence, evidence, gaps, notes) VALUES
  ('q-authoring-cli-dev', 'untouched', 'low', 'no spec yet',
    'workbook dev (file watcher + reload) has no eval coverage',
    NULL),
  ('q-authoring-cli-check', 'untouched', 'low', 'no spec yet',
    'workbook check has no eval coverage',
    NULL);

-- UNTOUCHED — explicitly tracked so we do not forget
INSERT INTO assessments (question_id, status, confidence, evidence, gaps, notes) VALUES
  ('q-session-long-idle-resume', 'untouched', 'low', 'no spec yet',
    'Planned in R6 (wb-ojss.4)',
    NULL),
  ('q-shape-video', 'untouched', 'low', 'no spec yet',
    'video shape not in R2 — should be filed',
    NULL),
  ('q-shape-playground-wrapped', 'untouched', 'low', 'no spec yet',
    'playground-wrapped not in R2 — should be filed',
    NULL),

  ('q-security-csp-iframe', 'untouched', 'low', 'no spec yet',
    'Critical security probe; needs viewer-side integration test',
    'SECURITY.md asserts this is non-negotiable'),
  ('q-security-signed-provenance', 'untouched', 'low', 'no spec yet',
    'Provenance verification not probed',
    NULL),
  ('q-security-agent-output-validation', 'untouched', 'low', 'no spec yet',
    'Three-layer validation not probed',
    NULL),
  ('q-security-share-link-cross-org', 'untouched', 'low', 'no spec yet',
    'Cross-org leak via share link not tested',
    NULL),

  ('q-auth-rate-limit', 'untouched', 'low', 'no spec yet',
    'wb-gp8g open',
    NULL),
  ('q-auth-token-refresh', 'untouched', 'low', 'no spec yet', NULL, NULL),
  ('q-auth-rbac-member-admin', 'untouched', 'low', 'no spec yet',
    'Planned in R7',
    NULL),

  ('q-skills-resolution', 'untouched', 'low', 'no spec yet', 'R3 — first batch (no new primitives needed)', NULL),
  ('q-skills-composition', 'untouched', 'low', 'no spec yet', 'R3 — first batch', NULL),
  ('q-skills-precedence-order', 'untouched', 'low', 'no spec yet', 'R3 — needs session.skill_resolved primitive', NULL),
  ('q-skills-decline-when-none', 'untouched', 'low', 'no spec yet', 'R3 — first batch', NULL),
  ('q-skills-cache-consistency', 'untouched', 'low', 'no spec yet', 'R3 — needs dual-session runner (R6 primitive); may defer', NULL),
  ('q-skills-install-via-ui', 'untouched', 'low', 'no spec yet', 'R3 — needs convex.mutation primitive', NULL),
  ('q-skills-cli-add', 'untouched', 'low', 'no spec yet', 'R3 — BLOCKED: no `workbook skill` CLI verbs exist (filed wb-ojss.3.cli)', NULL),
  ('q-skills-uninstall-via-ui', 'untouched', 'low', 'no spec yet', 'R3 — depends on install spec', NULL),
  ('q-skills-org-scope-visibility', 'untouched', 'low', 'no spec yet', 'R3 — needs multi-user session probe', NULL),
  ('q-skills-user-scope-isolation', 'untouched', 'low', 'no spec yet', 'R3 — needs multi-user session probe', NULL),
  ('q-skills-group-share', 'untouched', 'low', 'no spec yet', 'R3 — needs group setup primitive', NULL),
  ('q-skills-audit-status-filter', 'untouched', 'low', 'no spec yet', 'R3 — needs convex.mutation primitive', NULL),
  ('q-skills-core-disable-effect', 'untouched', 'low', 'no spec yet', 'R3 — needs convex.mutation primitive', NULL),
  ('q-skills-mounted-at-runner-path', 'untouched', 'low', 'no spec yet', 'R3 — needs session.skill_resolved primitive', NULL),
  ('q-skills-content-hash-integrity', 'untouched', 'low', 'no spec yet', 'R3 — needs convex.query primitive', NULL),
  ('q-skills-agent-published', 'untouched', 'low', 'no spec yet', 'R3 — BLOCKED: no documented agent-publish-skill workflow (filed wb-ojss.3.agent-publish)', NULL),
  ('q-skills-integration-cred-binding', 'untouched', 'low', 'no spec yet', 'R3 — needs Composio test toolkit', NULL),
  ('q-skills-overlap-detection', 'untouched', 'low', 'no spec yet', 'R3 — Studio UI probe', NULL),
  ('q-skills-cred-no-leak', 'untouched', 'low', 'no spec yet', 'R3/R8 bridge — adversarial probe', NULL),

  ('q-agent-spawned-runtime', 'untouched', 'low', 'no spec yet', 'Planned R4', NULL),
  ('q-agent-delegate-to-agent', 'untouched', 'low', 'no spec yet', 'Planned R4', NULL),
  ('q-agent-parent-child-linkage', 'untouched', 'low', 'no spec yet', 'Planned R4', NULL),

  ('q-concurrent-two-session-race', 'untouched', 'low', 'no spec yet', 'Planned R6 (wb-ojss.4)', NULL),
  ('q-concurrent-upstream-errors', 'untouched', 'low', 'no spec yet', 'Planned R6', NULL),
  ('q-concurrent-sandbox-death-midturn', 'untouched', 'low', 'no spec yet', 'Planned R6', NULL),
  ('q-concurrent-cancelled-session-cleanup', 'untouched', 'low', 'no spec yet', 'Planned R6', NULL),
  ('q-concurrent-push-event-fanout', 'untouched', 'low', 'no spec yet', 'Planned R6', NULL),

  ('q-broker-kek-unwrap', 'untouched', 'low', 'no spec yet', NULL, NULL),
  ('q-broker-org-pin', 'untouched', 'low', 'no spec yet',
    'Overlaps q-auth-boundary-token; needs separate probe via crafted URL',
    NULL),

  ('q-studio-orchestrator-kanban', 'untouched', 'low', 'no spec yet',
    'Studio UI surfaces not yet covered by Workbench evals',
    NULL),
  ('q-studio-viewer-decrypts', 'untouched', 'low', 'no spec yet', NULL, NULL),
  ('q-studio-admin-integrations-tabs', 'untouched', 'low', 'no spec yet', NULL, NULL),

  ('q-workbench-catches-real-bugs', 'untouched', 'low', 'no spec yet',
    'Meta-eval gap. Could be probed via mutation testing: reintroduce a closed bug, expect failure',
    NULL),
  ('q-workbench-otel-trace', 'untouched', 'low', 'no spec yet',
    'observe --format=otel exists but its output is not validated against a real OTel backend',
    NULL),
  ('q-workbench-improver-converges', 'untouched', 'low', 'no spec yet',
    'eval --improve loop not yet exercised end-to-end',
    NULL),

  ('q-adversarial-prompt-injection-user', 'untouched', 'low', 'no spec yet', 'Planned R8', NULL),
  ('q-adversarial-prompt-injection-skill', 'untouched', 'low', 'no spec yet', 'Planned R8', NULL),
  ('q-adversarial-jwt-replay', 'untouched', 'low', 'no spec yet', 'Planned R8', NULL),
  ('q-adversarial-baked-creds-via-share', 'untouched', 'low', 'no spec yet', 'Planned R8', NULL),

  ('q-groups-member-vs-admin-scope', 'untouched', 'low', 'no spec yet', 'Planned R7', NULL),
  ('q-groups-archive-restore', 'untouched', 'low', 'no spec yet', 'Planned R7', NULL),
  ('q-groups-tier-gating', 'untouched', 'low', 'no spec yet', 'Planned R7', NULL);

-- ─────────────────────────────────────────────────────────────────────
-- SPEC ↔ QUESTION MAP
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO spec_questions (spec_path, question_id, bears_on) VALUES
  -- auth
  ('evals/auth/boundaries.eval.md', 'q-auth-boundary-token', 'directly'),

  -- boundary
  ('evals/boundary/wrong_runtime.eval.md', 'q-agent-author-agent', 'tangentially'),

  -- lifecycle
  ('evals/lifecycle/init_build_publish.eval.md', 'q-authoring-cli-init', 'partially'),
  ('evals/lifecycle/init_build_publish.eval.md', 'q-authoring-cli-build', 'directly'),
  ('evals/lifecycle/init_build_publish.eval.md', 'q-shape-spa', 'directly'),
  ('evals/lifecycle/published_roundtrip.eval.md', 'q-lifecycle-publish-pull-roundtrip', 'directly'),
  ('evals/lifecycle/published_roundtrip.eval.md', 'q-authoring-cli-unbundle', 'partially'),
  ('evals/lifecycle/mcp_serve_and_call.eval.md', 'q-lifecycle-mcp-call', 'directly'),
  ('evals/lifecycle/agent_published_then_pulled.eval.md', 'q-lifecycle-agent-publish-roundtrip', 'directly'),
  ('evals/lifecycle/baked_public_db_refusal.eval.md', 'q-security-baked-creds-refusal', 'directly'),

  -- realistic
  ('evals/realistic/scratch_spa.eval.md', 'q-realistic-scratch-spa', 'directly'),
  ('evals/realistic/scratch_spa.eval.md', 'q-shape-spa', 'partially'),
  ('evals/realistic/conversational.eval.md', 'q-realistic-conversational-additions', 'directly'),
  ('evals/realistic/conversational.eval.md', 'q-session-multi-turn-memory', 'partially'),
  ('evals/realistic/terse_fix.eval.md', 'q-realistic-terse-fix', 'directly'),

  -- session
  ('evals/session/hello.eval.md', 'q-session-multi-turn-memory', 'tangentially'),
  ('evals/session/multi_turn_memory.eval.md', 'q-session-multi-turn-memory', 'directly'),
  ('evals/session/multi_turn_memory.eval.md', 'q-session-persisted-to-db', 'partially'),
  ('evals/session/resume_after_idle.eval.md', 'q-session-idle-resume', 'directly'),

  -- shapes
  ('evals/shapes/agent_recursive.eval.md', 'q-shape-agent', 'directly'),
  ('evals/shapes/agent_recursive.eval.md', 'q-agent-author-agent', 'directly'),
  ('evals/shapes/document_stub.eval.md', 'q-shape-document', 'directly'),
  ('evals/shapes/notebook_stub.eval.md', 'q-shape-notebook', 'directly'),
  ('evals/shapes/playground_stub.eval.md', 'q-shape-playground', 'directly'),
  ('evals/shapes/presentation_stub.eval.md', 'q-shape-presentation', 'directly'),

  -- substrate
  ('evals/substrate/binary_roundtrip.eval.md', 'q-substrate-bytes-preserved', 'directly'),
  ('evals/substrate/contextually_added_files.eval.md', 'q-substrate-context-files-visible', 'directly'),
  ('evals/substrate/file_lands.eval.md', 'q-substrate-write-visibility', 'partially'),
  ('evals/substrate/gitignored_does_not_leak.eval.md', 'q-substrate-gitignore', 'directly'),
  ('evals/substrate/workbook_tree_lands.eval.md', 'q-substrate-tree-lands-atomically', 'directly'),

  -- xsurface
  ('evals/xsurface/agent_write_then_cli_clone.eval.md', 'q-substrate-write-visibility', 'directly'),
  ('evals/xsurface/cli_push_then_agent_sees.eval.md', 'q-substrate-write-visibility', 'directly'),
  ('evals/xsurface/orchestrator_task_propagates.eval.md', 'q-substrate-write-visibility', 'directly'),

  -- skills (R3 first batch, 2026-05-20)
  ('evals/skills/mount_at_path.eval.md', 'q-skills-mounted-at-runner-path', 'directly'),
  ('evals/skills/mount_at_path.eval.md', 'q-skills-resolution', 'partially'),
  ('evals/skills/decline_no_skill.eval.md', 'q-skills-decline-when-none', 'directly'),
  ('evals/skills/compose_authoring_design.eval.md', 'q-skills-composition', 'directly'),
  ('evals/skills/compose_authoring_design.eval.md', 'q-skills-resolution', 'partially'),
  ('evals/skills/agent_workbook_includes_skill.eval.md', 'q-skills-agent-published', 'partially'),

  -- concurrency + R3 leftover (R6 first batch, 2026-05-20, wb-ojss.4)
  ('evals/concurrency/two_session_race.eval.md', 'q-concurrent-two-session-race', 'directly'),
  ('evals/concurrency/long_idle_resume.eval.md', 'q-session-long-idle-resume', 'directly'),
  ('evals/concurrency/upstream_5xx.eval.md', 'q-concurrent-upstream-errors', 'directly'),
  ('evals/concurrency/push_event_fanout.eval.md', 'q-concurrent-push-event-fanout', 'partially'),
  ('evals/skills/cache_consistency.eval.md', 'q-skills-cache-consistency', 'directly');

-- ─────────────────────────────────────────────────────────────────────
-- OPEN HYPOTHESES — assumptions we still need to empirically test
-- ─────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────
-- 2026-05-20 — R6 first batch (wb-ojss.4): specs landed, awaiting live
-- pass-k 3 to elevate status from "partial / spec-landed" to "answered."
-- Authored under operator gate so confidence stays low until first
-- live run lands.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO assessments (question_id, status, confidence, evidence, gaps, notes) VALUES
  ('q-concurrent-two-session-race', 'partial', 'low',
    'evals/concurrency/two_session_race.eval.md authored (dry-parse green)',
    'Live pass-k 3 not yet run; runner P1 + substrate.file_bytes_any_of new',
    'wb-ojss.4 — needs operator-gated first live run'),
  ('q-session-long-idle-resume', 'partial', 'low',
    'evals/concurrency/long_idle_resume.eval.md authored (dry-parse green); 330s idle past compaction window',
    'Live pass-k 3 not yet run',
    'wb-ojss.4 — needs operator-gated first live run'),
  ('q-concurrent-upstream-errors', 'partial', 'low',
    'evals/concurrency/upstream_5xx.eval.md authored (dry-parse green); upstream shim primitive in place',
    'Live wiring of WORKBOOKS_UPSTREAM_PROXY through sandbox provisioning is operator setup; no live run yet',
    'wb-ojss.4 — proxy threading deferred; framework primitive ready'),
  ('q-concurrent-push-event-fanout', 'partial', 'low',
    'evals/concurrency/push_event_fanout.eval.md covers the substrate-side arc via session.poll_until',
    'Convex-reactive arc (the second half of fan-out) needs a convex.query primitive — filed wb-ojss.4.3',
    'wb-ojss.4 — substrate arc done; Convex arc deferred'),
  ('q-skills-cache-consistency', 'partial', 'low',
    'evals/skills/cache_consistency.eval.md uses dual-session runner (P1) for byte-equal cross-session snapshot',
    'Live pass-k 3 not yet run',
    'wb-ojss.4 — closes one R3 leftover');

INSERT INTO hypotheses (id, question_id, hypothesis, test_sketch, resolution) VALUES
  ('h-pass-k-correlates-with-prod-reliability',
    'q-workbench-catches-real-bugs',
    'A spec at pass-k=5 GREEN reliably stays passing in production over a 30-day window.',
    'Pick 5 GREEN specs, observe them across nightly runs for 30 days; flag any that drop below 80%.',
    'still-open'),
  ('h-rubric-judges-drift-positive',
    NULL,
    'Subjective rubric judges drift toward false-positive PASS under non-determinism even when Fail-if clauses are explicit.',
    'For 5 specs with rubrics, run pass-k=10 twice with judge temperature 0 vs 0.7; compare drift.',
    'still-open'),
  ('h-objective-thinking-improves-judge-fidelity',
    NULL,
    'Judges running on the objective-thinking skill detect more failures than direct text-in-text-out judges on identical traces.',
    'Replay 20 known-failing traces through both judge modes; compare detection rate.',
    'still-open'),
  ('h-improver-loop-does-not-overfit',
    'q-workbench-improver-converges',
    'eval --improve converges on a passing AGENT without degrading other specs (no overfit to the failing spec).',
    'Run --improve until target spec passes; re-run the full suite; compare deltas.',
    'still-open'),
  ('h-cross-family-judge-finds-more-bugs',
    NULL,
    'A judge in a different model family (e.g. GPT-5-series judging Opus output) finds more rubric failures than a same-family judge.',
    'Run the same 20 traces through Opus-judge and GPT-judge; compare detection.',
    'still-open');

COMMIT;
