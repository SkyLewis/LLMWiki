import { App, TFile, TFolder, Vault } from "obsidian";

export interface TransactionManifest {
	id: string;
	createdAt: string;
	files: { path: string; originalContent: string | null }[];
	completedOps: string[];
}

export class Transaction {
	private app: App;
	private txDir: string;
	private manifest: TransactionManifest;
	private committed = false;
	private rolledBack = false;

	private constructor(app: App, txDir: string, manifest: TransactionManifest) {
		this.app = app;
		this.txDir = txDir;
		this.manifest = manifest;
	}

	static async begin(app: App, llmWikiDir: string, filePaths: string[]): Promise<Transaction> {
		try {
			const id = crypto.randomUUID();
			const txDir = `${llmWikiDir}/tx/${id}`;
			console.log(`[Transaction] begin: id=${id}, llmWikiDir=${llmWikiDir}, fileCount=${filePaths.length}`);

			const safeCreateFolder = async (path: string, label: string) => {
				try {
					await app.vault.createFolder(path);
					console.log(`[Transaction] Created: ${label} (${path})`);
				} catch (e) {
					if (e.message.includes("already exists")) {
						console.log(`[Transaction] Already exists (skip): ${label} (${path})`);
					} else {
						throw e;
					}
				}
			};

			// Ensure tx directory exists
			const folder = app.vault.getAbstractFileByPath(llmWikiDir);
			if (!folder) {
				await safeCreateFolder(llmWikiDir, "llmWikiDir");
			}
			const txFolder = app.vault.getAbstractFileByPath(`${llmWikiDir}/tx`);
			if (!txFolder) {
				await safeCreateFolder(`${llmWikiDir}/tx`, "tx folder");
			}
			await safeCreateFolder(txDir, "txDir");

			// Snapshot all files
			const files: TransactionManifest["files"] = [];
			for (const path of filePaths) {
				const file = app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const content = await app.vault.read(file);
					files.push({ path, originalContent: content });
				} else {
					files.push({ path, originalContent: null }); // file doesn't exist yet
				}
			}

			const manifest: TransactionManifest = {
				id,
				createdAt: new Date().toISOString(),
				files,
				completedOps: [],
			};

			// Write manifest
			console.log(`[Transaction] Writing manifest: ${txDir}/tx-manifest.json`);
			await app.vault.create(
				`${txDir}/tx-manifest.json`,
				JSON.stringify(manifest, null, 2)
			);
			console.log(`[Transaction] begin SUCCESS: ${id}`);

			return new Transaction(app, txDir, manifest);
		} catch (e) {
			console.error(`[Transaction] begin ERROR: ${e.message}`);
			throw e;
		}
	}

	getId(): string {
		return this.manifest.id;
	}

	/**
	 * Record that an operation completed (for partial recovery)
	 */
	async recordOp(opName: string): Promise<void> {
		this.manifest.completedOps.push(opName);
		await this.updateManifest();
	}

	/**
	 * Commit: delete the snapshot (all writes succeeded)
	 */
	async commit(): Promise<void> {
		if (this.committed || this.rolledBack) return;
		this.committed = true;

		// Delete the tx directory
		const folder = this.app.vault.getAbstractFileByPath(this.txDir);
		if (folder instanceof TFolder) {
			await this.app.vault.delete(folder, true);
		}
	}

	/**
	 * Rollback: restore all files to their pre-transaction state
	 */
	async rollback(): Promise<void> {
		if (this.committed || this.rolledBack) return;
		this.rolledBack = true;

		for (const fileEntry of this.manifest.files) {
			const existing = this.app.vault.getAbstractFileByPath(fileEntry.path);

			if (fileEntry.originalContent === null) {
				// File was created by this transaction — delete it
				if (existing instanceof TFile) {
					await this.app.vault.delete(existing);
				}
			} else {
				// File was modified — restore original
				if (existing instanceof TFile) {
					await this.app.vault.modify(existing, fileEntry.originalContent);
				} else {
					// File was deleted during transaction — recreate it
					await this.app.vault.create(fileEntry.path, fileEntry.originalContent);
				}
			}
		}

		// Delete the tx directory
		const folder = this.app.vault.getAbstractFileByPath(this.txDir);
		if (folder instanceof TFolder) {
			await this.app.vault.delete(folder, true);
		}
	}

	/**
	 * Check for orphaned transactions on plugin load and offer recovery
	 */
	static async recoverOrphaned(app: App, llmWikiDir: string): Promise<TransactionManifest[]> {
		const txBase = `${llmWikiDir}/tx`;
		const folder = app.vault.getAbstractFileByPath(txBase);
		if (!(folder instanceof TFolder)) return [];

		const orphans: TransactionManifest[] = [];

		for (const child of folder.children) {
			if (!(child instanceof TFolder)) continue;

			const manifestFile = app.vault.getAbstractFileByPath(`${child.path}/tx-manifest.json`);
			if (manifestFile instanceof TFile) {
				try {
					const content = await app.vault.read(manifestFile);
					const manifest = JSON.parse(content) as TransactionManifest;
					orphans.push(manifest);
				} catch {
					// Corrupt manifest — clean up
					await app.vault.delete(child, true);
				}
			}
		}

		return orphans;
	}

	/**
	 * Rollback a specific orphaned transaction
	 */
	static async rollbackOrphan(app: App, llmWikiDir: string, manifest: TransactionManifest): Promise<void> {
		const txDir = `${llmWikiDir}/tx/${manifest.id}`;

		for (const fileEntry of manifest.files) {
			const existing = app.vault.getAbstractFileByPath(fileEntry.path);

			if (fileEntry.originalContent === null) {
				if (existing instanceof TFile) {
					await app.vault.delete(existing);
				}
			} else {
				if (existing instanceof TFile) {
					await app.vault.modify(existing, fileEntry.originalContent);
				} else {
					await app.vault.create(fileEntry.path, fileEntry.originalContent);
				}
			}
		}

		// Clean up tx directory
		const folder = app.vault.getAbstractFileByPath(txDir);
		if (folder instanceof TFolder) {
			await app.vault.delete(folder, true);
		}
	}

	/**
	 * Clean up a specific orphaned transaction without rollback (accept the partial state)
	 */
	static async acceptPartial(app: App, llmWikiDir: string, txId: string): Promise<void> {
		const txDir = `${llmWikiDir}/tx/${txId}`;
		const folder = app.vault.getAbstractFileByPath(txDir);
		if (folder instanceof TFolder) {
			await app.vault.delete(folder, true);
		}
	}

	private async updateManifest(): Promise<void> {
		const manifestFile = this.app.vault.getAbstractFileByPath(`${this.txDir}/tx-manifest.json`);
		if (manifestFile instanceof TFile) {
			await this.app.vault.modify(
				manifestFile,
				JSON.stringify(this.manifest, null, 2)
			);
		}
	}
}
