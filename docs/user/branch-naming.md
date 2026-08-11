# Branch naming

When a thread starts in a new worktree, T3 Code creates a temporary branch and, once the model
understands the task from your first message, renames it to something descriptive (for example
`t3code/fix-login-crash`). You can configure how those names are built, regenerate them, or
rename branches by hand — all from the branch selector in the bottom-right of a thread.

## Naming modes

Generated names are assembled from a prefix and a short slug. Three modes control the prefix:

- **Custom prefix** — a fixed prefix such as `t3code` (the default) or your team's namespace.
- **Conventional prefixes** — the model picks between `feature`, `bugfix`, `hotfix`, `release`,
  and `chore` based on the task.
- **No prefix** — bare slugs like `fix-login-crash`, with no namespace segment.

## Where to configure it

Settings resolve in this order — the first one set wins:

1. **Project settings** — open **Settings → Projects**, select the project, and use the
   **Branch naming** and **Auto-generate branch name** rows under **New threads**. Applies to
   every checkout in the project group.
2. **`t3.json`** — commit a `branchNaming` entry to share a convention with everyone who opens
   the repository, for example `{ "branchNaming": { "mode": "conventional" } }`.
3. **Global default** — **Settings → Text generation** has the fallback **Branch naming** mode
   and the **Auto-generate branch names** switch.

The model used for naming follows the **Source control writer model** setting, falling back to
the global text generation model.

## Working with branch names in a thread

The branch selector sits in the bottom-right of the composer:

- **Generate a name** — select the sparkles button to (re)generate the branch name from the
  thread so far. While a name is generating, the sparkles button and branch label dim.
- **Rename by hand** — select the pencil button (or right-click the branch label and choose
  **Rename branch…**), edit the name inline, and press Enter. If the name is already taken,
  T3 Code appends a numeric suffix and shows the result. Renames are local-only: an open pull
  request keyed to the old branch name re-associates after you push the new name.
- **Auto-name branch** — the switch in the branch dropdown turns first-message auto-naming on
  or off for the project.

Branch generation runs on the server, so worktree branches created from any client — including
mobile — get configured prefixes and auto-naming. The rename and regenerate controls are
available in the desktop and web apps today; mobile does not yet expose them.
