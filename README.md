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
- `kimi`: Moonshot AI endpoint with `kimi-k2.5`
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
```

Shortcuts:

- `ccp ls` = `claude-provider list`
- `ccp status` = `claude-provider current`
- `ccp set kimi` = `claude-provider use kimi`
- `ccp kimi -- ...` = run `claude` immediately with the `kimi` provider
- `ccp shell` = `claude-provider env`

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
