---
name: session/hello-md
agent: workhorse
turns:
  - prompt: "Reply with exactly the word PINGPONG and nothing else."
    checks:
      - kind: session.text_contains
        substring: PINGPONG
---

# session/hello-md

Markdown form of the basic broker-liveness smoke. The body of the file
is human notes — only the YAML frontmatter above is parsed.

This eval should produce the same outcome as `session/hello.eval.json`.
Useful for verifying the .eval.md loader.
