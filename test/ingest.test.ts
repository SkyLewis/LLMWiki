import { describe, it, expect, vi } from "vitest";

// Mock Obsidian vault types
interface TFolder { path: string; children: (TFolder | TFile)[] }
interface TFile { path: string; extension: string }
interface Vault {
  getAbstractFileByPath: (path: string) => TFolder | TFile | null;
  createFolder: (path: string) => Promise<void>;
  create: (path: string, content: string) => Promise<TFile>;
  modify: (file: TFile, content: string) => Promise<void>;
  read: (file: TFile) => Promise<string>;
}

// Re-implement ensureDirectory for testing
async function ensureDirectory(vault: Vault, filePath: string): Promise<void> {
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

describe("Ingest Core Logic", () => {
  describe("ensureDirectory", () => {
    it("creates nested directories", async () => {
      const existingFolders = new Set<string>();
      const created: string[] = [];
      const vault: Vault = {
        getAbstractFileByPath: (path) => existingFolders.has(path) ? { path, children: [] } as TFolder : null,
        createFolder: async (path) => { created.push(path); existingFolders.add(path); },
        create: async () => { throw new Error("not implemented"); },
        modify: async () => { throw new Error("not implemented"); },
        read: async () => { throw new Error("not implemented"); },
      };

      await ensureDirectory(vault, "wiki/concepts/test.md");
      expect(created).toContain("wiki");
      expect(created).toContain("wiki/concepts");
    });

    it("skips existing directories", async () => {
      const existingFolders = new Set(["wiki", "wiki/concepts"]);
      const created: string[] = [];
      const vault: Vault = {
        getAbstractFileByPath: (path) => existingFolders.has(path) ? { path, children: [] } as TFolder : null,
        createFolder: async (path) => { created.push(path); existingFolders.add(path); },
        create: async () => { throw new Error("not implemented"); },
        modify: async () => { throw new Error("not implemented"); },
        read: async () => { throw new Error("not implemented"); },
      };

      await ensureDirectory(vault, "wiki/concepts/deep/file.md");
      expect(created).not.toContain("wiki");
      expect(created).not.toContain("wiki/concepts");
      expect(created).toContain("wiki/concepts/deep");
    });
  });

  describe("parseJSON", () => {
    function parseJSON(text: string) {
      const jsonMatch = text.match(/\`\`\`json\s*\n([\s\S]*?)\n\s*\`\`\`/);
      const jsonStr = jsonMatch?.[1] ?? text;
      return JSON.parse(jsonStr.trim());
    }

    it("extracts JSON from code block", () => {
      const text = `some thinking\n\`\`\`json\n{"key":"value"}\n\`\`\``;
      const result = parseJSON(text);
      expect(result).toEqual({ key: "value" });
    });

    it("falls back to raw text if no code block", () => {
      const text = `{"key":"value"}`;
      const result = parseJSON(text);
      expect(result).toEqual({ key: "value" });
    });
  });
});
