import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig, type XrayConfigInput } from "../config.js";
import { analyzePullRequest, renderMarkdown } from "../index.js";
import { GitFixture } from "../testing/git-fixture.js";
import type { InteractionsAnalysis } from "./analyze.js";

/** A small shop: pages render components, a screen registry mounts components by key. */
const SHOP = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { jsx: "react-jsx", baseUrl: ".", paths: { "@/*": ["src/*"] } },
    include: ["src"],
  }),
  "src/main.tsx": 'import { App } from "./App";\nexport const root = () => <App />;\n',
  "src/App.tsx":
    'import { lazy } from "react";\nimport { SCREENS } from "./registry";\n' +
    'const Cart = lazy(() => import("@/pages/Cart"));\n' +
    "export const App = ({ screen }: { screen: string }) => {\n" +
    "  const Screen = SCREENS[screen];\n  return screen === \"cart\" ? <Cart /> : <Screen />;\n};\n",
  "src/registry.ts":
    'import { Home } from "@/pages/Home";\nimport { Account } from "./Account";\n' +
    "export const SCREENS = { home: Home, Account };\n",
  "src/Account.tsx": 'import { PriceTag } from "@/components/PriceTag";\nexport const Account = () => <PriceTag amount={0} />;\n',
  "src/pages/Home.tsx": 'import { PriceTag } from "@/components/PriceTag";\nexport const Home = () => <PriceTag amount={1} />;\n',
  "src/pages/Cart.tsx":
    'import { PriceTag } from "@/components/PriceTag";\nimport { useCart } from "@/hooks/useCart";\n' +
    "export default function Cart() {\n  const cart = useCart();\n  return <PriceTag amount={cart.total} />;\n}\n",
  "src/hooks/useCart.ts": 'import { total } from "@/lib/cart";\nexport const useCart = () => ({ total: total([]) });\n',
  "src/lib/cart.ts": "export const total = (prices: number[]) => prices.reduce((a, b) => a + b, 0);\n",
  "src/lib/format.ts": "export const formatPrice = (n: number) => `${n.toFixed(2)} €`;\n",
  "src/components/PriceTag.tsx":
    'import { formatPrice } from "@/lib/format";\n' +
    "export const PriceTag = ({ amount }: { amount: number }) => <span>{formatPrice(amount)}</span>;\n",
  "src/components/PriceTag.test.tsx": 'import { PriceTag } from "./PriceTag";\nexport const check = () => <PriceTag amount={2} />;\n',
  "src/components/PriceTag.stories.tsx": 'import { PriceTag } from "./PriceTag";\nexport const Default = () => <PriceTag amount={3} />;\n',
};

let fixture: GitFixture;
afterEach(() => fixture.dispose());

async function analyse(
  changes: Record<string, string>,
  setup?: (fixture: GitFixture) => void,
  config: XrayConfigInput = {},
) {
  fixture = new GitFixture().write(SHOP);
  setup?.(fixture);
  fixture.commit("base").branch("feature").write(changes).commit("change");
  return analyzePullRequest({ cwd: fixture.root, base: "main", config: resolveConfig(fixture.root, config) });
}

const edges = (analysis: InteractionsAnalysis, featureName: string) =>
  analysis.features
    .find((feature) => feature.name === featureName)
    ?.interactions.map((i) => `${i.from.split("#")[1]} -${i.kind}-> ${i.to.split("#")[1]}`)
    .sort();

describe("analyzeInteractions", () => {
  it("walks a changed helper up to every entry point, through renders, mounts and lazy imports", async () => {
    const { interactions } = await analyse({
      "src/lib/format.ts": "export const formatPrice = (n: number) => `${n.toFixed(2)} EUR`;\n",
    });

    expect(interactions.touched).toEqual(["src/lib/format.ts#formatPrice"]);
    expect(interactions.featureMap).toBe("missing");
    // Pages are entry points by convention; Account is only reachable through the registry,
    // up to the unit `root` in src/main.tsx.
    expect(interactions.features.map((feature) => feature.name).sort()).toEqual(["Cart", "Home", "root"]);
    expect(edges(interactions, "Home")).toEqual([
      "Home -renders-> PriceTag",
      "PriceTag -calls-> formatPrice",
    ]);
    expect(edges(interactions, "root")).toEqual([
      "Account -renders-> PriceTag",
      "App -mounts-> SCREENS",
      "PriceTag -calls-> formatPrice",
      "SCREENS -mounts-> Account",
      "root -renders-> App",
    ]);
    // The test file and the story render PriceTag too, but are not callers.
    const ids = Object.keys(interactions.units).join(" ");
    expect(ids).not.toContain("test");
    expect(ids).not.toContain("stories");
  });

  it("follows a lazy import() to the default export and goes two levels down", async () => {
    const twoLevels = { interactions: { depthDown: 2 } };
    const { interactions } = await analyse({
      "src/pages/Cart.tsx":
        'import { PriceTag } from "@/components/PriceTag";\nimport { useCart } from "@/hooks/useCart";\n' +
        "export default function Cart() {\n  const cart = useCart();\n  return <p><PriceTag amount={cart.total} /></p>;\n}\n",
    }, undefined, twoLevels);

    expect(interactions.touched).toEqual(["src/pages/Cart.tsx#Cart"]);
    expect(interactions.units["src/pages/Cart.tsx#Cart"]?.change).toBe("modified");
    expect(edges(interactions, "Cart")).toEqual([
      "Cart -renders-> PriceTag",
      "Cart -uses-> useCart",
      "PriceTag -calls-> formatPrice",
      "useCart -calls-> total",
    ]);
  });

  it("groups by the feature map, and lists what it doesn't cover", async () => {
    const featureMap = {
      version: 1,
      features: [
        { id: "shop", name: "Shopping", entryPoints: ["src/pages/Home.tsx#Home", "src/pages/Cart.tsx#Cart"] },
        { id: "money", name: "Money formatting", entryPoints: [], files: ["src/lib/**"] },
      ],
    };
    const { interactions } = await analyse(
      {
        "src/lib/format.ts": "export const formatPrice = (n: number) => `${n.toFixed(2)} EUR`;\n",
        "src/Account.tsx": 'import { PriceTag } from "@/components/PriceTag";\nexport const Account = () => <b><PriceTag amount={0} /></b>;\n',
      },
      (f) => f.write({ "xray.features.json": JSON.stringify(featureMap) }),
    );
    expect(interactions.featureMap).toBe("found");
    // Mapped features first; Account falls back to its entry point.
    expect(interactions.features.map((feature) => [feature.name, feature.mapped])).toEqual([
      ["Money formatting", true],
      ["Shopping", true],
      ["root", false],
    ]);
    expect(interactions.features.find((f) => f.id === "shop")?.entryPoints.sort()).toEqual([
      "src/pages/Cart.tsx#Cart",
      "src/pages/Home.tsx#Home",
    ]);
    // Account only reaches main.tsx, which no feature claims.
    expect(interactions.unmapped).toEqual(["src/Account.tsx#Account"]);
  });

  it("stops at a hub without a feature map, and shows who shares it", async () => {
    const { interactions } = await analyse(
      { "src/lib/format.ts": "export const formatPrice = (n: number) => `${n.toFixed(2)} EUR`;\n" },
      undefined,
      // PriceTag has 3 callers (Home, Cart, Account); with a threshold of 2 it is a hub.
      { interactions: { hubCallers: 2 } },
    );
    expect(interactions.features).toHaveLength(1);
    const [hub] = interactions.features;
    expect(hub?.name).toBe("PriceTag (shared by 3)");
    expect(hub?.sharedBy?.map((id) => id.split("#")[1]).sort()).toEqual(["Account", "Cart", "Home"]);
    expect(renderMarkdown(await analyzePullRequest({
      cwd: fixture.root,
      base: "main",
      config: resolveConfig(fixture.root, { interactions: { hubCallers: 2 } }),
    }))).toContain("Used by 3:");
  });

  it("caps the callees drawn per unit and counts the rest", async () => {
    const { interactions } = await analyse(
      {
        "src/pages/Cart.tsx":
          'import { PriceTag } from "@/components/PriceTag";\nimport { useCart } from "@/hooks/useCart";\n' +
          "export default function Cart() {\n  const cart = useCart();\n  return <i><PriceTag amount={cart.total} /></i>;\n}\n",
      },
      undefined,
      { interactions: { maxCallees: 1 } },
    );
    const cart = interactions.features.find((feature) => feature.name === "Cart");
    expect(cart?.interactions.map((i) => i.to.split("#")[1])).toEqual(["useCart"]);
    expect(cart?.hiddenCallees).toEqual({ "src/pages/Cart.tsx#Cart": 1 });
  });

  it("reports new and removed units", async () => {
    const { interactions } = await analyse({
      "src/lib/format.ts": "export const formatMoney = (n: number) => `${n.toFixed(2)} €`;\n",
    });
    expect(interactions.units["src/lib/format.ts#formatMoney"]?.change).toBe("added");
    expect(interactions.deleted).toEqual(["src/lib/format.ts#formatPrice"]);
  });

  it("skips the walk above maxTouchedUnits", async () => {
    fixture = new GitFixture().write(SHOP).commit("base").branch("feature");
    fixture.write({ "src/lib/many.ts": "export const a = () => 1;\nexport const b = () => 2;\nexport const c = () => 3;\n" }).commit("x");
    const config = resolveConfig(fixture.root, { interactions: { maxTouchedUnits: 2 } });
    const { interactions } = await analyzePullRequest({ cwd: fixture.root, base: "main", config });
    expect(interactions.skipped).toEqual({ reason: "too-many-units", limit: 2 });
    expect(interactions.features).toEqual([]);
  });

  it("renders the missing-map warning and a sequence diagram", async () => {
    const result = await analyse({
      "src/lib/format.ts": "export const formatPrice = (n: number) => `${n.toFixed(2)} EUR`;\n",
    });
    const markdown = renderMarkdown(result);
    expect(markdown).toContain("No `xray.features.json` found");
    expect(markdown).toContain("sequenceDiagram");
    expect(markdown).toMatch(/participant p\d+ as formatPrice ✏️/);
    expect(markdown).toContain("->>");
  });

  it("does nothing when no code changed", async () => {
    const { interactions } = await analyse({ "README.md": "hi\n" });
    expect(interactions.touched).toEqual([]);
    expect(renderMarkdown(await analyzePullRequest({ cwd: fixture.root, base: "main" }))).toContain(
      "No function, component or hook changed in this PR.",
    );
  });
});
