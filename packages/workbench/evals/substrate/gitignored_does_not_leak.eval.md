---
name: substrate/gitignored-does-not-leak
agent: workhorse
turns:
  - prompt: |
      Create three files at the repository root:
      - `.env` containing `SECRET=fake-do-not-commit`
      - `.pi/notes.txt` containing `pi-internal scratch`
      - `eval-fixtures/gitignored-marker.txt` containing `MARKER`
      Commit any changes that the substrate would normally accept. Reply DONE when finished.
    checks:
      - kind: session.text_contains
        substring: [DONE, Done, done]
      - kind: substrate.gitignored
        path: .env
      - kind: substrate.gitignored
        path: .pi/notes.txt
      - kind: substrate.file_contains
        path: eval-fixtures/gitignored-marker.txt
        substring: MARKER
cleanup:
  - kind: substrate.remove_path
    path: eval-fixtures/gitignored-marker.txt
---

# substrate/gitignored-does-not-leak

`.env` and `.pi/` are gitignored at the agent template root. This eval
proves that even when an agent writes files into those paths, none
of them reach the substrate (the gitignore rules are enforced by the
sandbox's pre-push tooling, not by the broker — so if they ever do
leak, this catches it).

The third file is a positive control: a write to a non-ignored path
must still land. Without it, an over-broad gitignore that swallows
everything would still pass the first two checks.
