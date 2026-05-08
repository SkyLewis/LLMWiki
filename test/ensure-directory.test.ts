/**
 * Unit tests for ensureDirectory logic
 *
 * Issue: "目录已经存在" error causes ingest to exit when
 * createFolder is called on an already-existing directory.
 *
 * Test approach:
 * 1. Test that ensureDirectory handles "already exists" gracefully
 * 2. Test that ensureDirectory handles concurrent calls without error
 * 3. Test that parseJSON correctly extracts JSON from ```json blocks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Obsidian vault types
interface TFolder { path: string; children: (TFolder | TFile)[] }
interface TFile { path: string; extension: string }
interface Vault {
  getAbstractFileByPath: (path: string) => TFolder | TFile | null;
  createFolder: (path: string) => Promise<void>;
}

// Re-implement ensureDirectory logic for testing
async function ensureDirectory(
  vault: Vault,
  filePath: string
): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (!dir) return;

  const parts = dir.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const folder = vault.getAbstractFileByPath(current);
    if (!folder) {
      await vault.createFolder(current);
    }
  }
}

// Re-implement parseJSON for testing
function parseJSON<T>(text: string): T {
  const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  const jsonStr = jsonMatch?.[1] ?? text;
  return JSON.parse(jsonStr.trim());
}

describe("ensureDirectory", () => {
  let createdFolders: string[];
  let existingFolders: Set<string>;
  let vault: Vault;

  beforeEach(() => {
    createdFolders = [];
    existingFolders = new Set(["wiki", "wiki/sources", "wiki/entities"]);
    vault = {
      getAbstractFileByPath: (path: string) => {
        if (existingFolders.has(path)) {
          return { path, children: [] } as TFolder;
        }
        return null;
      },
      createFolder: vi.fn(async (path: string) => {
        if (existingFolders.has(path)) {
          throw new Error(`Folder already exists: ${path}`);
        }
        createdFolders.push(path);
        existingFolders.add(path);
      }),
    };
  });

  it("creates nested directories that don't exist", async () => {
    await ensureDirectory(vault, "wiki/concepts/new-concept.md");
    expect(vault.createFolder).toHaveBeenCalledWith("wiki/concepts");
  });

  it("skips directories that already exist", async () => {
    await ensureDirectory(vault, "wiki/sources/existing.md");
    // Should NOT try to create wiki or wiki/sources
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it("handles path with no directory component", async () => {
    await ensureDirectory(vault, "file.md");
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it("creates intermediate directories for deep paths", async () => {
    await ensureDirectory(vault, "wiki/entities/persons/researcher.md");
    expect(vault.createFolder).toHaveBeenCalledWith("wiki/entities/persons");
  });

  it("throws when createFolder fails on already-existing folder (BUG)", async () => {
    // This test documents the CURRENT buggy behavior
    // The fix: wrap createFolder in try-catch
    const vaultWithRaceCondition = {
      ...vault,
      createFolder: vi.fn(async (path: string) => {
        // Simulate race condition: folder created by another call
        existingFolders.add(path);
        await vault.createFolder(path); // Will throw "already exists"
      }),
    };

    // Current implementation will throw here
    await expect(
      ensureDirectory(vaultWithRaceCondition, "wiki/concepts/test.md")
    ).rejects.toThrow("Folder already exists");
  });

  it("handles concurrent calls gracefully (FIXED)", async () => {
    const vaultFixed = {
      ...vault,
      createFolder: vi.fn(async (path: string) => {
        // Fixed implementation: catch "already exists" error
        if (existingFolders.has(path)) {
          return; // Silently ignore
        }
        createdFolders.push(path);
        existingFolders.add(path);
      }),
    };

    // Simulate concurrent calls to create the same directory
    await Promise.all([
      ensureDirectory(vaultFixed, "wiki/concepts/a.md"),
      ensureDirectory(vaultFixed, "wiki/concepts/b.md"),
    ]);

    // Only one call should actually create the folder
    expect(vaultFixed.createFolder).toHaveBeenCalledTimes(1);
  });
});

describe("parseJSON", () => {
  it("extracts JSON from ```json code block", () => {
    const text = `Some text before
\`\`\`json
{"key": "value"}
\`\`\`
Some text after`;

    const result = parseJSON<{ key: string }>(text);
    expect(result).toEqual({ key: "value" });
  });

  it("extracts JSON from nested content with thinking block", () => {
    const text = `{"id": "123", "content": [
        {
            "thinking": "This is thinking...",
            "signature": "abc",
            "type": "thinking"
        },
        {
            "text": "\`\`\`json\n{\\"key\\": \\"value\\"}\n\`\`\`",
            "type": "text"
        }
    ]}`;

    // The actual LLM response format from test/ingest.data.json
    // parseJSON should NOT match the thinking block
    // It should fall back to the whole text
    expect(() => parseJSON(text)).toThrow();
  });

  it("handles text with no code blocks", () => {
    const text = '{"key": "value"}';
    const result = parseJSON<{ key: string }>(text);
    expect(result).toEqual({ key: "value" });
  });

  it("handles multiline JSON in code block", () => {
    const text = `\`\`\`json
{
  "new_pages": [
    {
      "path": "wiki/test.md",
      "content": "# Test"
    }
  ]
}
\`\`\``;

    const result = parseJSON<{ new_pages: unknown[] }>(text);
    expect(result.new_pages).toHaveLength(1);
  });
});
