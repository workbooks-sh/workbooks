// What the build pipeline learns about your workbook. Slug becomes the
// output filename; type declares the workbook's render shape — one of:
// document, notebook, spa, presentation, playground, agent. Required.
// See `workbook explain` for any rule.
export default {
  name: "%%NAME%%",
  slug: "%%SLUG%%",
  entry: "index.html",
  type: "spa",
  // Identity surfaces on (1) the workbooks.sh splash page when
  // shared via `workbook publish`, and (2) a small "about" chip
  // inside the running workbook so recipients see who made it
  // even when the file is opened standalone. Uncomment + fill in.
  // author: "Your name",
  // description: "One-sentence description of what this workbook does.",
  //
  // Tools — what this workbook can do, advertised to MCP clients.
  // Each entry becomes one row in the group MCP endpoint at
  // workbooks.sh, namespaced wb__<workbook-id>__<tool-name>.
  // tools: [
  //   {
  //     name: "lookup",
  //     description: "Return current weather for a city.",
  //     input_schema: {
  //       type: "object",
  //       properties: { city: { type: "string" } },
  //       required: ["city"],
  //     },
  //     handler: "lookupWeather", // named export from your entry module
  //   },
  // ],
};
