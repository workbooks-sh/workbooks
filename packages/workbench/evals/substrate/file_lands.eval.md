---
name: substrate/file-lands
agent: workhorse
turns:
  - prompt: "Create the file eval-fixtures/file-lands.txt containing exactly the word LANDED (no newline). Commit and push it to the substrate. Reply DONE when finished."
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.file_contains
        path: eval-fixtures/file-lands.txt
        substring: LANDED
cleanup:
  - kind: substrate.remove_path
    path: eval-fixtures/file-lands.txt
---

# substrate/file-lands

Single-file write claim from wb-acx2: an agent session writes a file
and the file lands in the substrate in a single push/single session.
