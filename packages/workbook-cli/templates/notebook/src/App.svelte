<script>
  import { Notebook, NotebookToolbar, NotebookCell } from "@work.books/runtime/notebook";

  let counter = $state(0);
</script>

<div class="nb">
  <header>
    <h1>%%NAME%%</h1>
    <p>A notebook workbook. Cells run top-to-bottom; outputs persist into the artifact.</p>
  </header>

  <Notebook>
    <NotebookToolbar />

    <NotebookCell title="Hello, notebook">
      <p>This is a Svelte cell. Anything inside it is a slide of
      content + reactive state. Click the play button to "run" it
      (notebook semantics — the cell re-renders).</p>
      <button onclick={() => (counter += 1)}>Clicked {counter} times</button>
    </NotebookCell>

    <NotebookCell title="Where to go from here">
      <p>Add cells, import data, run analyses. If your cells call
      <code>wb.polars</code> or <code>wb.sql</code>, the default
      <code>wasmVariant</code> includes them. If you only need SQL,
      set <code>wasmVariant: "minimal"</code>. If pure JS, set
      <code>"none"</code> to drop ~8 MB.</p>
    </NotebookCell>
  </Notebook>
</div>
