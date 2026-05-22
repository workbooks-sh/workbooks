<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as Y from "../yjsHost";
  import { getStageDoc } from "./context";
  import {
    groupsFromTools,
    groupFromParams,
    parseCapabilitiesFromHtml,
    parseParamsFromHtml,
    type ToolGroup,
  } from "./effectsSchema";

  let {
    wrappedSrc,
    iframe,
  }: { wrappedSrc: string; iframe?: HTMLIFrameElement } = $props();

  const PARAMS_ENVELOPE = "wb_playground_params" as const;

  function requestParamsViaPostMessage(): Promise<{ tools: unknown; params: unknown } | null> {
    return new Promise((resolve) => {
      let resolved = false;
      let interval: ReturnType<typeof setInterval> | undefined;
      function finish(payload: { tools: unknown; params: unknown } | null) {
        if (resolved) return;
        resolved = true;
        if (interval) clearInterval(interval);
        window.removeEventListener("message", onMsg);
        resolve(payload);
      }
      function onMsg(ev: MessageEvent) {
        const d = ev.data;
        if (d && d[PARAMS_ENVELOPE] === 1 && d.type === "response") {
          finish(d.payload ?? null);
        }
      }
      window.addEventListener("message", onMsg);
      function send() {
        const target = iframe?.contentWindow;
        if (target) target.postMessage({ [PARAMS_ENVELOPE]: 1, type: "request" }, "*");
      }
      // Retry every 500ms — the wrapped's bootstrap can take a few
      // seconds before connectToPlayground registers its listener.
      send();
      interval = setInterval(send, 500);
      setTimeout(() => finish(null), 8000);
    });
  }

  let groups = $state<ToolGroup[]>([]);
  let status = $state<"loading" | "ready" | "empty" | "error">("loading");
  let statusMessage = $state<string | undefined>();
  let values = $state<Record<string, unknown>>({});

  const holder = getStageDoc();

  let stateMap: Y.Map<unknown> | undefined;
  let observer: ((ev: unknown) => void) | undefined;

  function hydrateFromDoc() {
    if (!stateMap) return;
    const next: Record<string, unknown> = {};
    for (const group of groups) {
      for (const c of group.controls) {
        if (stateMap.has(c.key)) next[c.key] = stateMap.get(c.key);
        else if (c.schema.default !== undefined) next[c.key] = c.schema.default;
      }
    }
    values = next;
  }

  function writeValue(key: string, value: unknown) {
    if (!stateMap) {
      values = { ...values, [key]: value };
      return;
    }
    const doc = stateMap.doc;
    if (doc) {
      doc.transact(() => stateMap!.set(key, value));
    } else {
      stateMap.set(key, value);
    }
    values = { ...values, [key]: value };
  }

  function bindDoc() {
    const handle = holder?.current;
    if (!handle) return;
    stateMap = handle.doc.getMap("state");
    observer = () => hydrateFromDoc();
    stateMap.observe(observer);
    hydrateFromDoc();
  }

  function unbindDoc() {
    if (stateMap && observer) {
      stateMap.unobserve(observer);
    }
    stateMap = undefined;
    observer = undefined;
  }

  onMount(async () => {
    let tools: unknown = null;
    let params: unknown = null;
    try {
      const res = await fetch(wrappedSrc, { mode: "cors", credentials: "same-origin" });
      if (res.ok) {
        const html = await res.text();
        const parser = new DOMParser();
        tools = parseCapabilitiesFromHtml(html, parser);
        params = parseParamsFromHtml(html, parser);
      }
    } catch {
      // Cross-origin fetch blocked (sandboxed origin:null) — fall through.
    }
    if (tools == null && params == null) {
      const viaPostMessage = await requestParamsViaPostMessage();
      if (viaPostMessage) {
        tools = viaPostMessage.tools;
        params = viaPostMessage.params;
      }
    }
    if (tools == null && params == null) {
      status = "error";
      statusMessage = "couldn't load tool definitions";
      return;
    }
    const merged: ToolGroup[] = [];
    if (tools) merged.push(...groupsFromTools(tools as Parameters<typeof groupsFromTools>[0]));
    if (params) {
      const paramGroup = groupFromParams(params as Parameters<typeof groupFromParams>[0]);
      if (paramGroup) merged.push(paramGroup);
    }
    groups = merged;
    status = groups.length === 0 ? "empty" : "ready";
    bindDoc();
  });

  onDestroy(() => unbindDoc());

  function onNumberInput(key: string, raw: string, asInt: boolean) {
    if (raw === "") return;
    const n = asInt ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (Number.isFinite(n)) writeValue(key, n);
  }
</script>

<div class="effects">
  {#if status === "loading"}
    <p class="status">loading tools…</p>
  {:else if status === "error"}
    <p class="status error">{statusMessage}</p>
  {:else if status === "empty"}
    <p class="status">no tunable parameters</p>
  {:else}
    {#each groups as group (group.name)}
      <section class="group">
        <header>
          <h3>{group.name}</h3>
          {#if group.description}<p class="desc">{group.description}</p>{/if}
        </header>
        {#each group.controls as control (control.key)}
          <div class="row" data-control={control.kind} data-key={control.key}>
            <label for="ctl-{group.name}-{control.key}">{control.label}</label>
            {#if control.kind === "slider"}
              <div class="slider-row">
                <input
                  id="ctl-{group.name}-{control.key}"
                  type="range"
                  min={control.schema.minimum}
                  max={control.schema.maximum}
                  step={(control.schema.maximum! - control.schema.minimum!) / 100}
                  value={values[control.key] ?? control.schema.default ?? control.schema.minimum}
                  oninput={(e) => writeValue(control.key, Number.parseFloat((e.target as HTMLInputElement).value))}
                />
                <span class="value">{values[control.key] ?? control.schema.default ?? control.schema.minimum}</span>
              </div>
            {:else if control.kind === "number"}
              <input
                id="ctl-{group.name}-{control.key}"
                type="number"
                value={(values[control.key] ?? control.schema.default ?? "") as number | string}
                oninput={(e) => onNumberInput(control.key, (e.target as HTMLInputElement).value, false)}
              />
            {:else if control.kind === "integer"}
              <input
                id="ctl-{group.name}-{control.key}"
                type="number"
                step="1"
                value={(values[control.key] ?? control.schema.default ?? "") as number | string}
                oninput={(e) => onNumberInput(control.key, (e.target as HTMLInputElement).value, true)}
              />
            {:else if control.kind === "select"}
              <select
                id="ctl-{group.name}-{control.key}"
                value={(values[control.key] ?? control.schema.default ?? "") as string}
                onchange={(e) => writeValue(control.key, (e.target as HTMLSelectElement).value)}
              >
                {#each control.schema.enum ?? [] as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else if control.kind === "text"}
              <input
                id="ctl-{group.name}-{control.key}"
                type="text"
                value={(values[control.key] ?? control.schema.default ?? "") as string}
                oninput={(e) => writeValue(control.key, (e.target as HTMLInputElement).value)}
              />
            {:else if control.kind === "boolean"}
              <input
                id="ctl-{group.name}-{control.key}"
                type="checkbox"
                checked={Boolean(values[control.key] ?? control.schema.default)}
                onchange={(e) => writeValue(control.key, (e.target as HTMLInputElement).checked)}
              />
            {:else}
              <span class="complex">complex type</span>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  .effects {
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-size: 12px;
  }
  .status {
    opacity: 0.6;
    margin: 0;
  }
  .status.error {
    color: #f87171;
    opacity: 1;
  }
  .group header {
    margin-bottom: 8px;
  }
  .group h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.7;
    margin: 0 0 2px;
  }
  .group .desc {
    margin: 0;
    opacity: 0.5;
    font-size: 11px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .row label {
    opacity: 0.8;
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .slider-row input[type="range"] {
    flex: 1;
  }
  .slider-row .value {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
    min-width: 3ch;
    text-align: right;
  }
  input[type="number"],
  input[type="text"],
  select {
    background: var(--pg-bg, #0a0a0a);
    color: inherit;
    border: 1px solid var(--pg-border, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
  }
  .complex {
    opacity: 0.4;
    font-style: italic;
  }
</style>
