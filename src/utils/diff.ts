export interface DiffLine {
	type: "add" | "del" | "ctx";
	content: string;
	lineOld?: number;
	lineNew?: number;
}

export interface FileDiff {
	path: string;
	isNew: boolean;
	lines: DiffLine[];
	summary: { added: number; deleted: number };
}

export class DiffEngine {
	/**
	 * Compute a diff between two strings
	 */
	static compute(oldContent: string, newContent: string, filePath: string): FileDiff {
		const oldLines = oldContent.split("\n");
		const newLines = newContent.split("\n");

		const diff = DiffEngine.lcsDiff(oldLines, newLines);

		let added = 0;
		let deleted = 0;
		for (const line of diff) {
			if (line.type === "add") added++;
			if (line.type === "del") deleted++;
		}

		return {
			path: filePath,
			isNew: oldContent === "",
			lines: diff,
			summary: { added, deleted },
		};
	}

	/**
	 * LCS-based diff algorithm
	 */
	private static lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
		const m = oldLines.length;
		const n = newLines.length;

		// Build LCS table
		const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (oldLines[i - 1] === newLines[j - 1]) {
					dp[i][j] = dp[i - 1][j - 1] + 1;
				} else {
					dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
				}
			}
		}

		// Backtrack to produce diff
		const result: DiffLine[] = [];
		let i = m, j = n;

		const tempResult: DiffLine[] = [];
		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
				tempResult.push({ type: "ctx", content: oldLines[i - 1], lineOld: i, lineNew: j });
				i--;
				j--;
			} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
				tempResult.push({ type: "add", content: newLines[j - 1], lineNew: j });
				j--;
			} else {
				tempResult.push({ type: "del", content: oldLines[i - 1], lineOld: i });
				i--;
			}
		}

		// Reverse to get correct order
		return tempResult.reverse();
	}
}
