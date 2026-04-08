import * as https from 'https';
import * as http from 'http';

export interface FetchResult {
  url: string;
  title: string;
  description: string;
  headings: string[];
  textContent: string;
  rawLength: number;
  truncated: boolean;
}

const MAX_SIZE = 512 * 1024; // 500KB
const TIMEOUT_MS = 10_000;

/**
 * Fetches a URL and returns the raw HTML content.
 * Follows redirects (up to 5), enforces size & timeout limits.
 */
export function fetchUrl(url: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    // Guard against double-resolve (e.g. size truncation followed by 'end' event)
    let settled = false;
    const safeResolve = (value: string) => { if (!settled) { settled = true; resolve(value); } };
    const safeReject  = (err: Error)    => { if (!settled) { settled = true; reject(err); } };

    if (maxRedirects < 0) {
      return safeReject(new Error('Too many redirects'));
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return safeReject(new Error(`Invalid URL: ${url}`));
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return safeReject(new Error(`Unsupported protocol: ${parsedUrl.protocol}`));
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WebContextAI/1.0; VSCode Extension)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        // Handle redirects
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const redirectUrl = new URL(response.headers.location, url).toString();
          response.destroy();
          fetchUrl(redirectUrl, maxRedirects - 1).then(safeResolve).catch(safeReject);
          return;
        }

        if (response.statusCode && response.statusCode >= 400) {
          response.destroy();
          return safeReject(new Error(`HTTP ${response.statusCode}: Failed to fetch ${url}`));
        }

        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/') && !contentType.includes('application/json') && !contentType.includes('application/xml')) {
          response.destroy();
          return safeReject(new Error(`Unsupported content type: ${contentType}. Only text-based content is supported.`));
        }

        const chunks: Buffer[] = [];
        let totalSize = 0;

        response.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > MAX_SIZE) {
            response.destroy();
            // Resolve with what we have and prevent 'end' from resolving again
            safeResolve(Buffer.concat(chunks).toString('utf-8'));
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          safeResolve(Buffer.concat(chunks).toString('utf-8'));
        });

        response.on('error', safeReject);
      }
    );

    request.on('timeout', () => {
      request.destroy();
      safeReject(new Error(`Timeout: Request took longer than ${TIMEOUT_MS / 1000}s`));
    });

    request.on('error', safeReject);
  });
}

/**
 * Converts raw HTML to clean, readable text.
 */
export function htmlToText(html: string): string {
  let text = html;

  // Remove script and style blocks safely
  text = text.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|main|nav)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Replace list items
  text = text.replace(/<li[^>]*>/gi, '• ');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#\d+;/g, '');

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * Extracts metadata from raw HTML (title, description, headings).
 */
export function extractMetadata(html: string): {
  title: string;
  description: string;
  headings: string[];
} {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : 'Untitled Page';

  // Extract meta description — handle both attribute orderings:
  //   <meta name="description" content="...">
  //   <meta content="..." name="description">
  const descMatch =
    html.match(/<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([\s\S]*?)["']/i) ??
    html.match(/<meta\b[^>]*\bcontent=["']([\s\S]*?)["'][^>]*\bname=["']description["']/i);

  const ogDescMatch =
    html.match(/<meta\b[^>]*\bproperty=["']og:description["'][^>]*\bcontent=["']([\s\S]*?)["']/i) ??
    html.match(/<meta\b[^>]*\bcontent=["']([\s\S]*?)["'][^>]*\bproperty=["']og:description["']/i);

  const description = descMatch?.[1]?.trim() ?? ogDescMatch?.[1]?.trim() ?? '';

  // Extract headings
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: string[] = [];
  let match;
  while ((match = headingRegex.exec(html)) !== null && headings.length < 20) {
    const headingText = match[2].replace(/<[^>]+>/g, '').trim();
    if (headingText) {
      headings.push(`${'#'.repeat(parseInt(match[1]))} ${headingText}`);
    }
  }

  return { title, description, headings };
}

/**
 * Full pipeline: fetch URL → extract metadata → convert to text.
 */
export async function fetchAndParse(url: string): Promise<FetchResult> {
  const html = await fetchUrl(url);
  const metadata = extractMetadata(html);
  let textContent = htmlToText(html);

  const rawLength = textContent.length;
  const truncated = rawLength > 50_000;

  if (truncated) {
    textContent = textContent.slice(0, 50_000) + '\n\n[... content truncated at 50,000 characters ...]';
  }

  return {
    url,
    title: metadata.title,
    description: metadata.description,
    headings: metadata.headings,
    textContent,
    rawLength,
    truncated,
  };
}
