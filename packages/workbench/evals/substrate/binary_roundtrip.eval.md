---
name: substrate/binary-roundtrip
agent: workhorse
setup:
  - kind: substrate.write_path
    path: eval-fixtures/binary-roundtrip.bin
    base64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w=="
turns:
  - checks:
      - kind: substrate.file_bytes_match
        path: eval-fixtures/binary-roundtrip.bin
        sha256: "40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880"
cleanup:
  - kind: substrate.remove_path
    path: eval-fixtures/binary-roundtrip.bin
---

# substrate/binary-roundtrip

Pushes a 256-byte payload (0x00..0xFF) into the substrate via the
eval framework's own write_path action and re-reads it after a fresh
fetch. Verifies the substrate preserves bytes exactly — no encoding
munging, no line-ending normalization, no truncation.

This is an agent-free check (no chat turn) — it isolates substrate-
preservation behavior from agent behavior. Pair it with the agent-
driven binary eval (TODO) once the agent surface for arbitrary
binary writes is solid.
