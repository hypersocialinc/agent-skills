#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const skillsRoot = path.join(repoRoot, "skills");

const TARGETS = {
  codex: path.join(os.homedir(), ".codex", "skills"),
  claude: path.join(os.homedir(), ".claude", "agents"),
  agents: path.join(os.homedir(), ".agents", "skills"),
};

function usage() {
  console.log(`skills

Usage:
  skills list
  skills targets
  skills install <skill> [--target codex|claude|agents|all] [--dir <path>] [--force]

Examples:
  skills list
  skills install convex-streaming-agents --target codex
  skills install hyper-ui-skills --target claude
  skills install convex-r2-media --dir ./tmp/skills
`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split("\n")) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!parts) continue;
    meta[parts[1]] = parts[2].replace(/^"(.*)"$/, "$1");
  }
  return meta;
}

function getSkillDirs() {
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function getSkillMetadata(skillDir) {
  const skillPath = path.join(skillsRoot, skillDir, "SKILL.md");
  const markdown = fs.readFileSync(skillPath, "utf8");
  const meta = parseFrontmatter(markdown);
  return {
    dir: skillDir,
    name: meta.name || skillDir,
    description: meta.description || "",
  };
}

function copyRecursive(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    ensureDir(destination);
    for (const name of fs.readdirSync(source)) {
      copyRecursive(path.join(source, name), path.join(destination, name));
    }
    return;
  }
  fs.copyFileSync(source, destination);
}

function installSkill(skillDir, targetDir, force) {
  const sourceDir = path.join(skillsRoot, skillDir);
  const destinationDir = path.join(targetDir, skillDir);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Unknown skill: ${skillDir}`);
  }
  ensureDir(targetDir);
  if (fs.existsSync(destinationDir)) {
    if (!force) {
      throw new Error(
        `Destination already exists: ${destinationDir}. Re-run with --force to replace it.`,
      );
    }
    fs.rmSync(destinationDir, { recursive: true, force: true });
  }
  copyRecursive(sourceDir, destinationDir);
  return destinationDir;
}

function resolveTarget(args) {
  const targetIndex = args.indexOf("--target");
  const dirIndex = args.indexOf("--dir");
  if (dirIndex !== -1) {
    const dirValue = args[dirIndex + 1];
    if (!dirValue) {
      throw new Error("--dir requires a path");
    }
    return { kind: "custom", dirs: [path.resolve(process.cwd(), dirValue)] };
  }
  if (targetIndex === -1) {
    return { kind: "preset", dirs: [TARGETS.codex] };
  }
  const targetValue = args[targetIndex + 1];
  if (!targetValue) {
    throw new Error("--target requires a value");
  }
  if (targetValue === "all") {
    return { kind: "preset", dirs: Object.values(TARGETS) };
  }
  if (!TARGETS[targetValue]) {
    throw new Error(`Unknown target: ${targetValue}`);
  }
  return { kind: "preset", dirs: [TARGETS[targetValue]] };
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "list") {
    for (const skillDir of getSkillDirs()) {
      const meta = getSkillMetadata(skillDir);
      console.log(`${meta.name}\t${meta.dir}\t${meta.description}`);
    }
    return;
  }

  if (command === "targets") {
    for (const [name, dir] of Object.entries(TARGETS)) {
      console.log(`${name}\t${dir}`);
    }
    return;
  }

  if (command === "install") {
    const skillName = args[1];
    if (!skillName) {
      throw new Error("install requires a skill name");
    }
    const force = args.includes("--force");
    const target = resolveTarget(args.slice(2));
    const installs = [];
    for (const dir of target.dirs) {
      installs.push(installSkill(skillName, dir, force));
    }
    for (const destination of installs) {
      console.log(`Installed ${skillName} -> ${destination}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
