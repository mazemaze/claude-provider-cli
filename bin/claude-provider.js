#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const BUILTIN_PROVIDERS = {
  default: {
    kind: "default",
    displayName: "Claude Default",
    description: "Use Claude Code with its normal login and default provider settings."
  },
  kimi: {
    kind: "compatible",
    displayName: "Kimi K2.5",
    description: "Moonshot AI via Anthropic-compatible endpoint.",
    baseUrl: "https://api.moonshot.ai/anthropic",
    providerModel: "kimi-k2.5",
    anthropicModel: "sonnet",
    smallFastModel: "haiku"
  },
  glm: {
    kind: "compatible",
    displayName: "GLM 5.1",
    description: "Zhipu AI via Anthropic-compatible endpoint.",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    providerModel: "glm-5.1",
    anthropicModel: "sonnet",
    smallFastModel: "haiku"
  }
};

const KEYCHAIN_SERVICE_PREFIX = "claude-provider";
const CURRENT_CONFIG_VERSION = 1;
const COMMON_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION"
];

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";
  const config = loadConfig();
  const provider = getProviderIfExists(command, config);

  try {
    if (provider) {
      cmdRun([command, ...args.slice(1)], config);
      return;
    }

    switch (command) {
      case "help":
      case "-h":
      case "--help":
        printUsage();
        return;
      case "list":
      case "ls":
        cmdList();
        return;
      case "current":
      case "status":
        cmdCurrent();
        return;
      case "use":
      case "set":
      case "switch":
        cmdUse(args.slice(1));
        return;
      case "env":
      case "shell":
        cmdEnv(args.slice(1));
        return;
      case "run":
        cmdRun(args.slice(1), config);
        return;
      case "key":
        cmdKey(args.slice(1));
        return;
      case "add":
        cmdAdd(args.slice(1));
        return;
      case "remove":
        cmdRemove(args.slice(1));
        return;
      default:
        fail(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error && error.message) {
      console.error(`claude-provider: ${error.message}`);
    } else {
      console.error("claude-provider: unexpected error");
    }
    process.exit(1);
  }
}

function printUsage() {
  console.log(`Claude Provider CLI

Usage:
  claude-provider list
  claude-provider current
  claude-provider use <provider>
  claude-provider env [provider]
  claude-provider run [provider] [-- <claude args...>]
  claude-provider key set <provider> [--value <secret>]
  claude-provider key delete <provider>
  claude-provider key test <provider>
  claude-provider add <name> --base-url <url> --model <model> [--display-name <name>] [--description <text>]
  claude-provider remove <name>
  ccp list
  ccp status
  ccp set <provider>
  ccp <provider> [-- <claude args...>]

Built-in providers:
  default  Claude Code default behavior
  kimi     Moonshot AI compatible endpoint using kimi-k2.5
  glm      Zhipu AI compatible endpoint using glm-5.1

Examples:
  claude-provider list
  claude-provider key set kimi
  claude-provider use kimi
  claude-provider run -- -p "review this file"
  eval "$(claude-provider env)"
  claude-provider add openrouter --base-url https://example.invalid/anthropic --model my-model
  ccp kimi -- -p "review this file"
`);
}

function cmdList() {
  const config = loadConfig();
  const current = config.currentProvider;
  const providers = getProviders(config);
  const names = Object.keys(providers).sort();

  for (const name of names) {
    const provider = providers[name];
    const marker = name === current ? "*" : " ";
    const builtInLabel = provider.builtIn ? "built-in" : "custom";
    console.log(`${marker} ${name}`);
    console.log(`  type: ${builtInLabel}`);
    if (provider.kind !== "default") {
      console.log(`  endpoint: ${provider.baseUrl}`);
      console.log(`  model: ${provider.providerModel}`);
    }
    console.log(`  name: ${provider.displayName}`);
    console.log(`  description: ${provider.description}`);
  }
}

function cmdCurrent() {
  const config = loadConfig();
  const provider = getProviderOrFail(config.currentProvider, config);
  console.log(config.currentProvider);
  console.log(`display: ${provider.displayName}`);
  if (provider.kind !== "default") {
    console.log(`endpoint: ${provider.baseUrl}`);
    console.log(`model: ${provider.providerModel}`);
  }
}

function cmdUse(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider use <provider>");
  }

  const config = loadConfig();
  getProviderOrFail(providerName, config);
  config.currentProvider = providerName;
  saveConfig(config);

  console.log(`active provider set to ${providerName}`);
  console.log(`run: claude-provider run -- <claude args>`);
  console.log(`or:  eval "$(claude-provider env)"`);
}

function cmdEnv(args) {
  const config = loadConfig();
  const providerName = args[0] || config.currentProvider;
  const provider = getProviderOrFail(providerName, config);
  const envMap = buildProviderEnv(providerName, provider);

  for (const key of COMMON_ENV_KEYS) {
    if (!envMap.has(key)) {
      console.log(`unset ${key}`);
    }
  }

  for (const [key, value] of envMap.entries()) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}

function cmdRun(args, existingConfig) {
  let providerName = null;
  let claudeArgs = [];

  if (args.length === 0) {
    providerName = (existingConfig || loadConfig()).currentProvider;
  } else if (args[0] === "--") {
    providerName = (existingConfig || loadConfig()).currentProvider;
    claudeArgs = args.slice(1);
  } else {
    providerName = args[0];
    claudeArgs = args[1] === "--" ? args.slice(2) : args.slice(1);
  }

  const config = existingConfig || loadConfig();
  const provider = getProviderOrFail(providerName, config);
  const envEntries = Object.fromEntries(buildProviderEnv(providerName, provider).entries());
  const childEnv = { ...process.env, ...envEntries };

  for (const key of COMMON_ENV_KEYS) {
    if (!(key in envEntries)) {
      delete childEnv[key];
    }
  }

  const result = spawnSync("claude", claudeArgs, {
    stdio: "inherit",
    env: childEnv
  });

  if (result.error) {
    fail(`failed to run claude: ${result.error.message}`);
  }

  process.exit(result.status === null ? 1 : result.status);
}

function cmdKey(args) {
  const action = args[0];

  switch (action) {
    case "set":
      cmdKeySet(args.slice(1));
      return;
    case "delete":
      cmdKeyDelete(args.slice(1));
      return;
    case "test":
      cmdKeyTest(args.slice(1));
      return;
    default:
      fail("usage: claude-provider key <set|delete|test> <provider>");
  }
}

async function readSecretPrompt(promptText) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stderr = process.stderr;

    if (!stdin.isTTY) {
      reject(new Error("secret prompt requires an interactive terminal or --value"));
      return;
    }

    let value = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
      stdin.pause();
    };

    const onData = (chunk) => {
      const char = String(chunk);

      if (char === "\u0003") {
        cleanup();
        stderr.write("\n");
        reject(new Error("aborted"));
        return;
      }

      if (char === "\r" || char === "\n") {
        cleanup();
        stderr.write("\n");
        resolve(value);
        return;
      }

      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      if (char >= " ") {
        value += char;
      }
    };

    stderr.write(promptText);
    stdin.setEncoding("utf8");
    stdin.resume();
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.on("data", onData);
  });
}

async function cmdKeySetAsync(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider key set <provider> [--value <secret>]");
  }

  const config = loadConfig();
  const provider = getProviderOrFail(providerName, config);
  if (provider.kind === "default") {
    fail('the "default" provider does not use a stored API key');
  }

  const options = parseFlags(args.slice(1));
  let secret = options.value;
  if (!secret) {
    secret = await readSecretPrompt(`API key for ${providerName}: `);
  }

  if (!secret) {
    fail("secret cannot be empty");
  }

  setKeychainSecret(providerName, secret);
  console.log(`stored API key for ${providerName} in macOS Keychain`);
}

function cmdKeySet(args) {
  cmdKeySetAsync(args).catch((error) => {
    console.error(`claude-provider: ${error.message}`);
    process.exit(1);
  });
}

function cmdKeyDelete(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider key delete <provider>");
  }

  const config = loadConfig();
  const provider = getProviderOrFail(providerName, config);
  if (provider.kind === "default") {
    fail('the "default" provider does not use a stored API key');
  }

  deleteKeychainSecret(providerName);
  console.log(`deleted API key for ${providerName} from macOS Keychain`);
}

function cmdKeyTest(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider key test <provider>");
  }

  const config = loadConfig();
  const provider = getProviderOrFail(providerName, config);
  if (provider.kind === "default") {
    console.log("default provider does not require a stored API key");
    return;
  }

  const secret = getKeychainSecret(providerName);
  if (!secret) {
    fail(`no API key found in macOS Keychain for ${providerName}`);
  }

  console.log(`API key found for ${providerName}`);
}

function cmdAdd(args) {
  const name = args[0];
  if (!name) {
    fail("usage: claude-provider add <name> --base-url <url> --model <model>");
  }

  validateProviderName(name);
  if (BUILTIN_PROVIDERS[name]) {
    fail(`"${name}" is a built-in provider and cannot be overwritten`);
  }

  const flags = parseFlags(args.slice(1));
  const baseUrl = flags["base-url"];
  const model = flags.model;
  const displayName = flags["display-name"] || name;
  const description = flags.description || "Custom Anthropic-compatible provider.";

  if (!baseUrl || !model) {
    fail("usage: claude-provider add <name> --base-url <url> --model <model> [--display-name <name>] [--description <text>]");
  }

  const config = loadConfig();
  config.customProviders[name] = {
    kind: "compatible",
    displayName,
    description,
    baseUrl,
    providerModel: model,
    anthropicModel: flags["anthropic-model"] || "sonnet",
    smallFastModel: flags["small-fast-model"] || "haiku"
  };
  saveConfig(config);

  console.log(`added custom provider ${name}`);
}

function cmdRemove(args) {
  const name = args[0];
  if (!name) {
    fail("usage: claude-provider remove <name>");
  }

  if (BUILTIN_PROVIDERS[name]) {
    fail(`cannot remove built-in provider "${name}"`);
  }

  const config = loadConfig();
  if (!config.customProviders[name]) {
    fail(`provider "${name}" does not exist`);
  }

  delete config.customProviders[name];
  if (config.currentProvider === name) {
    config.currentProvider = "default";
  }
  saveConfig(config);

  try {
    deleteKeychainSecret(name);
  } catch (error) {
    if (!String(error.message).includes("could not be found")) {
      throw error;
    }
  }

  console.log(`removed provider ${name}`);
}

function getConfigHome() {
  return process.env.CLAUDE_PROVIDER_HOME || path.join(os.homedir(), ".config", "claude-provider");
}

function getConfigPath() {
  return path.join(getConfigHome(), "config.json");
}

function ensureConfigDir() {
  fs.mkdirSync(getConfigHome(), { recursive: true });
}

function defaultConfig() {
  return {
    version: CURRENT_CONFIG_VERSION,
    currentProvider: "default",
    customProviders: {}
  };
}

function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaultConfig();
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    version: parsed.version || CURRENT_CONFIG_VERSION,
    currentProvider: parsed.currentProvider || "default",
    customProviders: parsed.customProviders || {}
  };
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getProviders(config) {
  const providers = {};

  for (const [name, provider] of Object.entries(BUILTIN_PROVIDERS)) {
    providers[name] = {
      ...provider,
      builtIn: true
    };
  }

  for (const [name, provider] of Object.entries(config.customProviders || {})) {
    providers[name] = {
      ...provider,
      builtIn: false
    };
  }

  return providers;
}

function getProviderOrFail(name, config) {
  const providers = getProviders(config);
  const provider = providers[name];
  if (!provider) {
    fail(`unknown provider "${name}"`);
  }
  return provider;
}

function getProviderIfExists(name, config) {
  if (!name) {
    return null;
  }

  const providers = getProviders(config);
  return providers[name] || null;
}

function buildProviderEnv(providerName, provider) {
  const env = new Map();

  if (provider.kind === "default") {
    return env;
  }

  const secret = getKeychainSecret(providerName);
  if (!secret) {
    fail(`missing API key for ${providerName}. Run: claude-provider key set ${providerName}`);
  }

  env.set("ANTHROPIC_BASE_URL", provider.baseUrl);
  env.set("ANTHROPIC_AUTH_TOKEN", secret);
  env.set("ANTHROPIC_MODEL", provider.anthropicModel || "sonnet");
  env.set("ANTHROPIC_SMALL_FAST_MODEL", provider.smallFastModel || "haiku");
  env.set("ANTHROPIC_DEFAULT_OPUS_MODEL", provider.providerModel);
  env.set("ANTHROPIC_DEFAULT_SONNET_MODEL", provider.providerModel);
  env.set("ANTHROPIC_DEFAULT_HAIKU_MODEL", provider.providerModel);
  env.set("ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", provider.displayName);
  env.set("ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", provider.displayName);
  env.set("ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", provider.displayName);
  env.set("ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION", provider.description);
  env.set("ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION", provider.description);
  env.set("ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION", provider.description);
  return env;
}

function getKeychainService(providerName) {
  return `${KEYCHAIN_SERVICE_PREFIX}:${providerName}`;
}

function setKeychainSecret(providerName, secret) {
  execFileSync("security", [
    "add-generic-password",
    "-U",
    "-a",
    providerName,
    "-s",
    getKeychainService(providerName),
    "-w",
    secret
  ], { stdio: "pipe" });
}

function getKeychainSecret(providerName) {
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-a",
      providerName,
      "-s",
      getKeychainService(providerName),
      "-w"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return "";
  }
}

function deleteKeychainSecret(providerName) {
  execFileSync("security", [
    "delete-generic-password",
    "-a",
    providerName,
    "-s",
    getKeychainService(providerName)
  ], { stdio: "pipe" });
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for --${key}`);
    }
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function validateProviderName(name) {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    fail("provider names may only contain letters, numbers, dashes, and underscores");
  }
}

function fail(message) {
  throw new Error(message);
}

main();
