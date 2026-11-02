import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { isComponentLike, unitsOf } from "./units.js";

const units = (text: string) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  return unitsOf(project.createSourceFile("src/cart.tsx", text), "src/cart.tsx").map((unit) => ({ name: unit.name, kind: unit.kind, isDefaultExport: unit.isDefaultExport }));
};

describe("unitsOf", () => {
  it("finds functions, classes and tables in source order", () => {
    expect(units("export function total() {}\nclass Store {}\nexport const OPTIONS = { a: 1 };\nconst add = () => 1;\nconst [a] = [1];\n")).toEqual([
      { name: "total", kind: "code", isDefaultExport: false },
      { name: "Store", kind: "code", isDefaultExport: false },
      { name: "OPTIONS", kind: "table", isDefaultExport: false },
      { name: "add", kind: "code", isDefaultExport: false },
    ]);
  });

  it("knows the default export however it is written", () => {
    expect(units("export default function Cart() {}\n")[0]).toMatchObject({ name: "Cart", isDefaultExport: true });
    expect(units("export default class {}\n")[0]).toMatchObject({ name: "default", isDefaultExport: true });
    expect(units("function Cart() {}\nexport default Cart;\n")[0]).toMatchObject({ name: "Cart", isDefaultExport: true });
    expect(units("const Cart = () => null;\nexport { Cart as default };\n")[0]).toMatchObject({ name: "Cart", isDefaultExport: true });
    expect(units("export default () => null;\n")[0]).toMatchObject({ name: "default", isDefaultExport: true });
    expect(units('export { Cart as default } from "./other";\nfunction Cart() {}\n')[0]).toMatchObject({ isDefaultExport: false });
  });

  it("treats PascalCase and default exports as components", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const [screen, helper, table] = unitsOf(project.createSourceFile("a.tsx", "export function Market() {}\nfunction listings() {}\nconst OPTIONS = { a: 1 };\n"), "a.tsx");
    expect([screen, helper, table].map((unit) => isComponentLike(unit!))).toEqual([true, false, false]);
  });
});
