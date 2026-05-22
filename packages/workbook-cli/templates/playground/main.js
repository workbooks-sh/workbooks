// Stage-bearing spa entry. The build pipeline writes the wrapped
// workbook's reference and panel layout into manifest.stage from
// workbook.config.mjs > stage { wraps, panels }. The render bootstrap
// lives in the runtime SDK so the layout primitive can evolve without
// authors touching this file.
import { mountStage } from "@work.books/runtime/stage";

mountStage(document.getElementById("playground-root"));
