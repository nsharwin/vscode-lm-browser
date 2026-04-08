/**
 * Shared HTML page builder for both the VS Code Webview panel and the
 * local HTTP server (browser mode). Each caller supplies its own <head>
 * content and closing <script> tags; the body markup is identical.
 */

export interface PageHtmlOptions {
  /** HTML to inject inside <head> (CSP, stylesheet links, inline styles, etc.) */
  head: string;
  /** Whether to render the "Browser Mode" badge in the header brand area */
  browserBadge?: boolean;
  /** Script tag(s) to inject at the very end of <body> */
  scripts: string;
}

export function buildPageHtml({ head, browserBadge = false, scripts }: PageHtmlOptions): string {
  const badge = browserBadge
    ? '<span class="browser-badge">● Browser Mode</span>'
    : '';

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${head}
  <title>WebContext AI</title>
</head>
<body>
  <!-- Header / URL Bar -->
  <header class="header">
    <div class="header-brand">
      <span class="header-icon">🌐</span>
      <span class="header-title">WebContext <span class="header-ai">AI</span></span>
      ${badge}
    </div>
    <div class="url-bar">
      <div class="url-input-wrapper">
        <svg class="url-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.2c.7 0 1.4.6 1.9 1.7.3.6.5 1.3.6 2.1H5.5c.1-.8.3-1.5.6-2.1C6.6 2.8 7.3 2.2 8 2.2zM5.3 6h5.4c.1.6.1 1.3.1 2s0 1.4-.1 2H5.3c-.1-.6-.1-1.3-.1-2s0-1.4.1-2zm-1.2 0H2.4A5.8 5.8 0 0 0 2.2 8c0 .7.1 1.4.2 2h1.7a14 14 0 0 1 0-4zm7.8 0h1.7c.1.6.2 1.3.2 2s-.1 1.4-.2 2h-1.7c.1-.6.1-1.3.1-2s0-1.4-.1-2zM2.7 10.8h1.5c.2 1 .5 1.9.9 2.6a5.8 5.8 0 0 1-2.4-2.6zm3 0h4.6c-.1.8-.3 1.5-.6 2.1-.5 1.1-1.2 1.7-1.9 1.7-.7 0-1.4-.6-1.9-1.7-.3-.6-.5-1.3-.6-2.1h.4zm4.8 0h1.5a5.8 5.8 0 0 1-2.4 2.6c.4-.7.7-1.6.9-2.6zM4.2 5.2H2.7A5.8 5.8 0 0 1 5.1 2.6c-.4.7-.7 1.6-.9 2.6zm7.6 0h-1.5c-.2-1-.5-1.9-.9-2.6a5.8 5.8 0 0 1 2.4 2.6z"/>
        </svg>
        <input type="text" id="urlInput" class="url-input" placeholder="Enter a URL to analyze (e.g., https://example.com)" spellcheck="false">
        <button id="fetchBtn" class="fetch-btn" title="Fetch page">
          <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
            <path d="M2.5 2v12l10-6-10-6z"/>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- Tab Bar -->
  <div class="tab-bar-container">
    <div id="tabBar" class="tab-bar">
      <!-- Tabs injected here -->
      <button id="addTabBtn" class="tab-add-btn" title="Add another page to context">
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M7.5 1H8.5V7.5H15V8.5H8.5V15H7.5V8.5H1V7.5H7.5V1Z"/>
        </svg>
      </button>
    </div>
    <div id="tabCountBadge" class="tab-count hidden">0 pages loaded</div>
  </div>

  <!-- Page Info Card (shown after fetch) -->
  <section id="pageInfo" class="page-info hidden">
    <div class="page-info-card">
      <div class="page-info-header">
        <div class="page-dot"></div>
        <h2 id="pageTitle" class="page-title"></h2>
        <button id="newPageBtn" class="new-page-btn" title="Clear and start fresh">✕</button>
      </div>
      <p id="pageDescription" class="page-description"></p>
      <div class="page-meta">
        <span id="pageUrl" class="page-url"></span>
        <span id="pageSize" class="page-size"></span>
      </div>
      <details class="page-headings-details">
        <summary>Page Structure</summary>
        <div id="pageHeadings" class="page-headings"></div>
      </details>
    </div>
  </section>

  <!-- Loading indicator -->
  <div id="loadingBar" class="loading-bar hidden">
    <div class="loading-bar-inner"></div>
  </div>

  <!-- Chat Area -->
  <main class="chat-area">
    <!-- Welcome screen (shown before first fetch) -->
    <div id="welcomeScreen" class="welcome-screen">
      <div class="welcome-content">
        <div class="welcome-glow"></div>
        <h1 class="welcome-title">🌐 WebContext AI</h1>
        <p class="welcome-subtitle">Fetch any web page and ask AI-powered questions about its content</p>
        <div class="welcome-steps">
          <div class="welcome-step">
            <span class="step-icon">1</span>
            <span>Enter a URL in the address bar above</span>
          </div>
          <div class="welcome-step">
            <span class="step-icon">2</span>
            <span>Add multiple tabs to analyze pages together</span>
          </div>
          <div class="welcome-step">
            <span class="step-icon">3</span>
            <span>Ask questions or use preset prompts</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Chat messages (shown after fetch) -->
    <div id="chatMessages" class="chat-messages hidden"></div>
  </main>

  <!-- Preset Prompts -->
  <section id="presetBar" class="preset-bar hidden">
    <button class="preset-btn" data-prompt="Summarize the key points in bullet points. If multiple pages are loaded, summarize each separately.">
      <span class="preset-icon">📋</span> Summarize
    </button>
    <button class="preset-btn" data-prompt="Compare the provided pages. What are the key similarities and differences?">
      <span class="preset-icon">⚖️</span> Compare Pages
    </button>
    <button class="preset-btn" data-prompt="Extract all important data, facts, and figures into a structured format">
      <span class="preset-icon">📊</span> Extract Data
    </button>
    <button class="preset-btn" data-prompt="Explain the main concepts in simple terms">
      <span class="preset-icon">💡</span> Explain
    </button>
    <button class="preset-btn" data-prompt="What are the key takeaways and action items?">
      <span class="preset-icon">🎯</span> Takeaways
    </button>
  </section>

  <!-- Prompt Input -->
  <footer id="promptFooter" class="prompt-footer hidden">
    <div class="prompt-input-wrapper">
      <textarea id="promptInput" class="prompt-input" placeholder="Ask a question across all loaded pages..." rows="1"></textarea>
      <button id="sendBtn" class="send-btn" title="Send prompt">
        <svg viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
          <path d="M1 1.5l14 6.5-14 6.5V9l8-1-8-1V1.5z"/>
        </svg>
      </button>
    </div>
  </footer>

  ${scripts}
</body>
</html>`;
}
