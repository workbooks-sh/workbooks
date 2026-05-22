// Param-resolution helper: turn `ctx:<key>` strings into the live
// value held on the ctx object at check/action invocation time.
//
// Lets spec authors write:
//
//     path: ctx:waveletCommercialMp4
//
// instead of duplicating filesystem-derived paths across turns.
// Recursively walks objects and arrays so nested fields work
// (e.g. attachments.mp4_path: ctx:waveletCommercialMp4).

const PREFIX = "ctx:";

export function resolveCtxRefs(value, ctx) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.startsWith(PREFIX)) {
      const key = value.slice(PREFIX.length);
      const v = ctx?.[key];
      return v === undefined ? value : v;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveCtxRefs(v, ctx));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveCtxRefs(v, ctx);
    }
    return out;
  }
  return value;
}
