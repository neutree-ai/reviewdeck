import { describe, expect, it } from "vitest";
import { myersDiff, simpleDiff } from "./diff.ts";

describe("myersDiff", () => {
  it("detects no changes", () => {
    const result = myersDiff(["a", "b", "c"], ["a", "b", "c"]);
    expect(result.every((d) => d.type === " ")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("detects replacement", () => {
    const result = myersDiff(["a", "b", "c"], ["a", "X", "c"]);
    expect(result).toHaveLength(4); // a, -b, +X, c
    const types = result.map((d) => d.type);
    expect(types).toContain("-");
    expect(types).toContain("+");
  });

  it("detects insertion", () => {
    const result = myersDiff(["a", "c"], ["a", "b", "c"]);
    const added = result.filter((d) => d.type === "+");
    expect(added).toHaveLength(1);
    expect(added[0]!.content).toBe("b");
  });

  it("detects deletion", () => {
    const result = myersDiff(["a", "b", "c"], ["a", "c"]);
    const removed = result.filter((d) => d.type === "-");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.content).toBe("b");
  });
});

describe("simpleDiff", () => {
  it("compares line by line", () => {
    const result = simpleDiff(["a", "b"], ["a", "X"]);
    expect(result[0]).toMatchObject({ type: " ", content: "a" });
    expect(result[1]).toMatchObject({ type: "-", content: "b" });
    expect(result[2]).toMatchObject({ type: "+", content: "X" });
  });
});
