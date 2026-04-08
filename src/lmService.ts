import * as vscode from 'vscode';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PageData {
  id: string;
  title: string;
  url: string;
  textContent: string;
}

/** Maximum number of user/assistant turn pairs kept in history. */
const MAX_HISTORY_TURNS = 10;

/**
 * Service for interacting with VS Code's Language Model API.
 * Handles model selection, prompt building, and streaming responses.
 */
export class LMService {
  private conversationHistory: ChatMessage[] = [];

  /**
   * Selects the best available Copilot language model.
   */
  async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    // Try gpt-4o first, then fall back to any available model
    const families = ['gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet'];

    for (const family of families) {
      const models = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family,
      });
      if (models.length > 0) {
        return models[0];
      }
    }

    // Last resort: any copilot model
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return allModels.length > 0 ? allModels[0] : undefined;
  }

  /**
   * Builds an array of LanguageModelChatMessage from multiple web pages and user question.
   */
  buildMultiPageMessages(
    pages: PageData[],
    userQuestion: string
  ): vscode.LanguageModelChatMessage[] {
    const systemPrompt = `You are WebContext AI, an intelligent assistant that analyzes web page content.
You have been provided with the text content of one or more web pages. Each page is labeled. Answer the user's questions about this content accurately and helpfully.

Guidelines:
- Be concise but thorough
- Use markdown formatting for readability
- If the content doesn't contain enough information to answer, say so
- Reference specific parts of the page content when relevant (e.g. "According to [Page 1]")
- For summaries, highlight key points with bullet points
- For data extraction, use tables or structured lists

Note on Context: The user may have added or removed pages since previous messages in this conversation. Always base your answers primarily on the CURRENTLY provided web pages layout below.`;

    // Construct context payload from all loaded pages
    let contextMessage = '';

    if (pages.length === 1) {
      contextMessage = `## Web Page: "${pages[0].title}" (${pages[0].url})\n\n### Page Content:\n${pages[0].textContent}`;
    } else {
      contextMessage = pages.map((page, index) => {
        return `## [Page ${index + 1}] "${page.title}" (${page.url})\n\n### Page Content:\n${page.textContent}\n\n`;
      }).join('---\n\n');
    }

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      vscode.LanguageModelChatMessage.User(contextMessage),
    ];

    // Add conversation history for follow-ups
    for (const msg of this.conversationHistory) {
      if (msg.role === 'user') {
        messages.push(vscode.LanguageModelChatMessage.User(msg.content));
      } else {
        messages.push(vscode.LanguageModelChatMessage.Assistant(msg.content));
      }
    }

    // Add current question
    messages.push(vscode.LanguageModelChatMessage.User(userQuestion));

    return messages;
  }

  /**
   * Sends a prompt to the LM and streams the response via a callback.
   * Returns the full response text.
   */
  async sendPrompt(
    pages: PageData[],
    userQuestion: string,
    onFragment: (fragment: string) => void,
    token?: vscode.CancellationToken
  ): Promise<string> {
    const model = await this.selectModel();

    if (!model) {
      throw new Error(
        'No language model available. Please ensure GitHub Copilot is installed and active.'
      );
    }

    const messages = this.buildMultiPageMessages(pages, userQuestion);

    // Create a CancellationTokenSource only when the caller doesn't supply a token,
    // and always dispose it to avoid a resource leak.
    let cancellationToken: vscode.CancellationToken;
    let cts: vscode.CancellationTokenSource | undefined;
    
    if (token) {
      cancellationToken = token;
    } else {
      cts = new vscode.CancellationTokenSource();
      cancellationToken = cts.token;
    }

    try {
      const response = await model.sendRequest(messages, {}, cancellationToken);

      let fullResponse = '';
      for await (const fragment of response.text) {
        fullResponse += fragment;
        onFragment(fragment);
      }

      // Store in conversation history and enforce turn cap
      this.conversationHistory.push({ role: 'user', content: userQuestion });
      this.conversationHistory.push({ role: 'assistant', content: fullResponse });

      const maxMessages = MAX_HISTORY_TURNS * 2; // each turn = 1 user + 1 assistant
      if (this.conversationHistory.length > maxMessages) {
        this.conversationHistory.splice(0, this.conversationHistory.length - maxMessages);
      }

      return fullResponse;
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        console.error('LM Error:', err.message, err.code, err.cause);

        if (err.code === 'NoPermissions') {
          throw new Error(
            'Copilot access denied. Please allow WebContext AI to use language models.'
          );
        }
        if (err.code === 'Blocked') {
          throw new Error('Request was blocked. The content may violate usage policies.');
        }

        throw new Error(`Language Model Error: ${err.message}`);
      }
      throw err;
    } finally {
      cts?.dispose();
    }
  }

  /**
   * Clears the conversation history (used when fetching a new URL).
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Returns a copy of the conversation history.
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }
}
