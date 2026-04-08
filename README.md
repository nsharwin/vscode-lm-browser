# 🌐 WebContext AI

A VS Code extension that lets you **fetch any web page** and **ask AI-powered questions** about its content — all from within a beautiful browser-like panel.

## Features

- **🔗 URL Fetching** — Paste any URL and the extension fetches the page content
- **🤖 AI Analysis** — Uses VS Code's Language Model API (Copilot) to analyze web content
- **💬 Chat Interface** — Ask follow-up questions with preserved conversation history
- **⚡ Preset Prompts** — One-click actions: Summarize, Extract Data, Explain, Takeaways
- **📊 Streaming Responses** — Real-time streaming of AI responses with markdown rendering
- **🎨 Theme-Aware** — Adapts to your VS Code dark/light theme

## Requirements

- **VS Code** 1.93.0 or later
- **GitHub Copilot** extension (provides the language models)

## Usage

1. The extension opens automatically when VS Code starts
2. Enter a URL in the address bar and press Enter (or click the ▶ button)
3. Once the page is fetched, type a question or click a preset prompt
4. The AI analyzes the page content and streams back the response
5. Ask follow-up questions — conversation history is preserved

## Keybindings
| Command | Mac | Description |
|---|---|---|
| `WebContext AI: Open Panel` | `Cmd+Shift+B` | Opens the WebContext panel |

### Preset Prompts

| Preset | What it does |
|--------|-------------|
| 📋 Summarize | Key points in bullet format |
| 📊 Extract Data | Structured data, facts, and figures |
| 💡 Explain | Simple explanation of main concepts |
| 🔗 Links | Lists all references and resources |
| 🎯 Takeaways | Key takeaways and action items |

## How it Works

1. **Fetch** — The extension downloads the HTML from the given URL
2. **Parse** — HTML is converted to clean text, metadata is extracted
3. **Prompt** — Your question + page content is sent to the Copilot language model via `vscode.lm` API
4. **Stream** — The AI response is streamed back in real-time with markdown rendering

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
