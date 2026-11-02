import { describe, expect, it } from "vitest";
import { loadSaved, save } from "./storage";
import { MemoryStorage, report } from "./testing/fixtures";

describe("storage", () => {
  it("keeps reports for the next visit and forgets them when all are closed", () => {
    const storage = new MemoryStorage();
    expect(loadSaved(storage)).toEqual([]);
    expect(save(storage, [report()])).toBe(true);
    expect(loadSaved(storage)).toEqual([report()]);
    expect(save(storage, [])).toBe(true);
    expect(storage.length).toBe(0);
  });

  it("drops what it can't read instead of failing", () => {
    const storage = new MemoryStorage();
    storage.setItem("xray-quality:reports", JSON.stringify([report(), { version: 2 }]));
    expect(loadSaved(storage)).toHaveLength(1);
    storage.setItem("xray-quality:reports", "{");
    expect(loadSaved(storage)).toEqual([]);
  });

  it("says so when the browser can't keep them", () => {
    expect(save(new MemoryStorage(true), [report()])).toBe(false);
    expect(save(undefined, [report()])).toBe(false);
    expect(loadSaved(undefined)).toEqual([]);
  });
});
