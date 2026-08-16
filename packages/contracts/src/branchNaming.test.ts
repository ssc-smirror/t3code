import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { BranchNamingPrefix } from "./branchNaming.ts";

const decodePrefix = Schema.decodeUnknownExit(BranchNamingPrefix);

describe("BranchNamingPrefix", () => {
  it("accepts valid single git ref components", () => {
    for (const prefix of ["t3code", "acme", "team-a", "release_2026", "v1.2"]) {
      expect(decodePrefix(prefix)._tag).toBe("Success");
    }
  });

  it("rejects values git check-ref-format refuses", () => {
    for (const prefix of [
      "foo..bar",
      "foo.lock",
      "Feature",
      "a/b",
      ".hidden",
      "dash-",
      "x".repeat(33),
      "",
    ]) {
      expect(decodePrefix(prefix)._tag).toBe("Failure");
    }
  });
});
