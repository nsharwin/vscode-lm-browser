import { marked } from 'marked';
import DOMPurify from 'dompurify';

(function () {
  // ---- Detect Mode: Webview vs Browser ----
  const isBrowserMode = typeof window.__BROWSER_MODE__ !== 'undefined';
  let vscodeApi = null;
  let eventSource = null;

  if (!isBrowserMode) {
    vscodeApi = acquireVsCodeApi();
  } else {
    // Connect to SSE endpoint for streaming events
    eventSource = new EventSource('/events');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleIncomingMessage(data);
    };
    eventSource.onerror = () => {
      console.warn('SSE connection lost, reconnecting...');
    };
  }

  /**
   * Sends a message — routes to vscode.postMessage or HTTP POST.
   * In browser mode, network errors are caught and surfaced to the user.
   */
  async function sendMessage(message) {
    if (!isBrowserMode) {
      vscodeApi.postMessage(message);
      return;
    }

    // Browser mode: map message types to API endpoints
    try {
      switch (message.type) {
        case 'fetchUrl':
          await fetch('/api/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: message.url, tabId: message.tabId }),
          });
          break;

        case 'sendPrompt':
        case 'presetPrompt':
          await fetch('/api/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: message.prompt }),
          });
          break;

        case 'clearHistory':
          await fetch('/api/clear', { method: 'POST' });
          break;

        case 'newPage':
          await fetch('/api/new-page', { method: 'POST' });
          handleIncomingMessage({ type: 'pageCleared', tabId: activeTabId });
          break;

        case 'addTab':
          await fetch('/api/add-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabId: message.tabId }),
          });
          break;

        case 'removeTab':
          await fetch('/api/remove-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabId: message.tabId }),
          });
          break;

        case 'switchTab':
          await fetch('/api/switch-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabId: message.tabId }),
          });
          break;
      }
    } catch (err) {
      // Surface network-level failures (e.g. server not reachable) to the user
      hideLoading();
      // Ensure the chat area is visible so the error message can be seen
      welcomeScreen.classList.add('hidden');
      chatMessages.classList.remove('hidden');
      showError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- Multi-Page State ----
  const tabs = new Map(); // tabId -> tabData (url, title, contentLength etc)
  let activeTabId = 'tab-1';
  let tabCounter = 1;

  // Add initial empty tab state
  tabs.set(activeTabId, null);

  // DOM Elements
  const urlInput = document.getElementById('urlInput');
  const fetchBtn = document.getElementById('fetchBtn');
  const pageInfo = document.getElementById('pageInfo');
  const pageTitle = document.getElementById('pageTitle');
  const pageDescription = document.getElementById('pageDescription');
  const pageUrl = document.getElementById('pageUrl');
  const pageSize = document.getElementById('pageSize');
  const pageHeadings = document.getElementById('pageHeadings');
  const loadingBar = document.getElementById('loadingBar');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const chatMessages = document.getElementById('chatMessages');
  const presetBar = document.getElementById('presetBar');
  const promptFooter = document.getElementById('promptFooter');
  const promptInput = document.getElementById('promptInput');
  const sendBtn = document.getElementById('sendBtn');
  const newPageBtn = document.getElementById('newPageBtn');

  // Tab Bar Elements
  const tabBar = document.getElementById('tabBar');
  const addTabBtn = document.getElementById('addTabBtn');
  const tabCountBadge = document.getElementById('tabCountBadge');

  let isLoading = false;
  let currentResponseEl = null;

  // ---- Event Listeners ----

  fetchBtn.addEventListener('click', () => {
    if (!isLoading) { fetchUrl(); }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isLoading) { fetchUrl(); }
  });

  sendBtn.addEventListener('click', () => {
    if (!isLoading) { sendPrompt(); }
  });

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      sendPrompt();
    }
  });

  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  });

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      if (prompt && !isLoading) {
        sendMessage({ type: 'presetPrompt', prompt });
      }
    });
  });

  newPageBtn.addEventListener('click', () => {
    sendMessage({ type: 'newPage' });
  });

  addTabBtn.addEventListener('click', () => {
    if (tabs.size >= 5) {
      showError("Maximum of 5 tabs allowed.");
      return;
    }

    tabCounter++;
    const newTabId = `tab-${tabCounter}`;
    tabs.set(newTabId, null);

    // Switch to new tab
    activeTabId = newTabId;
    sendMessage({ type: 'addTab', tabId: newTabId });

    renderTabs();
    updateUIForActiveTab();
    urlInput.focus();
  });

  // ---- Functions ----

  function fetchUrl() {
    const url = urlInput.value.trim();
    if (!url) {
      urlInput.focus();
      urlInput.classList.add('shake');
      setTimeout(() => urlInput.classList.remove('shake'), 500);
      return;
    }
    sendMessage({ type: 'fetchUrl', url, tabId: activeTabId });
  }

  function sendPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) { return; }
    promptInput.value = '';
    promptInput.style.height = 'auto';
    sendMessage({ type: 'sendPrompt', prompt });
  }

  function showLoading() {
    isLoading = true;
    loadingBar.classList.remove('hidden');
    fetchBtn.disabled = true;
    sendBtn.disabled = true;
  }

  function hideLoading() {
    isLoading = false;
    loadingBar.classList.add('hidden');
    fetchBtn.disabled = false;
    sendBtn.disabled = false;
  }

  function renderTabs() {
    // Clear existing tabs except the add button
    const tabElements = Array.from(tabBar.querySelectorAll('.tab-pill'));
    tabElements.forEach(el => el.remove());

    let isAnyFetched = false;

    // Create tab pills
    Array.from(tabs.entries()).forEach(([id, data]) => {
      if (data) { isAnyFetched = true; }

      const tabEl = document.createElement('div');
      tabEl.className = 'tab-pill';
      if (id === activeTabId) { tabEl.classList.add('active'); }

      const title = data ? data.title : 'New Page';
      const truncatedTitle = title.length > 25 ? title.substring(0, 25) + '...' : title;

      tabEl.innerHTML = `
        <span class="tab-title" title="${escapeHtml(title)}">${escapeHtml(truncatedTitle)}</span>
        ${tabs.size > 1 ? '<button class="tab-close" title="Close tab">×</button>' : ''}
      `;

      // Click on tab to switch
      tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) { return; }

        activeTabId = id;
        sendMessage({ type: 'switchTab', tabId: id });
        renderTabs();
        updateUIForActiveTab();
      });

      // Close tab
      if (tabs.size > 1) {
        tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
          e.stopPropagation();
          tabs.delete(id);
          sendMessage({ type: 'removeTab', tabId: id });

          if (activeTabId === id) {
            // Pick another tab
            activeTabId = Array.from(tabs.keys())[0];
            sendMessage({ type: 'switchTab', tabId: activeTabId });
          }
          renderTabs();
          updateUIForActiveTab();
        });
      }

      tabBar.insertBefore(tabEl, addTabBtn);
    });

    // Update count badge
    if (isAnyFetched) {
      tabCountBadge.textContent = `${tabs.size} ${tabs.size === 1 ? 'page' : 'pages'} loaded`;
      tabCountBadge.classList.remove('hidden');
    } else {
      tabCountBadge.classList.add('hidden');
    }

    addTabBtn.style.display = tabs.size >= 5 ? 'none' : 'flex';
  }

  function updateUIForActiveTab() {
    const data = tabs.get(activeTabId);

    if (!data) {
      // Empty tab
      urlInput.value = '';

      // Only show welcome screen if NO tabs have data
      const hasAnyData = Array.from(tabs.values()).some(d => d !== null);
      if (!hasAnyData) {
        welcomeScreen.classList.remove('hidden');
        chatMessages.classList.add('hidden');
        presetBar.classList.add('hidden');
        promptFooter.classList.add('hidden');
      }
      pageInfo.classList.add('hidden');
    } else {
      // Tab with data
      urlInput.value = data.url;
      welcomeScreen.classList.add('hidden');
      chatMessages.classList.remove('hidden');
      presetBar.classList.remove('hidden');
      promptFooter.classList.remove('hidden');
      pageInfo.classList.remove('hidden');

      pageTitle.textContent = data.title;
      pageDescription.textContent = data.description || 'No description available';
      pageUrl.textContent = data.url;
      pageSize.textContent = formatBytes(data.contentLength) +
        (data.truncated ? ' (truncated)' : '');
      pageHeadings.innerHTML = data.headings
        .map((h) => '<div class="heading-item">' + escapeHtml(h) + '</div>')
        .join('');
    }
  }

  function addUserMessage(text) {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg chat-msg-user';
    msgEl.innerHTML = `
      <div class="chat-msg-avatar user-avatar">You</div>
      <div class="chat-msg-content">
        <div class="chat-msg-text">${escapeHtml(text)}</div>
      </div>
    `;
    chatMessages.appendChild(msgEl);
    scrollToBottom(true);
  }

  function createAssistantMessage() {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg chat-msg-assistant';
    msgEl.innerHTML = `
      <div class="chat-msg-avatar ai-avatar">AI</div>
      <div class="chat-msg-content">
        <div class="chat-msg-text">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;
    chatMessages.appendChild(msgEl);
    currentResponseEl = msgEl.querySelector('.chat-msg-text');
    scrollToBottom(true);
    return currentResponseEl;
  }

  function appendToResponse(fragment) {
    if (currentResponseEl) {
      // Remove typing indicator on first text chunk
      const typingIndicator = currentResponseEl.querySelector('.typing-indicator');
      if (typingIndicator) {
        typingIndicator.remove();
      }
      currentResponseEl.textContent += fragment;
      scrollToBottom();
    }
  }

  function finalizeResponse() {
    if (currentResponseEl) {
      const raw = currentResponseEl.textContent || '';
      currentResponseEl.innerHTML = renderMarkdown(raw);

      // Inject copy buttons into code blocks
      currentResponseEl.querySelectorAll('pre').forEach((pre) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          const codeEl = pre.querySelector('code');
          const text = (codeEl ? codeEl.textContent : pre.textContent) || '';
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.textContent = '✓ Copied';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = 'Copy';
              copyBtn.classList.remove('copied');
            }, 2000);
          }).catch(() => {
            copyBtn.textContent = 'Failed';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
          });
        });

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(copyBtn);
        wrapper.appendChild(pre);
      });

      currentResponseEl = null;
      scrollToBottom();
    }
  }

  function showError(message) {
    const errEl = document.createElement('div');
    errEl.className = 'chat-msg chat-msg-error';
    errEl.innerHTML = `
      <div class="chat-msg-avatar error-avatar">⚠</div>
      <div class="chat-msg-content">
        <div class="chat-msg-text error-text">${escapeHtml(message)}</div>
      </div>
    `;
    chatMessages.appendChild(errEl);
    scrollToBottom();
  }

  function scrollToBottom(force = false) {
    const threshold = 80; // Allow a small margin of error for detecting "bottom"
    const isNearBottom = chatMessages.scrollHeight - chatMessages.clientHeight - chatMessages.scrollTop <= threshold;

    if (force || isNearBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(1) + ' KB'; }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderMarkdown(text) {
    try {
      const parsed = marked.parse(text);
      return DOMPurify.sanitize(parsed, {
        USE_PROFILES: { html: false, svg: false, mathMl: false },
        ADD_ATTR: ['target'],
        ADD_TAGS: ['iframe']
      });
    } catch (e) {
      console.error('Marked parsing error', e);
      return escapeHtml(text);
    }
  }

  // ---- Unified Message Handler ----

  function handleIncomingMessage(message) {
    switch (message.type) {
      case 'connected':
        break;
      case 'fetchStarted':
        showLoading();
        break;
      case 'fetchComplete':
        hideLoading();
        tabs.set(message.tabId, message.data);
        renderTabs();
        updateUIForActiveTab();
        promptInput.focus();
        break;
      case 'promptStarted':
        showLoading();
        addUserMessage(message.prompt);
        createAssistantMessage();
        break;
      case 'responseFragment':
        appendToResponse(message.fragment);
        break;
      case 'responseComplete':
        hideLoading();
        finalizeResponse();
        promptInput.focus();
        break;
      case 'error':
        hideLoading();
        if (currentResponseEl) { finalizeResponse(); }
        showError(message.message);
        break;
      case 'historyCleared':
        chatMessages.innerHTML = '';
        break;
      case 'pageCleared':
        hideLoading();
        tabs.set(message.tabId, null);
        renderTabs();
        updateUIForActiveTab();
        break;
    }
  }

  // Webview mode: listen via window message events
  if (!isBrowserMode) {
    window.addEventListener('message', (event) => {
      handleIncomingMessage(event.data);
    });
  }

  // Initial render
  renderTabs();
  updateUIForActiveTab();
  urlInput.focus();
})();
