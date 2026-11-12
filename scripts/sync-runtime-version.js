const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const check = process.argv.includes("--check");
const version = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).runtimeVersion;

if (typeof version !== "string") {
  console.error('app.json "runtimeVersion" must be a plain string like "1.0.1"');
  process.exit(1);
}

function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "Pods" || e.name === "build") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
    else if (e.name === name) return p;
  }
  return null;
}

const targets = [
  {
    file: path.join(root, "android/app/src/main/res/values/strings.xml"),
    re: /(<string name="expo_runtime_version">)[^<]*(<\/string>)/,
  },
  {
    file: findFile(path.join(root, "ios"), "Expo.plist"),
    re: /(<key>EXPO_RUNTIME_VERSION<\/key>\s*<string>)[^<]*(<\/string>)/,
  },
];

let mismatch = false;
for (const { file, re } of targets) {
  if (!file || !fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (!re.test(text)) continue;
  const next = text.replace(re, `$1${version}$2`);
  if (next === text) continue;
  if (check) {
    console.error(`MISMATCH: ${path.relative(root, file)} is not ${version}`);
    mismatch = true;
  } else {
    fs.writeFileSync(file, next);
    console.log(`Updated ${path.relative(root, file)} -> ${version}`);
  }
}
if (mismatch) process.exit(1);