#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const skillsRoot = path.join(repoRoot, "skills");
const installMetadataFile = ".agent-skill-install.json";

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
  skills install <skill-or-source> [--target codex|claude|agents|all] [--dir <path>] [--ref <git-ref>] [--force]
  skills update <installed-skill> [--target codex|claude|agents|all] [--dir <path>] [--source <skill-or-source>] [--ref <git-ref>]

Local examples:
  skills list
  skills install convex-streaming-agents --target codex
  skills install hyper-ui-skills --target all

GitHub examples:
  skills install hypersocialinc/agent-skills/convex-streaming-agents --target claude
  skills install https://github.com/hypersocialinc/agent-skills/tree/main/skills/convex-streaming-agents --dir ./tmp/skills

Update examples:
  skills update convex-streaming-agents --target codex
  skills update convex-streaming-agents --dir ./tmp/skills
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

function readArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function resolveTarget(args) {
  const targetValue = readArgValue(args, "--target");
  const dirValue = readArgValue(args, "--dir");
  if (dirValue) {
    return { kind: "custom", dirs: [path.resolve(process.cwd(), dirValue)] };
  }
  if (!targetValue) {
    return { kind: "preset", dirs: [TARGETS.codex] };
  }
  if (targetValue === "all") {
    return { kind: "preset", dirs: Object.values(TARGETS) };
  }
  if (!TARGETS[targetValue]) {
    throw new Error(`Unknown target: ${targetValue}`);
  }
  return { kind: "preset", dirs: [TARGETS[targetValue]] };
}

function isGitHubUrl(spec) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(spec);
}

function looksLikeGitHubRepoSpec(spec) {
  if (spec.includes("://")) return false;
  const parts = spec.split("/").filter(Boolean);
  return parts.length >= 3;
}

function parseGitHubUrl(spec) {
  const url = new URL(spec);
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 4 || parts[2] !== "tree") {
    throw new Error(
      "GitHub URLs must look like https://github.com/<owner>/<repo>/tree/<ref>/<path>",
    );
  }
  const [owner, repo, , ref, ...skillPathParts] = parts;
  if (skillPathParts.length === 0) {
    throw new Error("GitHub tree URLs must include a skill path");
  }
  return { owner, repo, ref, skillPath: skillPathParts.join("/") };
}

function parseGitHubRepoSpec(spec) {
  const parts = spec.split("/").filter(Boolean);
  const [owner, repo, ...skillPathParts] = parts;
  return {
    owner,
    repo,
    skillPath: skillPathParts.join("/"),
  };
}

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function resolveClonedSkillDir(cloneRoot, skillPath) {
  const candidates = [];
  if (skillPath) {
    candidates.push(skillPath);
    if (!skillPath.startsWith("skills/")) {
      candidates.push(path.join("skills", skillPath));
    }
  }
  const uniqueCandidates = [...new Set(candidates)];
  for (const relativePath of uniqueCandidates) {
    const candidateDir = path.join(cloneRoot, relativePath);
    const skillFile = path.join(candidateDir, "SKILL.md");
    if (fs.existsSync(skillFile)) {
      return candidateDir;
    }
  }
  throw new Error(
    `Could not find SKILL.md for path "${skillPath}" in cloned repository`,
  );
}

function resolveInstallSource(spec, args) {
  const ref = readArgValue(args, "--ref");
  const localCanonicalDir = path.join(skillsRoot, spec);
  if (fs.existsSync(path.join(localCanonicalDir, "SKILL.md"))) {
    return {
      sourceType: "local",
      sourceDir: localCanonicalDir,
      installName: path.basename(localCanonicalDir),
      metadata: {
        sourceType: "local",
        spec,
      },
      cleanup() {},
    };
  }

  let parsed;
  if (isGitHubUrl(spec)) {
    parsed = parseGitHubUrl(spec);
  } else if (looksLikeGitHubRepoSpec(spec)) {
    parsed = parseGitHubRepoSpec(spec);
  } else {
    throw new Error(`Unknown skill source: ${spec}`);
  }

  const cloneDir = mkTempDir("agent-skills-");
  const remoteUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
  const cloneArgs = ["clone", "--depth", "1"];
  if (ref || parsed.ref) {
    cloneArgs.push("--branch", ref || parsed.ref);
  }
  cloneArgs.push(remoteUrl, cloneDir);
  runGit(cloneArgs, process.cwd());

  const sourceDir = resolveClonedSkillDir(cloneDir, parsed.skillPath);
  return {
    sourceType: "github",
    sourceDir,
    installName: path.basename(sourceDir),
    metadata: {
      sourceType: "github",
      spec,
      owner: parsed.owner,
      repo: parsed.repo,
      skillPath: parsed.skillPath,
      ref: ref || parsed.ref || null,
    },
    cleanup() {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    },
  };
}

function writeInstallMetadata(destinationDir, sourceMetadata) {
  const payload = {
    ...sourceMetadata,
    installedAt: new Date().toISOString(),
    installedFromRepo: "hypersocialinc/agent-skills",
  };
  fs.writeFileSync(
    path.join(destinationDir, installMetadataFile),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8",
  );
}

function installResolvedSource(resolvedSource, targetDir, force) {
  const destinationDir = path.join(targetDir, resolvedSource.installName);
  ensureDir(targetDir);
  if (fs.existsSync(destinationDir)) {
    if (!force) {
      throw new Error(
        `Destination already exists: ${destinationDir}. Re-run with --force to replace it.`,
      );
    }
    fs.rmSync(destinationDir, { recursive: true, force: true });
  }
  copyRecursive(resolvedSource.sourceDir, destinationDir);
  writeInstallMetadata(destinationDir, resolvedSource.metadata);
  return destinationDir;
}

function loadInstalledSkillMetadata(skillDir) {
  const metadataPath = path.join(skillDir, installMetadataFile);
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
}

function resolveInstalledSkillForUpdate(spec, args) {
  const target = resolveTarget(args);
  const matches = [];
  for (const dir of target.dirs) {
    const skillDir = path.join(dir, spec);
    if (fs.existsSync(path.join(skillDir, "SKILL.md"))) {
      matches.push(skillDir);
    }
  }
  if (matches.length === 0) {
    throw new Error(`Installed skill not found for update: ${spec}`);
  }
  return matches;
}

function resolveUpdateSource(spec, installedDir, args) {
  const explicitSource = readArgValue(args, "--source");
  if (explicitSource) {
    return resolveInstallSource(explicitSource, args);
  }
  const metadata = loadInstalledSkillMetadata(installedDir);
  if (metadata?.spec) {
    const forwardedArgs = [...args];
    if (metadata.ref && !readArgValue(args, "--ref")) {
      forwardedArgs.push("--ref", metadata.ref);
    }
    return resolveInstallSource(metadata.spec, forwardedArgs);
  }
  return resolveInstallSource(spec, args);
}

function listSkills() {
  for (const skillDir of getSkillDirs()) {
    const meta = getSkillMetadata(skillDir);
    console.log(`${meta.name}\t${meta.dir}\t${meta.description}`);
  }
}

function listTargets() {
  for (const [name, dir] of Object.entries(TARGETS)) {
    console.log(`${name}\t${dir}`);
  }
}

function installCommand(spec, args) {
  const force = args.includes("--force");
  const target = resolveTarget(args);
  const resolvedSource = resolveInstallSource(spec, args);
  try {
    const installs = [];
    for (const dir of target.dirs) {
      installs.push(installResolvedSource(resolvedSource, dir, force));
    }
    for (const destination of installs) {
      console.log(`Installed ${resolvedSource.installName} -> ${destination}`);
    }
  } finally {
    resolvedSource.cleanup();
  }
}

function updateCommand(spec, args) {
  const force = true;
  const installedDirs = resolveInstalledSkillForUpdate(spec, args);
  for (const installedDir of installedDirs) {
    const targetDir = path.dirname(installedDir);
    const resolvedSource = resolveUpdateSource(spec, installedDir, args);
    try {
      const destination = installResolvedSource(resolvedSource, targetDir, force);
      console.log(`Updated ${path.basename(destination)} -> ${destination}`);
    } finally {
      resolvedSource.cleanup();
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "list") {
    listSkills();
    return;
  }

  if (command === "targets") {
    listTargets();
    return;
  }

  if (command === "install") {
    const spec = args[1];
    if (!spec) {
      throw new Error("install requires a skill name or source spec");
    }
    installCommand(spec, args.slice(2));
    return;
  }

  if (command === "update") {
    const spec = args[1];
    if (!spec) {
      throw new Error("update requires the installed skill directory name");
    }
    updateCommand(spec, args.slice(2));
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
