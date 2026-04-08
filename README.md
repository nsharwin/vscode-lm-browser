# 🌐 WebContext AI

> **🎯 Primary Intent:** This repository serves as an educational showcase and demonstration of how to leverage the **[VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model)** (`vscode.lm`) from within a custom web interface (both VS Code Webviews and isolated external browsers).

A VS Code extension that lets you **fetch any web page** and **ask AI-powered questions** about its content — all from within a beautiful browser-like panel.

## Features

- **🔗 URL Fetching** — Paste any URL and the extension fetches the page content
- **📑 Multi-Tab Context** — Load multiple pages simultaneously to perform powerful cross-document analysis
- **🤖 AI Analysis** — Uses VS Code's Language Model API (Copilot) to analyze web content
- **💬 Shared Chat Interface** — Ask questions across all loaded pages; conversation history is preserved
- **🌐 Dual-Mode UI** — Works as an integrated VS Code Webview panel AND as a standalone localhost web server
- **⚡ Preset Prompts** — One-click actions: Summarize, Compare Pages, Extract Data, Explain, Takeaways
- **📊 Real-time Streaming** — Live streaming of AI responses with fast markdown rendering
- **🎨 Theme-Aware** — Adapts to your VS Code dark/light theme (Webview mode)

## Requirements

- **VS Code** 1.93.0 or later
- **GitHub Copilot** extension (provides the language models)

## Usage

1. Enter a URL in the address bar and press Enter (or click the ▶ button)
2. Use the **"+" (Add Tab)** button to fetch additional pages to build your context
3. Switch between tabs to see metadata/headings for individual pages
4. Type an analytical question or click a preset prompt
5. The AI analyzes *all* loaded pages together and streams back exactly what you need
6. Continue asking follow-up questions — conversation history is preserved across the session

## Keybindings
| Command | Mac | Description |
|---|---|---|
| `WebContext AI: Open Panel` | `Cmd+Shift+B` | Opens the WebContext panel within VS Code |
| `WebContext AI: Open in Browser` | - | Starts a local server and opens your OS browser |

### Preset Prompts

| Preset | What it does |
|--------|-------------|
| 📋 Summarize | Key points in bullet format (handles multiple pages) |
| ⚖️ Compare Pages | Analyzes key similarities and differences |
| 📊 Extract Data | Structured data, facts, and figures |
| 💡 Explain | Simple explanation of main concepts |
| 🎯 Takeaways | Key takeaways and action items |

## How it Works

1. **Fetch** — Downloads HTML from all provided URLs
2. **Parse** — Extracts metadata, cleans HTML into text, and truncates if necessary
3. **Prompt** — Organizes all pages into a unified context + appends your question. Sent to Copilot via `vscode.lm`
4. **Stream** — Relays the AI response via IPC (Webview mode) or Server-Sent Events (Browser mode)

## Development

```bash
# Install dependencies
npm install

# Watch mode (auto-rebuild on changes)
npm run watch

# Production build
npm run compile
```

Press `F5` to launch the Extension Development Host for testing.

## Tech Stack

- **TypeScript** — Extension logic
- **VS Code Language Model API** (`vscode.lm`) — AI integration
- **Webview API** — Browser-like panel UI
- **esbuild** — Fast bundling

## Limitations

- Fetches raw HTML only — JavaScript-rendered content (SPAs) won't be captured
- Content is truncated at 50,000 characters to fit model context windows
- Requires GitHub Copilot for language model access

## License

MIT
