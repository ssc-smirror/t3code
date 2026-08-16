# Branch naming

When a thread starts in a new worktree, T3 Code creates a temporary branch and, once the model
understands the task from your first message, renames it to something descriptive (for example
`t3code/fix-login-crash`). You can configure how those generated names are built or turn automatic
naming off.

## Naming modes

Generated names are assembled from a prefix and a short slug. Three modes control the prefix:

- **Custom prefix** — a fixed prefix such as `t3code` (the default) or your team's namespace.
- **Conventional prefix** — the model chooses `feature`, `bugfix`, `hotfix`, `release`, or `chore`
  based on the task.
- **No prefix** — bare slugs like `fix-login-crash`, with no namespace segment.

## Where to configure it

The branch naming mode resolves in this order — the first one set wins:

1. **Project settings** — open **Settings → Projects**, select the project, and use the
   **Branch naming** and **Auto-generate branch name** rows under **New threads**. Applies to
   every checkout in the project group.
2. **`t3.json`** — commit a `branchNaming` entry to share a convention with everyone who opens
   the repository, for example `{ "branchNaming": { "mode": "prefix", "prefix": "acme" } }`.
3. **Global default** — **Settings → Text generation** has the fallback **Branch naming** mode
   and the **Auto-generate branch names** switch.

Automatic naming itself resolves from the per-project override to the global switch. A project
without an override inherits the global value.

The model used for naming follows the **Source control writer model** setting, falling back to
the global text generation model.

Branch generation runs on the server, so worktree branches created from any client — including
mobile — get configured prefixes and auto-naming.
