<script>
  import { Presentation, Slide, getLogos } from "@work.books/runtime/presentation";

  // Auto-pick mode: just list ids in workbook.config.mjs, the CLI
  // figures out which source has each brand and inlines as base64.
  // See ../workbook-presentation/references/logos.md for sources +
  // the curated pack for regulators / multilaterals.
  const logos = getLogos();
</script>

<!--
  Design is the agent's. The runtime always loads structural
  archetype layout primitives (so <Slide kind="…"> means something
  visually). The palette, typography, voice, per-archetype flourishes
  are YOUR custom styles.css — see this project's styles.css for
  the minimal version, or the workbook-presentation skill's
  references/designing-the-look.md for the CSS variable surface +
  a worked custom theme.

  There is deliberately no `theme=` prop. Picking from a menu
  produces generic-looking decks for the wrong reason. Custom is
  the path.
-->
<Presentation title="Presentation basics" aspectRatio="16:9">
  <Slide kind="title">
    <h1>Presentation basics</h1>
    <p>The canonical <code>&lt;Slide kind=…&gt;</code> pattern</p>
  </Slide>

  <Slide kind="section">
    <h1>What the archetypes do</h1>
  </Slide>

  <Slide kind="content">
    <h2>One idea per slide.</h2>
    <p>The title is the idea. The body shows it.</p>
  </Slide>

  <Slide kind="stat">
    <p class="huge">14</p>
    <p>canonical archetypes shipped with the runtime</p>
  </Slide>

  <Slide kind="content">
    <h2>Logos come from 7 sources, fan-out automatic.</h2>
    <div class="logo-row">
      {#each Object.entries(logos) as [name, logo] (name)}
        <img src={logo.dataUrl} alt={name} title={name} />
      {/each}
    </div>
    <p><small>Declared as <code>logos: [{`{id:"openai"}, {id:"stripe"}, {id:"github"}, {id:"fda"}`}]</code> — sources resolved at build time.</small></p>
  </Slide>

  <Slide kind="quote">
    <blockquote>Make every slide pass the squint test.</blockquote>
    <cite>— anyone who has sat through a bad deck</cite>
  </Slide>

  <Slide kind="comparison">
    <h2>Two ways to use this runtime</h2>
    <div>
      <h3>kind=</h3>
      <p>Pick an archetype. The default theme styles it. You write content, not CSS.</p>
    </div>
    <div>
      <h3>class= (escape hatch)</h3>
      <p>Hand-craft every slide. See <code>presentation-svelte</code> for the pattern.</p>
    </div>
  </Slide>

  <Slide kind="process">
    <h2>How a slide finds its style</h2>
    <div class="wb-slide-flow">
      <div><b>Author</b> writes <code>&lt;Slide kind="stat"&gt;</code></div>
      <div><b>Runtime</b> applies <code>wb-slide--stat</code> class</div>
      <div><b>Theme</b> styles it via CSS variables</div>
    </div>
  </Slide>

  <Slide kind="qa">
    <h1>Questions?</h1>
    <p>See <a href="../workbook-presentation/SKILL.md">the workbook-presentation skill</a> for the full reference.</p>
  </Slide>
</Presentation>
