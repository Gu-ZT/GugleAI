# GugleAI

English | [简体中文](README.md)

A desktop image generation client built with Tauri 2 + Vue 3, working with the OpenAI Images API (e.g. `gpt-image-2`) and compatible third-party relay services.

## Features

- **Multiple workspaces**: switch between image generation, text chat, and the infinite canvas from a compact left navigation rail; each workspace is now a separate Vue Router page
- **Custom connections**: the previous sidebar controls now live on a dedicated settings page; save API endpoints and API keys together as connection profiles, switch them from one dropdown, and add or edit each connection's available model list in a separate modal; keys only show redacted previews; `/v1` is appended automatically when an endpoint omits it
- **Text chat**: hold continuous text conversations through `/chat/completions`; text model IDs can be entered and saved as options while reusing the active API connection and system proxy
- **Infinite canvas**: pan and zoom freely while each node selects its own API connection and one of that connection's models; text generation creates a connected text child, while uploaded or generated image nodes are reference-only inputs that can feed a new empty image node and produce multiple image children
- **Paste-to-configure**: press Ctrl+V to add and switch to an imported connection, supporting newapi channel JSON (`{"_type":"newapi_channel_conn",...}`) and Codex CLI `config.toml` (extracts `base_url`)
- **Text to image**: generate images from a prompt via `/images/generations`
- **Reference images**: attach any number of reference images via file picker, drag & drop, or clipboard paste
- **API mode**: Auto / Images API / Chat API; in Auto mode, multiple reference images are routed through `/chat/completions`, working around relays whose edits endpoint only accepts a single image
- **Image generation settings**: API mode, dimensions, output count, and request retries are grouped on the Image Generation page; retry status codes support persistent custom options and multi-selection
- **Generation control**: stop the current task while generating, cancelling the API request, retry delay and result downloads
- **Diagnostic logs**: record generation task IDs, request stages, durations, body sizes, proxy state and redacted error details to help diagnose timeouts and transport failures
- **Generation options**: image size (1024×1024 / landscape / portrait / auto) and count
- **Preview history**: generated images and prompts are appended to the preview area and restored after restart; double-click an image to enlarge it, or right-click to copy the image or its prompt, use it as a reference, save it, or delete it, or clear the entire preview
- **Save results**: handles `b64_json`, image URLs (including relative paths) and base64 embedded in chat responses; one-click save to disk

## Download

Grab the installer for your platform from the [Releases](../../releases) page. Windows (x86 / x86_64 / arm64), Linux (x86_64 / arm64) and macOS (Intel / Apple Silicon) are supported.

## Development

Prerequisites: [Node.js 20.19+](https://nodejs.org/), [pnpm](https://pnpm.io/), [Rust](https://www.rust-lang.org/).

The frontend uses Vue Router hash history for the `/image`, `/chat`, `/canvas`, and `/settings` pages, with page components under `src/views/`. Connection editing and preview overlays live under `src/components/modals/`. Arco Design components are resolved on demand through `unplugin-vue-components`. Shared logic lives in `src/api/index.ts`, `src/chat/index.ts`, `src/canvas/index.ts`, and `src/router/index.ts`, with class-based API connection, chat session, and canvas graph abstractions. All network requests still pass through the Tauri HTTP `fetch` wrapper in `src/App.vue`.

```bash
# Install dependencies
pnpm install

# Development mode
pnpm tauri dev

# Build installers
pnpm tauri build
```

## Usage

1. Use the left navigation icons to switch between **Image Generation**, **Chat**, and **Infinite Canvas**; open **Settings** at the bottom left to configure endpoints, keys, and available models on its own page
2. On Image Generation, enter a prompt, add optional references, and configure API mode, dimensions, output count, and retries; use Chat for continuous text conversations
3. In Infinite Canvas, select a connection and model per node; text generation creates a new text child, and image-bearing nodes must be connected as references to a new empty image node before generation
4. Image previews remain available; double-click to enlarge, or right-click to copy the image or prompt, use it as a reference, save it, delete it, or clear the full preview history

## License

This project is licensed under the [GNU Lesser General Public License v3.0](LICENSE).
