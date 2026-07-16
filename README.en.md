# GugleAI

English | [简体中文](README.md)

A desktop image generation client built with Tauri 2 + Vue 3, working with the OpenAI Images API (e.g. `gpt-image-2`) and compatible third-party relay services.

## Features

- **Custom connection**: save API endpoints and API keys together as connection profiles, switch them from one dropdown, and add profiles in a modal; keys only show redacted previews; model IDs remain independently selectable and extensible; `/v1` is appended automatically when an endpoint omits it
- **Paste-to-configure**: press Ctrl+V to add and switch to an imported connection, supporting newapi channel JSON (`{"_type":"newapi_channel_conn",...}`) and Codex CLI `config.toml` (extracts `base_url`)
- **Text to image**: generate images from a prompt via `/images/generations`
- **Reference images**: attach any number of reference images via file picker, drag & drop, or clipboard paste
- **API mode**: Auto / Images API / Chat API; in Auto mode, multiple reference images are routed through `/chat/completions`, working around relays whose edits endpoint only accepts a single image
- **Request retries**: optionally retry generation requests for multiple HTTP status codes selected from a dropdown, with persistent custom options and configurable retry counts
- **Generation control**: stop the current task while generating, cancelling the API request, retry delay and result downloads
- **Diagnostic logs**: record generation task IDs, request stages, durations, body sizes, proxy state and redacted error details to help diagnose timeouts and transport failures
- **Generation options**: image size (1024×1024 / landscape / portrait / auto) and count
- **Preview history**: generated images and prompts are appended to the preview area and restored after restart; right-click an image to copy its prompt, use it as a reference, save it, or delete it, or clear the entire preview
- **Save results**: handles `b64_json`, image URLs (including relative paths) and base64 embedded in chat responses; one-click save to disk

## Download

Grab the installer for your platform from the [Releases](../../releases) page. Windows (x86 / x86_64 / arm64), Linux (x86_64 / arm64) and macOS (Intel / Apple Silicon) are supported.

## Development

Prerequisites: [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/), [Rust](https://www.rust-lang.org/).

```bash
# Install dependencies
pnpm install

# Development mode
pnpm tauri dev

# Build installers
pnpm tauri build
```

## Usage

1. Switch paired endpoints and keys from the **API Connection** dropdown, or add one in the modal; model IDs remain independently selectable, and connection configs can also be pasted directly
2. Enter a prompt and optionally add reference images (file picker / drag onto the plus button / Ctrl+V a screenshot)
3. Click **Generate** (or Ctrl+Enter); use **Stop** to cancel the active task; previews remain available, and you can right-click an image to copy its prompt, use it as a reference, save it, or delete it, or clear the full preview history

## License

This project is licensed under the [GNU Lesser General Public License v3.0](LICENSE).
