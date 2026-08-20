import { describe, it, expect } from "vitest";
import { toCSV } from "../csv";

describe("toCSV", () => {
  it("generates CSV with header and rows", () => {
    const rows = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const columns = [
      { key: "name", label: "Name" },
      { key: "age", label: "Age" },
    ];

    const csv = toCSV(rows, columns);
    const lines = csv.split("\n");

    expect(lines[0]).toBe('"Name","Age"');
    expect(lines[1]).toBe('"Alice","30"');
    expect(lines[2]).toBe('"Bob","25"');
  });

  it("escapes double quotes in values", () => {
    const rows = [{ text: 'He said "hello"' }];
    const columns = [{ key: "text", label: "Text" }];

    const csv = toCSV(rows, columns);
    expect(csv).toContain('"He said ""hello"""');
  });

  it("handles null and undefined values", () => {
    const rows = [{ a: null, b: undefined }];
    const columns = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ];

    const csv = toCSV(rows, columns);
    const lines = csv.split("\n");
    expect(lines[1]).toBe('"",""');
  });

  it("returns header only for empty rows", () => {
    const columns = [
      { key: "x", label: "X" },
      { key: "y", label: "Y" },
    ];

    const csv = toCSV([], columns);
    expect(csv).toBe('"X","Y"\n');
  });

  it("handles missing keys in rows", () => {
    const rows = [{ a: "present" }];
    const columns = [
      { key: "a", label: "Col A" },
      { key: "missing", label: "Col B" },
    ];

    const csv = toCSV(rows, columns);
    const lines = csv.split("\n");
    expect(lines[1]).toBe('"present",""');
  });
});
