import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { fetchAndParse, FetchResult } from './urlFetcher';
import { LMService, PageData } from './lmService';
import { buildPageHtml } from './webview/template';

/** Maximum POST body size accepted by the API endpoints (64 KB). */
const MAX_POST_BODY = 64 * 1024;

/**
 * Local HTTP server that serves the WebContext UI in the OS default browser.
 * Uses SSE (Server-Sent Events) for streaming LM responses.
 * Uses regular HTTP POST for actions (fetch URL, send prompt, etc.).
 */
export class WebContextServer {
  private server: http.Server | undefined;
  private port: number = 0;
  private lmService: LMService;
  private extensionPath: string;
  private sseClients: Set<http.ServerResponse> = new Set();
  private sseKeepaliveTimer: ReturnType<typeof setInterval> | undefined;

  // Multi-page state
  private pages: Map<string, FetchResult> = new Map();
  private activeTabId: string = 'tab-1';

  constructor(extensionPath: string) {
    this.lmService = new LMService();
    this.extensionPath = extensionPath;
  }

  /**
   * Starts the server on a random available port and opens the browser.
   */
  async start(): Promise<void> {
    if (this.server) {
      await this.openBrowser();
      return;
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error('Unhandled request error:', err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          console.log(`WebContext server running at http://127.0.0.1:${this.port}`);
          this.openBrowser().then(resolve).catch(reject);
        }
      });

      this.server!.on('error', (err) => {
        console.error('Server error:', err);
        reject(err);
      });
    });
  }

  private async openBrowser(): Promise<void> {
    const url = vscode.Uri.parse(`http://127.0.0.1:${this.port}`);
    await vscode.env.openExternal(url);
    vscode.window.showInformationMessage(`WebContext AI opened in browser at port ${this.port}`);
  }

  stop(): void {
    if (this.sseKeepaliveTimer) {
      clearInterval(this.sseKeepaliveTimer);
      this.sseKeepaliveTimer = undefined;
    }

    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    if (this.server) {
      this.server.close();
      this.server = undefined;
      this.port = 0;
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || '/';

    if (req.method === 'GET') {
      switch (url) {
        case '/':
          await this.serveHtml(res);
          return;
        case '/styles.css':
          await this.serveFile(res, 'src/webview/styles.css', 'text/css');
          return;
        case '/main.js':
          await this.serveFile(res, 'dist/webview/main.js', 'application/javascript');
          return;
        case '/events':
          this.handleSSE(res);
          return;
        default:
          res.writeHead(404);
          res.end('Not found');
          return;
      }
    }

    if (req.method === 'POST') {
      let body = '';
      let tooLarge = false;

      await new Promise<void>((resolve) => {
        req.on('data', (chunk: string | Buffer) => {
          body += chunk;
          if (body.length > MAX_POST_BODY) {
            tooLarge = true;
          }
        });
        req.on('end', resolve);
        req.on('error', resolve); // let the tooLarge / JSON parse path handle errors
      });

      if (tooLarge) {
        res.writeHead(413);
        res.end('Payload Too Large');
        return;
      }

      try {
        const data = body ? JSON.parse(body) : {};
        switch (url) {
          case '/api/fetch':
            await this.handleFetchUrl(res, data.url, data.tabId || this.activeTabId);
            break;
          case '/api/prompt':
            await this.handleSendPrompt(res, data.prompt);
            break;
          case '/api/clear':
            this.lmService.clearHistory();
            this.jsonResponse(res, { success: true });
            break;
          case '/api/new-page':
            if (this.activeTabId) {
              this.pages.delete(this.activeTabId);
            }
            this.lmService.clearHistory();
            this.jsonResponse(res, { success: true });
            break;
          case '/api/add-tab':
            this.activeTabId = data.tabId || 'tab-1';
            this.jsonResponse(res, { success: true });
            break;
          case '/api/remove-tab':
            if (data.tabId) { this.pages.delete(data.tabId); }
            this.jsonResponse(res, { success: true });
            break;
          case '/api/switch-tab':
            if (data.tabId) { this.activeTabId = data.tabId; }
            this.jsonResponse(res, { success: true });
            break;
          default:
            res.writeHead(404);
            res.end('Not found');
        }
      } catch (err) {
        this.jsonResponse(res, {
          error: err instanceof Error ? err.message : String(err)
        }, 500);
      }
      return;
    }

    // Reject any other HTTP method explicitly
    res.writeHead(405, { Allow: 'GET, POST, OPTIONS' });
    res.end('Method Not Allowed');
  }

  private handleSSE(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');
    this.sseClients.add(res);

    // Start keepalive pings so idle connections are not dropped by proxies/browsers
    this.startSSEKeepalive();

    res.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  /** Sends a periodic SSE comment (ping) to keep idle connections alive. */
  private startSSEKeepalive(): void {
    if (this.sseKeepaliveTimer) { return; }
    this.sseKeepaliveTimer = setInterval(() => {
      for (const client of this.sseClients) {
        client.write(':ping\n\n');
      }
    }, 25_000);
  }

  private broadcastSSE(data: object): void {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      client.write(message);
    }
  }

  /** Serves the main HTML page using the shared template. */
  private async serveHtml(res: http.ServerResponse): Promise<void> {
    const head = `
  <style>
    /* Browser-specific CSS variable overrides (mirrors VS Code dark theme) */
    :root {
      --vscode-editor-background: #1e1e2e;
      --vscode-editor-foreground: #cdd6f4;
      --vscode-descriptionForeground: #a6adc8;
      --vscode-editorWidget-background: #28283d;
      --vscode-sideBar-background: #28283d;
      --vscode-widget-border: rgba(255, 255, 255, 0.08);
      --vscode-input-background: #313244;
      --vscode-input-foreground: #cdd6f4;
      --vscode-input-border: rgba(255, 255, 255, 0.1);
      --vscode-button-background: #7c3aed;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #6d28d9;
      --vscode-list-hoverBackground: rgba(255, 255, 255, 0.05);
      --vscode-errorForeground: #f38ba8;
      --vscode-font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --vscode-font-size: 14px;
      --vscode-editor-font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    body { max-width: 900px; margin: 0 auto; min-height: 100vh; }
    .header { position: sticky; top: 0; z-index: 100; backdrop-filter: blur(12px); background: rgba(30, 30, 46, 0.85); }
    .browser-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(34, 197, 94, 0.15); color: #22c55e; border-radius: 10px; font-size: 10px; font-weight: 600; margin-left: 8px; }
  </style>
  <link rel="stylesheet" href="/styles.css">`;

    const scripts = `
  <script>window.__BROWSER_MODE__ = true;</script>
  <script src="/main.js"></script>`;

    const html = buildPageHtml({ head, browserBadge: true, scripts });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /** Reads and serves a static file asynchronously. */
  private async serveFile(res: http.ServerResponse, relativePath: string, contentType: string): Promise<void> {
    const filePath = path.join(this.extensionPath, relativePath);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('File not found');
    }
  }

  private jsonResponse(res: http.ServerResponse, data: object, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private async handleFetchUrl(res: http.ServerResponse, url: string, tabId: string): Promise<void> {
    if (!url?.trim()) {
      return this.jsonResponse(res, { error: 'Please enter a URL' }, 400);
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    this.broadcastSSE({ type: 'fetchStarted', tabId });

    try {
      const result = await fetchAndParse(url);
      this.pages.set(tabId, result);

      const responseData = {
        type: 'fetchComplete',
        tabId,
        data: {
          url: result.url,
          title: result.title,
          description: result.description,
          headings: result.headings,
          contentPreview: result.textContent.slice(0, 1000),
          contentLength: result.rawLength,
          truncated: result.truncated,
        },
      };

      this.broadcastSSE(responseData);
      this.jsonResponse(res, responseData);
    } catch (err) {
      const errorMsg = `Failed to fetch page: ${err instanceof Error ? err.message : String(err)}`;
      this.broadcastSSE({ type: 'error', message: errorMsg, tabId });
      this.jsonResponse(res, { error: errorMsg }, 500);
    }
  }

  private async handleSendPrompt(res: http.ServerResponse, prompt: string): Promise<void> {
    if (!prompt?.trim()) {
      return this.jsonResponse(res, { error: 'Please enter a prompt' }, 400);
    }

    if (this.pages.size === 0) {
      return this.jsonResponse(res, {
        error: 'Please fetch a web page first by entering a URL.'
      }, 400);
    }

    this.broadcastSSE({ type: 'promptStarted', prompt });
    this.jsonResponse(res, { status: 'streaming' });

    try {
      const pageDataList: PageData[] = Array.from(this.pages.entries()).map(([id, result]) => ({
        id,
        url: result.url,
        title: result.title,
        textContent: result.textContent
      }));

      await this.lmService.sendPrompt(
        pageDataList,
        prompt,
        (fragment: string) => {
          this.broadcastSSE({ type: 'responseFragment', fragment });
        }
      );
      this.broadcastSSE({ type: 'responseComplete' });
    } catch (err) {
      this.broadcastSSE({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
