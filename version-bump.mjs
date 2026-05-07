import { readFileSync, writeFileSync } from "fs";

const newVersion = process.argv[2];
if (!newVersion) {
	console.error("Usage: node version-bump.mjs <version>");
	process.exit(1);
}

// Update package.json
const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");

// Update manifest.json
const manifestPath = "manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = newVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

// Update versions.json
const versionsPath = "versions.json";
const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[newVersion] = manifest.minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, "\t") + "\n");

console.log(`Version bumped to ${newVersion}`);
