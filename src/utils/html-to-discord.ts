import { parse, HTMLElement } from 'node-html-parser';

/**
 * Converts rich-text HTML (as produced by the GoPartTime task dialog,
 * e.g. `div.prose` innerHTML) into Discord-compatible markdown.
 *
 * Supported elements:
 *  - p / div / section / article / figure  → paragraph blocks separated by \n\n
 *  - br                                  → single line break
 *  - strong / b                          → **bold**
 *  - em / i                              → *italic*
 *  - s / strike / del                    → ~~strikethrough~~
 *  - u                                   → __underline__
 *  - a[href]                             → [text](href) (plain URL when text === href)
 *  - ul / ol / li                        → bullet / numbered lists
 *  - blockquote                          → > quoted lines
 *  - pre / code                          → ``` fenced code blocks (protected from reflow)
 *  - h1..h6                              → **heading**
 *  - img                                 → skipped (images are delivered separately)
 *
 * Copy-friendly: labels and values are emitted on separate paragraphs so the
 * value can be selected/copied without the label.
 */

const PLACEHOLDER_PREFIX = '\u0000GPC';
const PLACEHOLDER_SUFFIX = '\u0000';

// ─── Public API ──────────────────────────────────────────────

export function htmlToDiscord(html: string): string {
  const placeholders: string[] = [];
  const root = parse(html);
  const out: string[] = [];

  for (const node of root.childNodes) {
    renderNode(node, out, placeholders);
  }

  const normalized = normalizeParagraphs(out.join(''));

  // Restore protected code blocks after paragraph normalization
  return normalized.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
    (_match, index: string) => placeholders[Number(index)] ?? '',
  );
}

// ─── Rendering ───────────────────────────────────────────────

function renderNode(node: unknown, out: string[], placeholders: string[]): void {
  if (!node || typeof node !== 'object') return;
  const anyNode = node as { nodeType?: number };
  if (anyNode.nodeType === 3) {
    out.push((node as { text: string }).text);
    return;
  }
  if (anyNode.nodeType !== 1) return;

  const el = node as HTMLElement;
  const tag = el.rawTagName.toLowerCase();

  switch (tag) {
    case 'p':
      renderChildren(el, out, placeholders);
      out.push('\n\n');
      break;

    case 'br':
      out.push('\n');
      break;

    case 'strong':
    case 'b':
      wrapInline(el, out, placeholders, '**');
      break;

    case 'em':
    case 'i':
      wrapInline(el, out, placeholders, '*');
      break;

    case 's':
    case 'strike':
    case 'del':
      wrapInline(el, out, placeholders, '~~');
      break;

    case 'u':
      wrapInline(el, out, placeholders, '__');
      break;

    case 'code': {
      const text = el.text;
      if (!text) break;
      out.push(text.includes('`') ? `\`\`${text}\`\`` : `\`${text}\``);
      break;
    }

    case 'pre': {
      // node-html-parser keeps <pre> content as raw text (including any
      // <code> markup), so re-parse the inner fragment to extract clean text.
      const innerText = parse(el.innerHTML).text;
      const code = innerText.replace(/\n$/, '');
      if (code.trim().length === 0) break;
      placeholders.push('```\n' + code + '\n```');
      out.push(`${PLACEHOLDER_PREFIX}${placeholders.length - 1}${PLACEHOLDER_SUFFIX}\n\n`);
      break;
    }

    case 'a': {
      const href = (el.getAttribute('href') || '').trim();
      const text = el.text.trim();
      if (!href) {
        renderChildren(el, out, placeholders);
        break;
      }
      if (!text || text === href) {
        out.push(href);
      } else {
        out.push(`[${text}](${href})`);
      }
      break;
    }

    case 'ul':
      renderList(el, out, placeholders, '•');
      break;

    case 'ol':
      renderList(el, out, placeholders, null);
      break;

    case 'li':
      out.push('• ');
      renderChildren(el, out, placeholders);
      out.push('\n');
      break;

    case 'blockquote': {
      const text = el.text.trim();
      if (!text) break;
      out.push(text.split('\n').map((line) => `> ${line}`).join('\n'));
      out.push('\n\n');
      break;
    }

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = el.text.trim();
      if (!text) break;
      out.push(`**${text}**\n\n`);
      break;
    }

    case 'img':
      // Images are extracted separately by the extension (ordered, alt-first)
      break;

    case 'div':
    case 'section':
    case 'article':
    case 'figure':
      renderChildren(el, out, placeholders);
      out.push('\n\n');
      break;

    default:
      renderChildren(el, out, placeholders);
      break;
  }
}

function renderChildren(el: HTMLElement, out: string[], placeholders: string[]): void {
  for (const child of el.childNodes) {
    renderNode(child, out, placeholders);
  }
}

function wrapInline(el: HTMLElement, out: string[], placeholders: string[], token: string): void {
  const text = el.text;
  if (!text || text.trim().length === 0) return;
  out.push(token);
  renderChildren(el, out, placeholders);
  out.push(token);
}

function renderList(el: HTMLElement, out: string[], placeholders: string[], bullet: string | null): void {
  const items = el.childNodes.filter((n) => n.nodeType === 1 && (n as HTMLElement).rawTagName.toLowerCase() === 'li');

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as HTMLElement;
    const marker = bullet ? `${bullet} ` : `${i + 1}. `;
    out.push(marker);
    renderChildren(item, out, placeholders);
    if (i < items.length - 1) out.push('\n');
  }
  out.push('\n\n');
}

// ─── Normalization ───────────────────────────────────────────

/**
 * Collapses whitespace, trims paragraph edges and re-joins paragraphs
 * with exactly one blank line (\n\n) between them.
 */
function normalizeParagraphs(text: string): string {
  let t = text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+(?=\n)/g, '')
    .replace(/\n{3,}/g, '\n\n');

  const paragraphs = t.split(/\n{2,}/).map((p) => p.trim());

  return paragraphs.filter((p) => p.length > 0).join('\n\n');
}
