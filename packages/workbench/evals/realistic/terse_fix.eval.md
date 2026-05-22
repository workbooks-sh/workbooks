---
name: realistic/terse-fix
agent: workhorse
timeoutMs: 900000
setup:
  - kind: substrate.write_path
    path: workbooks/broken-spa/workbook.config.mjs
    content: |
      export default {
        slug: "broken-spa",
        type: "spa",
        entry: "src/index.html",
        inlineRuntime: false,
      };
  - kind: substrate.write_path
    path: workbooks/broken-spa/src/index.html
    content: |
      <!doctype html>
      <html>
        <body>
          <h1 id="title">loading</h1>
          <script type="module" src="./main.js"></script>
        </body>
      </html>
  - kind: substrate.write_path
    path: workbooks/broken-spa/src/main.js
    content: |
      const greeting = "Hello, reader;
      document.getElementById("title").textContent = greeting;
turns:
  - prompt: "fix this: workbooks/broken-spa"
    checks:
      - kind: session.tool_called
        name: ["read", "bash"]
      - kind: rubric.passes
        target: assistant_text
        rubric: |
          Context: the actual bug is an unterminated string literal in main.js
          (`"Hello, reader;` — missing the closing quote before the semicolon).

          Pass if the response includes ALL of these:
          1. A reference to the specific file that was wrong (main.js or "the JS file").
          2. A description of the actual bug — e.g. "unclosed string", "missing quote",
             "syntax error in the string literal", or a code excerpt showing the fix.
          3. Either a code snippet of the fix or a precise description of what was
             changed.

          Fail if ANY of these are true:
          - The response only says "fixed it" / "build succeeds" with no description
            of what was wrong.
          - Mentions a fix to a DIFFERENT file (e.g. index.html) without addressing
            the actual string-literal bug in main.js.
          - Claims to have fixed it but the description is too vague to verify
            (e.g. "I corrected a syntax error" without saying which one).
cleanup:
  - kind: substrate.remove_path
    path: workbooks/broken-spa
---

# realistic/terse-fix

Stress test for inference under minimal context. The user's prompt is two
words pointed at a directory. The bug is small and obvious if the agent
actually opens the file (an unterminated string).

Pass criteria:
1. The build, which would have failed on setup, now succeeds. (workbook.build)
2. The response shows the agent navigated to the file and made a real change.
   (rubric.passes)

If both pass, the agent handled the terse-prompt + file-inspection workflow.
If (1) fails and (2) passes, the agent talked about a fix without applying it.
If (2) fails, the agent didn't engage with the file at all.
