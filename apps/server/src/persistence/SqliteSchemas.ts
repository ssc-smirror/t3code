import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** SQLite stores booleans as 0/1 integers; decode them back to booleans. */
export const BooleanFromSqliteInt = Schema.Number.pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform<boolean, number>({
      decode: (value) => value !== 0,
      encode: (value) => (value ? 1 : 0),
    }),
  ),
);
