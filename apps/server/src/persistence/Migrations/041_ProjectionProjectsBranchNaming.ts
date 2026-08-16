import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  // JSON-encoded BranchNamingConfig; NULL means "inherit".
  if (!columns.some((column) => column.name === "branch_naming")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN branch_naming TEXT
    `;
  }

  // 0/1 override; NULL means "inherit".
  if (!columns.some((column) => column.name === "auto_generate_branch_name")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN auto_generate_branch_name INTEGER
    `;
  }
});
