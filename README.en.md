<div align="center">

<img src="public/icon.png" style="width: 256px; height: 256px" alt="Icon">

# GugleAI

English | [简体中文](README.md)

</div>

A desktop image generation client built with Tauri 2 + Vue 3, working with the OpenAI Images API (e.g. `gpt-image-2`) and compatible third-party relay services.

## Features

- **Multiple workspaces**: switch between image generation, text chat, and the infinite canvas from a compact left navigation rail; each workspace is now a separate Vue Router page
- **Providers and models**: add, name, and edit providers directly in the Model Settings detail pane, each with its own API endpoint, key, and model list; navigating with unsaved changes prompts you to save, discard, or keep editing; models support an ID, optional display name and description, image-model flag, and context length through a dedicated modal
- **Organized settings**: the Settings page has nested routes for Model Settings, General Settings, and full-size Logs; entering Settings from the main navigation always opens Model Settings, which adds a secondary provider sidebar
- **General settings and UI**: maintain the user name used by prompt variables and choose Light, Dark, or Follow System under General Settings; first launch creates a default name in the form `用户` plus four random digits; controls and colors use Arco Design throughout and update live through its theme tokens
- **Agent settings**: edit the Infinite Canvas prompt-generation system prompt, manage chat agents, and switch agents from the Chat composer; the editable default assistant includes current environment and user variables, and custom agents can be added or removed
- **Prompt variables**: agent system prompts support `{{date}}`, `{{time}}`, `{{datetime}}`, `{{system}}`, `{{arch}}`, `{{language}}`, `{{model_name}}`, and `{{username}}`, resolved from the current environment and the user name in General Settings immediately before each request
- **Text chat**: use `/chat/completions` across persistent multiple conversations with create, rename, delete, and per-message copy actions; assistant messages show the actual model, while first exchanges can generate titles asynchronously with a chosen model or title generation can be disabled
- **Grouped model selection**: Image Generation, Chat, conversation titles, and Infinite Canvas nodes select models grouped by provider, show the selected provider in a tag, and automatically use that provider's endpoint and key
- **Infinite canvas**: select or create a blank canvas from a library of portrait `1:√2` cards; right-click a card to rename it or delete it through a confirmation dialog; nodes, images, edges, and viewport are persisted per canvas and the editor has a back action; new canvases start at 60% zoom; manual solid edges and automatic dashed edges are visually distinct, and manual edges can be disconnected with a double-click; text generation creates an automatically connected text child; generation reads only directly connected upstream nodes, adding text nodes to the prompt and image nodes as references; each reference node stores one image and hides irrelevant model settings; node images provide right-click actions to copy prompts or images and save files
- **Paste-to-configure**: press Ctrl+V to add and switch to an imported connection, supporting newapi channel JSON (`{"_type":"newapi_channel_conn",...}`) and Codex CLI `config.toml` (extracts `base_url`)
- **Text to image**: generate images from a prompt via `/images/generations`
- **Reference images**: attach any number of reference images via file picker, drag & drop, or clipboard paste
- **API mode**: Auto / Images API / Chat API; in Auto mode, multiple reference images are routed through `/chat/completions`, working around relays whose edits endpoint only accepts a single image
- **Advanced image settings**: API mode and retries live in an Advanced section that is collapsed by default and must be opened manually; retry status codes support persistent custom options and multi-selection
- **Generation control**: stop the current task while generating, cancelling the API request, retry delay and result downloads
- **Diagnostic logs**: record generation task IDs, request stages, durations, body sizes, proxy state and redacted error details to help diagnose timeouts and transport failures; logs rotate at application start or when the active file exceeds 100 KB, while opening logs always opens the current `gugle-ai.log`; archives use the last modified time in the name `gugle-ai-YYYY-MM-dd-hh-mm-ss-ms.log`
- **Generation options**: model, image size, output count, and the generate action share one bottom parameter row that stays pinned when space allows; choose auto, a preset, or enter a custom width and height
- **Preview history**: a dedicated scrolling area at the top fills the remaining space while keeping at least one compact thumbnail row visible; short windows release the bottom row and scroll the whole page. Generated images and prompts are restored after restart, with double-click zoom and right-click actions to copy, reuse, save, delete, or clear results
- **Save results**: handles `b64_json`, image URLs (including relative paths) and base64 embedded in chat responses; one-click save to disk

## Download

Grab the installer for your platform from the [Releases](../../releases) page. Windows (x86 / x86_64 / arm64), Linux (x86_64 / arm64) and macOS (Intel / Apple Silicon) are supported.

## Development

Prerequisites: [Node.js 20.19+](https://nodejs.org/), [pnpm](https://pnpm.io/), [Rust](https://www.rust-lang.org/).

The frontend uses Vue Router hash history for `/image`, `/chat`, `/canvas`, and `/settings`, with nested `/settings/models`, `/settings/agents`, `/settings/general`, and `/settings/logs` routes. Page components live under `src/views/`, including setting subpages under `src/views/settings/`. Model editing, unsaved-change prompts, and preview overlays live under `src/components/modals/`. Arco Design components are resolved on demand through `unplugin-vue-components`.

`src/App.vue` now contains only the application shell, router outlet, and global overlays. `src/composables/controller/index.ts` is a composition root that wires dependencies together and exposes the shared view model. Responsibilities are split as follows:

- `src/composables/`: provider and application settings, themes, logging, updates, result history, and the Image, Chat, and Canvas workspace state
- `src/services/`: OpenAI-compatible generation transport, retries and response parsing, plus IndexedDB preview and canvas persistence
- `src/domain/`: shared types, defaults, model selection, and normalization helpers
- `src/api/`, `src/chat/`, and `src/canvas/`: domain objects for API connections, chat sessions, and the canvas graph
- `src/styles/`: separate style modules for the application shell, settings, Image, Chat, Canvas, result overlays, and responsive rules

All network requests pass through the Tauri HTTP wrapper in `src/composables/fetch/index.ts` so the application can apply the system proxy. Images, Edits, and Chat generation requests are handled centrally by `src/services/transport/index.ts`.

```bash
# Install dependencies
pnpm install

# Development mode
pnpm tauri dev

# Build installers
pnpm tauri build
```

## Usage

1. In Model Settings, add a provider, edit its name, endpoint, and key directly in the detail pane, save it, then maintain its models through the model modal
2. Choose models grouped by provider in Image Generation, Chat, and Infinite Canvas; manually expand Advanced settings for image request options
3. Create and rename persistent conversations in Chat and select an agent from the composer; Agent Settings lets you edit the default assistant, add custom agents, and configure Canvas prompt generation
4. Select or create a canvas from the Infinite Canvas library; text generation creates an automatically connected text child, while manual edges can be disconnected with a double-click; each image-bearing node stores one replaceable reference, and multiple reference nodes can feed a new empty image node before generation
5. Image previews remain available; double-click to enlarge, or right-click to copy the image or prompt, use it as a reference, save it, delete it, or clear the full preview history

## License

This project is licensed under the [GNU Lesser General Public License v3.0](LICENSE).
