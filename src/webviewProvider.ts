import * as vscode from 'vscode';
import { fetchAndParse, FetchResult } from './urlFetcher';
import { LMService, PageData } from './lmService';
import { buildPageHtml } from './webview/template';

/**
 * Manages the WebContext webview panel.
 * This is the primary UI — a full editor-area panel with browser-like interface.
 */
export class WebContextPanel {
  public static currentPanel: WebContextPanel | undefined;
  private static readonly viewType = 'browserprompt.panel';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly lmService: LMService;
  private disposables: vscode.Disposable[] = [];

  // Multi-page state
  private pages: Map<string, FetchResult> = new Map();
  private activeTabId: string = 'tab-1';

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.lmService = new LMService();

    // Set the webview's HTML content
    this.panel.webview.html = this.getHtmlContent();

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    // Handle panel disposal
    this.panel.onDidDispose(
      () => this.dispose(),
      null,
      this.disposables
    );
  }

  /**
   * Creates or reveals the WebContext panel.
   */
  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If panel already exists, reveal it
    if (WebContextPanel.currentPanel) {
      WebContextPanel.currentPanel.panel.reveal(column);
      return;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      WebContextPanel.viewType,
      '🌐 WebContext AI',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'src', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      }
    );

    WebContextPanel.currentPanel = new WebContextPanel(panel, context.extensionUri);
  }

  /**
   * Handles messages sent from the webview.
   */
  private async handleMessage(message: { type: string; url?: string; prompt?: string; tabId?: string }): Promise<void> {
    switch (message.type) {
      case 'fetchUrl':
        await this.handleFetchUrl(message.url || '', message.tabId || this.activeTabId);
        break;

      case 'sendPrompt':
      case 'presetPrompt':
        await this.handleSendPrompt(message.prompt || '');
        break;

      case 'clearHistory':
        this.lmService.clearHistory();
        this.postMessage({ type: 'historyCleared' });
        break;

      case 'newPage':
        // Clears the active tab only
        if (this.activeTabId) {
          this.pages.delete(this.activeTabId);
        }
        this.lmService.clearHistory();
        this.postMessage({ type: 'pageCleared', tabId: this.activeTabId });
        break;

      case 'addTab':
        this.activeTabId = message.tabId || 'tab-1';
        break;

      case 'removeTab':
        if (message.tabId) {
          this.pages.delete(message.tabId);
        }
        break;

      case 'switchTab':
        if (message.tabId) {
          this.activeTabId = message.tabId;
        }
        break;
    }
  }

  /**
   * Fetches a URL and sends the result back to the webview.
   */
  private async handleFetchUrl(url: string, tabId: string): Promise<void> {
    if (!url.trim()) {
      this.postMessage({ type: 'error', message: 'Please enter a URL' });
      return;
    }

    // Ensure protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    this.postMessage({ type: 'fetchStarted', tabId });

    try {
      const result = await fetchAndParse(url);
      this.pages.set(tabId, result);

      this.postMessage({
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
      });
    } catch (err) {
      this.postMessage({
        type: 'error',
        message: `Failed to fetch page: ${err instanceof Error ? err.message : String(err)}`,
        tabId
      });
    }
  }

  /**
   * Sends a prompt to the LM API with all loaded pages as context.
   */
  private async handleSendPrompt(prompt: string): Promise<void> {
    if (!prompt.trim()) {
      this.postMessage({ type: 'error', message: 'Please enter a prompt' });
      return;
    }

    if (this.pages.size === 0) {
      this.postMessage({
        type: 'error',
        message: 'Please fetch a web page first by entering a URL above.',
      });
      return;
    }

    this.postMessage({ type: 'promptStarted', prompt });

    try {
      // Convert FetchResults to PageData for the LM service
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
          this.postMessage({ type: 'responseFragment', fragment });
        }
      );

      this.postMessage({ type: 'responseComplete' });
    } catch (err) {
      this.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Sends a message to the webview.
   */
  private postMessage(message: object): void {
    this.panel.webview.postMessage(message);
  }

  /**
   * Generates the full HTML content for the webview using the shared template.
   */
  private getHtmlContent(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();

    const stylesPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'styles.css');
    const scriptPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js');

    const stylesUri = webview.asWebviewUri(stylesPath);
    const scriptUri = webview.asWebviewUri(scriptPath);

    const head = `
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} data:;
  ">
  <link rel="stylesheet" href="${stylesUri}">`;

    const scripts = `<script nonce="${nonce}" src="${scriptUri}"></script>`;

    return buildPageHtml({ head, browserBadge: false, scripts });
  }

  /**
   * Disposes the panel and cleans up resources.
   */
  public dispose(): void {
    WebContextPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}

/**
 * Generates a cryptographically secure random nonce for CSP.
 */
function getNonce(): string {
  const array = new Uint8Array(32);
  require('crypto').randomFillSync(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}
