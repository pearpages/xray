import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { GitFixture } from "../testing/git-fixture.js";
import { inventory } from "./inventory.js";

const APP = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, include: ["src"] }),
  "src/main.tsx": 'import { App } from "./App";\nexport const root = () => <App />;\n',
  "src/App.tsx":
    'import { lazy } from "react";\nimport { Home } from "./pages/Home";\n' +
    'const Cart = lazy(() => import("./pages/Cart"));\nexport const App = () => <><Home /><Cart /></>;\n',
  "src/pages/Home.tsx": "export const Home = () => <p>home</p>;\n",
  "src/pages/Cart.tsx": "export default function Cart() {\n  return <p>cart</p>;\n}\n",
  "src/pages/Orders.tsx": "export const Orders = () => <p>orders</p>;\n",
  "src/lib/unused.ts": "export const forgotten = () => 1;\nconst internal = () => 2;\nexport const used = () => internal();\n",
  "src/lib/caller.ts": 'import { used } from "./unused";\nexport const call = () => used();\n',
};

let fixture: GitFixture;
afterEach(() => fixture.dispose());

describe("inventory", () => {
  it("lists entry-glob units with their callers and unused exports", () => {
    fixture = new GitFixture().write(APP);
    const result = inventory(fixture.root, resolveConfig(fixture.root));
    const byId = Object.fromEntries(result.candidates.map((c) => [c.id, c]));

    expect(byId["src/pages/Home.tsx#Home"]).toMatchObject({ reasons: ["entry-glob"], callers: 1 });
    // Reached only through lazy(() => import(...)).
    expect(byId["src/pages/Cart.tsx#Cart"]).toMatchObject({ reasons: ["entry-glob"], callers: 1 });
    expect(byId["src/pages/Orders.tsx#Orders"]).toMatchObject({ reasons: ["entry-glob"], callers: 0 });
    expect(byId["src/lib/unused.ts#forgotten"]?.reasons).toEqual(["unused-export"]);
    expect(byId["src/lib/unused.ts#used"]).toBeUndefined();
    expect(byId["src/lib/unused.ts#internal"]).toBeUndefined();
    expect(result.featureMap).toEqual({ status: "missing" });
  });

  it("checks an existing map: unknown entry points and pages no feature claims", () => {
    fixture = new GitFixture().write({
      ...APP,
      "xray.features.json": JSON.stringify({
        version: 1,
        features: [
          { id: "shop", name: "Shop", entryPoints: ["src/pages/Home.tsx#Home", "src/pages/Basket.tsx#Basket"] },
          { id: "cart", name: "Cart", entryPoints: [], files: ["src/pages/Cart.tsx"] },
        ],
      }),
    });
    const result = inventory(fixture.root, resolveConfig(fixture.root));
    expect(result.unknownEntryPoints).toEqual([{ feature: "shop", entryPoint: "src/pages/Basket.tsx#Basket" }]);
    // main.tsx matches the default entry globs too.
    expect(result.uncovered).toEqual(["src/main.tsx#root", "src/pages/Orders.tsx#Orders"]);
  });
});

describe("entry candidates in entry-glob files", () => {
  it("offers components, and uncalled units of component-less files, but not helpers", () => {
    fixture = new GitFixture().write({
      ...APP,
      // A helper next to a component, and a helper module the pages use.
      "src/pages/Home.tsx": 'import { label } from "./labels";\nexport const shout = (s: string) => s.toUpperCase();\nexport const Home = () => <p>{shout(label())}</p>;\n',
      "src/pages/labels.ts": 'export const label = () => "home";\n',
    });
    const ids = inventory(fixture.root, resolveConfig(fixture.root))
      .candidates.filter((c) => c.reasons.includes("entry-glob"))
      .map((c) => c.id)
      .sort();
    expect(ids).toEqual([
      "src/main.tsx#root",
      "src/pages/Cart.tsx#Cart",
      "src/pages/Home.tsx#Home",
      "src/pages/Orders.tsx#Orders",
    ]);
  });
});
