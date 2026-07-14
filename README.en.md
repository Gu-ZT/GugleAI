# GugleAI

English | [简体中文](README.md)

A desktop image generation client built with Tauri 2 + Vue 3, working with the OpenAI Images API (e.g. `gpt-image-2`) and compatible third-party relay services.

## Features

- **Custom connection**: freely configure the API endpoint, API key and model ID, all persisted automatically; model IDs can be selected from a dropdown or saved as custom options; `/v1` is appended automatically when the endpoint omits it
- **Paste-to-configure**: press Ctrl+V to import connection settings, supporting newapi channel JSON (`{"_type":"newapi_channel_conn",...}`) and Codex CLI `config.toml` (extracts `base_url`)
- **Text to image**: generate images from a prompt via `/images/generations`
- **Reference images**: attach any number of reference images via file picker, drag & drop, or clipboard paste
- **API mode**: Auto / Images API / Chat API; in Auto mode, multiple reference images are routed through `/chat/completions`, working around relays whose edits endpoint only accepts a single image
- **Request retries**: optionally retry generation requests for multiple HTTP status codes selected from a dropdown, with persistent custom options and configurable retry counts
- **Generation options**: image size (1024×1024 / landscape / portrait / auto) and count
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

1. Fill in the API endpoint (e.g. `https://api.openai.com/v1` or a relay URL) and API key, then select a model ID from the dropdown or save a custom model — or simply paste a connection config
2. Enter a prompt and optionally add reference images (file picker / drag onto the plus button / Ctrl+V a screenshot)
3. Click **Generate** (or Ctrl+Enter), then click **Save** under any result to store it locally

## License

This project is licensed under the [GNU Lesser General Public License v3.0](LICENSE).
