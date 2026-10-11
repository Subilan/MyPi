import { describe, expect, it } from "vitest";
import { insertPaths } from "./drop-paths";

describe("insertPaths", () => {
  it("returns null when there is nothing to insert", () => {
    expect(insertPaths("hello", 5, 5, [])).toBeNull();
    expect(insertPaths("hello", 5, 5, [""])).toBeNull();
  });

  it("appends the path at the caret with a separating space", () => {
    expect(insertPaths("look", 4, 4, ["/tmp/a.png"])).toEqual({
      text: "look /tmp/a.png ",
      caret: 16,
    });
  });

  it("does not add a space when the text already ends with whitespace", () => {
    expect(insertPaths("look ", 5, 5, ["/tmp/a.png"])).toEqual({
      text: "look /tmp/a.png ",
      caret: 16,
    });
  });

  it("replaces the selected range and inserts multiple paths", () => {
    const result = insertPaths("a SELECTED b", 2, 10, ["/x", "/y"]);
    expect(result).toEqual({ text: "a /x /y  b", caret: 8 });
  });

  it("clamps out-of-range offsets to the text length", () => {
    const result = insertPaths("abc", -5, 99, ["/z"]);
    expect(result).toEqual({ text: "/z ", caret: 3 });
  });
});
