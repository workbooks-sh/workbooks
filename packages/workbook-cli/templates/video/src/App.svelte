<script>
  import { Theater, Composition } from "@work.books/runtime/composition";
  // Inline the XML as raw text so the single-file artifact is fully
  // self-contained (no runtime fetch). The `?raw` query is a Vite
  // convention; the workbook build pipeline uses Vite, so this works
  // in both `workbook dev` and `workbook build`.
  import introXml from "../intro.xml?raw";
  import mainXml from "../main.xml?raw";
  // Inline the transcript so the caption renderer doesn't need to
  // fetch the .json at runtime (it can't, in a bundled .html). The
  // `transcripts` prop wires it up by analysis id.
  import t1Words from "../transcript.words.json";
</script>

<Theater title="%%NAME%%">
  <Composition id="intro" xml={introXml} />
  <Composition id="main" xml={mainXml} transcripts={{ t1: t1Words }} />
</Theater>
