import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../core/src/testing/git-fixture.js";
import { qualityHistory, remoteKey, repoKey, reportsHome } from "./home.js";

let fixture: GitFixture | undefined;
let plain: string | undefined;
afterEach(() => {
  fixture?.dispose();
  if (plain) rmSync(plain, { recursive: true, force: true });
  fixture = plain = undefined;
});

describe("reportsHome", () => {
  it("is ~/.xray/reports, or $XRAY_HOME/reports", () => {
    expect(reportsHome({})).toBe(join(homedir(), ".xray", "reports"));
    expect(reportsHome({ XRAY_HOME: "/data/xray" })).toBe(join("/data/xray", "reports"));
  });
});

describe("remoteKey", () => {
  it.each([
    ["git@github.com:pearpages/xray.git", "pearpages-xray"],
    ["https://github.com/pearpages/xray", "pearpages-xray"],
    ["https://github.com/pearpages/xray.git/", "pearpages-xray"],
    ["ssh://git@gitlab.example.com:2222/group/sub/my.repo.git", "sub-my.repo"],
  ])("%s → %s", (url, key) => expect(remoteKey(url)).toBe(key));

  it("gives nothing for a URL without an owner and a name", () => {
    expect(remoteKey("")).toBeUndefined();
    expect(remoteKey("xray")).toBeUndefined();
  });
});

describe("repoKey", () => {
  it("uses the origin remote's owner and name, from any folder of the repository", () => {
    fixture = new GitFixture().write({ "src/a.ts": "export const a = 1;\n" }).commit("base");
    fixture.git("remote", "add", "origin", "git@github.com:acme/shop.git");
    expect(repoKey(fixture.root)).toBe("acme-shop");
    expect(repoKey(join(fixture.root, "src"))).toBe("acme-shop");
    expect(qualityHistory(join(fixture.root, "src"), { XRAY_HOME: "/h" })).toBe(join("/h", "reports", "acme-shop", "quality"));
  });

  it("falls back to the top folder's name without a remote, and to the folder outside git", () => {
    fixture = new GitFixture().write({ "src/a.ts": "export const a = 1;\n" }).commit("base");
    expect(repoKey(join(fixture.root, "src"))).toBe(basename(fixture.root));
    plain = mkdtempSync(join(tmpdir(), "xray home "));
    expect(repoKey(plain)).toBe(basename(plain).replace(/ /g, "-"));
  });
});
