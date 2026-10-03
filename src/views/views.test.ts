import { describe, it, expect } from "vitest";
import * as viewsFromViews from "./views";
import * as viewsFromIndex from "./index";
import { lighten, stringifyData } from "./overview";

describe("views module structure", () => {
  it("exports all required view builders from index.ts", () => {
    expect(typeof viewsFromIndex.buildHeader).toBe("function");
    expect(typeof viewsFromIndex.buildOverview).toBe("function");
    expect(typeof viewsFromIndex.buildApproval).toBe("function");
    expect(typeof viewsFromIndex.buildQuestion).toBe("function");
    expect(typeof viewsFromIndex.buildError).toBe("function");
    expect(typeof viewsFromIndex.buildFinished).toBe("function");
    expect(typeof viewsFromIndex.buildConfused).toBe("function");
    expect(typeof viewsFromIndex.buildEmpty).toBe("function");
    expect(typeof viewsFromIndex.buildNote).toBe("function");
    expect(typeof viewsFromIndex.buildPrompt).toBe("function");
    expect(typeof viewsFromIndex.buildUpload).toBe("function");
    expect(typeof viewsFromIndex.buildUploading).toBe("function");
    expect(typeof viewsFromIndex.buildChoose).toBe("function");
    expect(typeof viewsFromIndex.buildViews).toBe("function");
    expect(typeof viewsFromIndex.card).toBe("function");
    expect(typeof viewsFromIndex.btn).toBe("function");
    expect(typeof viewsFromIndex.agentWho).toBe("function");
    expect(typeof viewsFromIndex.stack).toBe("function");
    expect(typeof viewsFromIndex.buildPlaceholder).toBe("function");
    expect(typeof viewsFromIndex.lighten).toBe("function");
    expect(typeof viewsFromIndex.buildPill).toBe("function");
  });

  it("exports view builders and registry from views.ts for backwards compatibility", () => {
    expect(typeof viewsFromViews.buildHeader).toBe("function");
    expect(typeof viewsFromViews.buildOverview).toBe("function");
    expect(typeof viewsFromViews.buildApproval).toBe("function");
    expect(typeof viewsFromViews.buildQuestion).toBe("function");
    expect(typeof viewsFromViews.buildError).toBe("function");
    expect(typeof viewsFromViews.buildFinished).toBe("function");
    expect(typeof viewsFromViews.buildConfused).toBe("function");
    expect(typeof viewsFromViews.buildEmpty).toBe("function");
    expect(typeof viewsFromViews.buildNote).toBe("function");
    expect(typeof viewsFromViews.buildViews).toBe("function");
  });
});

describe("lighten", () => {
  it("lightens black correctly", () => {
    expect(lighten("#000000", 0.1)).toBe("rgb(26,26,26)");
    expect(lighten("#000000", 0.5)).toBe("rgb(128,128,128)");
  });

  it("clamps values to 255", () => {
    expect(lighten("#ffffff", 0.5)).toBe("rgb(255,255,255)");
    expect(lighten("#ff0000", 0.5)).toBe("rgb(255,128,128)");
  });

  it("lightens custom hex color components", () => {
    expect(lighten("#102030", 0.2)).toBe("rgb(67,83,99)");
  });
});

describe("stringifyData", () => {
  it("returns {} for undefined, null, or non-object types", () => {
    expect(stringifyData(undefined)).toBe("{}");
    expect(stringifyData(null)).toBe("{}");
    expect(stringifyData("string")).toBe("{}");
    expect(stringifyData(123)).toBe("{}");
    expect(stringifyData(true)).toBe("{}");
  });

  it("stringifies empty and populated objects accurately", () => {
    expect(stringifyData({})).toBe("{}");
    expect(stringifyData({ totalRepos: 42 })).toBe('{"totalRepos":42}');
  });

  it("caches the result by object reference", () => {
    const data = { deployments: [{ id: "1", state: "READY" }] };
    const first = stringifyData(data);
    const second = stringifyData(data);
    expect(first).toBe(second);
    expect(first).toBe('{"deployments":[{"id":"1","state":"READY"}]}');
  });

  it("updates stringification when given a new object instance", () => {
    const data1 = { count: 1 };
    const data2 = { count: 2 };
    expect(stringifyData(data1)).toBe('{"count":1}');
    expect(stringifyData(data2)).toBe('{"count":2}');
  });
});

