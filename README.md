# Claude Provider CLI

Small macOS-focused CLI for switching Claude Code between Anthropic-compatible providers without leaving secrets in shell history or dotfiles.

## What it does

- Stores provider metadata in `~/.config/claude-provider/config.json`
- Stores API keys in the macOS Keychain via the `security` command
- Switches the active provider with `claude-provider use <provider>`
- Launches Claude Code with the selected provider using `claude-provider run`
- Prints shell exports with `claude-provider env` when you want to `eval` them

## Built-in providers

- `default`: normal Claude Code behavior
- `kimi`: Moonshot Kimi Coding Plan (`api.kimi.com/coding`, model routed to `kimi-for-coding`)
- `glm`: Zhipu AI endpoint with `glm-5.1`

## Quick start

```bash
cd /Users/chris/ai_workspace/ai_consultant/claude-provider-cli
chmod +x ./bin/claude-provider.js
./bin/claude-provider.js key set kimi
./bin/claude-provider.js use kimi
./bin/claude-provider.js run -- --help
```

If you want to install it on your `PATH`, you can use:

```bash
npm link
```

Then the command becomes:

```bash
claude-provider list
claude-provider current
claude-provider run -- -p "summarize this repo"
ccp kimi -- -p "summarize this repo"
```

## Easier commands

You can use the short alias `ccp` instead of `claude-provider`.

Examples:

```bash
ccp ls
ccp status
ccp set kimi
ccp run -- -p "review this file"
ccp kimi -- -p "review this file"
ccp --team-agents ./agents/team.json -- -p "review this file"
```

Shortcuts:

- `ccp ls` = `claude-provider list`
- `ccp status` = `claude-provider current`
- `ccp set kimi` = `claude-provider use kimi`
- `ccp kimi -- ...` = run `claude` immediately with the `kimi` provider
- `ccp shell` = `claude-provider env`

## Team Agents

You can load a Claude custom agents JSON file without manually inlining JSON on the command line.

Examples:

```bash
ccp glm --team-agents ./agents/team.json
ccp --team-agents ./agents/team.json -- -p "Review this repo"
claude-provider run glm --team-agents ./agents/team.json -- -p "Review this repo"
ccp team init
ccp team show-default
```

This reads the JSON file and passes it to Claude as `--agents`.

If you want a starter config, the CLI can generate one for you:

```bash
ccp team init
ccp team init ./agents/team.json
claude-provider team show-default
ccp team run glm --task "review this repo"
```

Your team file should be a JSON object, for example:

```json
{
  "orchestrator": {
    "description": "Coordinates the overall workflow",
    "prompt": "You are the orchestrator..."
  },
  "planner": {
    "description": "Breaks work into steps",
    "prompt": "You create concise execution plans."
  },
  "worker": {
    "description": "Executes one concrete task",
    "prompt": "You are a worker..."
  },
  "reviewer": {
    "description": "Reviews outputs before finalizing",
    "prompt": "You are the reviewer..."
  }
}
```

`ccp team run` is the real multi-process mode. It launches separate Claude CLI calls for:

- `planner`
- `worker` for each planned subtask
- `reviewer`
- `orchestrator`

Artifacts are saved under:

```bash
~/.config/claude-provider/team-runs/
```

## Common workflows

Switch the default provider used by the helper:

```bash
claude-provider use glm
claude-provider run
```

Emit shell exports for the active provider:

```bash
eval "$(claude-provider env)"
eval "$(ccp shell)"
```

Store or replace a key in Keychain:

```bash
claude-provider key set kimi
claude-provider key set glm --value "your-api-key"
```

Check whether a key exists:

```bash
claude-provider key test kimi
```

## Custom providers

You can add your own Anthropic-compatible provider:

```bash
claude-provider add my-provider \
  --base-url https://example.com/anthropic \
  --model my-model \
  --display-name "My Provider"
```

Then save its secret and use it:

```bash
claude-provider key set my-provider
claude-provider use my-provider
claude-provider run
```

## Notes

- This CLI does not overwrite your existing `claude` binary.
- The `default` provider clears all override environment variables.
- On non-macOS systems, Keychain operations will fail because they rely on the built-in `security` command.

## Using Hooks Only With `ccp`

When Claude is launched through `ccp`, it gets extra environment variables that plain `claude` and `claude-provider` do not receive:

- `CCP_WRAPPED=1`
- `CCP_PROVIDER=glm` or `kimi` or `default`
- `CCP_PROVIDER_KIND=default` or `compatible`
- `CCP_PROVIDER_NAME`
- `CCP_PROVIDER_BASE_URL`
- `CCP_PROVIDER_MODEL`

That means your hook scripts can branch on `CCP_WRAPPED` and only run special logic for `ccp`.

Example shell check inside a hook script:

```bash
if [ "${CCP_WRAPPED:-}" = "1" ]; then
  echo "Running under ccp with provider: ${CCP_PROVIDER}"
fi
```

Example for GLM-only behavior:

```bash
if [ "${CCP_PROVIDER:-}" = "glm" ]; then
  echo "Apply GLM-specific hook behavior here"
fi
```

## Always-On Tracing For `ccp`

`ccp` now always records prompt/result traces after each Claude run by reading Claude's own session JSONL files.

Trace file:

```bash
~/.config/claude-provider/traces.jsonl
```

Each JSONL record includes:

- timestamp
- cwd
- sessionId
- provider details
- prompt
- final assistant response
- model
- claude args

Important:

- Tracing is only enabled when you launch Claude through `ccp`
- Plain `claude` runs are not traced by this wrapper
- The trace file may contain sensitive prompts and responses
