import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { analyzePullRequest } from "../index.js";
import { GitFixture } from "../testing/git-fixture.js";
import { routePath } from "./routes.js";

describe("routePath", () => {
  it("maps App Router and Pages Router files to URLs", () => {
    expect(routePath("app/route.ts")).toBe("/");
    expect(routePath("src/app/(shop)/cart/[id]/route.ts")).toBe("/cart/[id]");
    expect(routePath("apps/web/app/@modal/api/users/route.js")).toBe("/api/users");
    expect(routePath("pages/api/cart/index.ts")).toBe("/api/cart");
    expect(routePath("src/pages/api/users/[id].ts")).toBe("/api/users/[id]");
    expect(routePath("app/cart/page.tsx")).toBeUndefined();
  });
});

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

describe("route changes", () => {
  it("compares the methods a route file exports, and treats a move as a new URL", async () => {
    const repo = (fixture = new GitFixture()
      .write({
        "tsconfig.json": JSON.stringify({ include: ["app", "pages"] }),
        "app/cart/route.ts": "export async function GET() {}\nexport async function DELETE() {}\n",
        "pages/api/legacy.ts": "export default function handler() {}\n",
      })
      .commit("base")
      .branch("feature"));
    repo
      .write({ "app/cart/route.ts": "export async function GET() {}\nexport async function POST() {}\n" })
      .remove("pages/api/legacy.ts")
      .commit("change");
    // Moved as-is: git reports a rename, and the URL changes.
    repo
      .write({ "app/basket/route.ts": "export async function GET() {}\nexport async function POST() {}\n" })
      .remove("app/cart/route.ts")
      .commit("move");

    const { api } = await analyzePullRequest({ cwd: repo.root, base: "main", config: resolveConfig(repo.root) });
    expect(api.endpoints.map((e) => `${e.compatibility} ${e.change} ${e.method} ${e.path}`).sort()).toEqual([
      "breaking removed ANY /api/legacy",
      "breaking removed DELETE /cart",
      "breaking removed GET /cart",
      "compatible added GET /basket",
      "compatible added POST /basket",
    ]);
  });
});
