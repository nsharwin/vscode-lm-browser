import * as vscode from 'vscode';
import { WebContextPanel } from './webviewProvider';
import { WebContextServer } from './server';

let server: WebContextServer | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('WebContext AI is now active');

  // Command: Open in webview panel (default)
  const openCommand = vscode.commands.registerCommand('webcontext.open', () => {
    WebContextPanel.createOrShow(context);
  });
  context.subscriptions.push(openCommand);

  // Command: Open in OS default browser
  const openBrowserCommand = vscode.commands.registerCommand('webcontext.openInBrowser', async () => {
    if (!server) {
      server = new WebContextServer(context.extensionPath);
    }
    try {
      await server.start();
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to start browser server: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
  context.subscriptions.push(openBrowserCommand);

  // Note: panel is intentionally NOT auto-opened on activation to avoid
  // being intrusive. Users open it via the command or keybinding.
}

export function deactivate() {
  if (server) {
    server.stop();
    server = undefined;
  }
  // Dispose the webview panel if it is still open
  WebContextPanel.currentPanel?.dispose();
  console.log('WebContext AI deactivated');
}
