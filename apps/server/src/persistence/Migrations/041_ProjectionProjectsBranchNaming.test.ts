import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_ProjectionProjectsBranchNaming", (it) => {
  it.effect("adds the nullable branch naming columns to project projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* runMigrations({ toMigrationInclusive: 41 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_projects)
      `;
      const branchNaming = columns.find((column) => column.name === "branch_naming");
      const autoGenerate = columns.find((column) => column.name === "auto_generate_branch_name");

      assert.equal(branchNaming?.name, "branch_naming");
      assert.equal(branchNaming?.notnull, 0);
      assert.equal(autoGenerate?.name, "auto_generate_branch_name");
      assert.equal(autoGenerate?.notnull, 0);
    }),
  );
});
