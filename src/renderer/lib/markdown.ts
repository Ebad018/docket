import { Marked } from 'marked';

/**
 * Markdown rendered locally, then scrubbed.
 *
 * The preview is generated from a file on the user's disk and injected into
 * the same document as the application. A .md file is untrusted input, so
 * anything that could execute — script, event handlers, javascript: URLs,
 * embedded objects — is removed before it reaches the DOM. The CSP is the
 * second line of defence, not the first.
 */

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false
});

const ALLOWED_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'sub', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  input: new Set(['type', 'checked', 'disabled']),
  th: new Set(['align', 'colspan', 'rowspan']),
  td: new Set(['align', 'colspan', 'rowspan']),
  ol: new Set(['start'])
};

const SAFE_URL = /^(https?:|mailto:|tel:|file:|#|\/|\.\/|\.\.\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i;

export const renderMarkdown = (source: string): string => sanitiseHtml(marked.parse(source) as string);

/** Also used for the Word renderer's output — same untrusted-input argument
 *  applies to HTML generated from a .docx the user did not write. */
export const sanitiseHtml = (html: string): string => {
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitise(template.content);
  return template.innerHTML;
};

const sanitise = (root: ParentNode): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const doomed: Element[] = [];

  while (walker.nextNode()) {
    const element = walker.currentNode as Element;
    const tag = element.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      doomed.push(element);
      continue;
    }

    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const permitted = ALLOWED_ATTRIBUTES[tag];
      if (!permitted?.has(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === 'href' || name === 'src') && !SAFE_URL.test(attribute.value.trim())) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag === 'a') {
      element.setAttribute('rel', 'noreferrer noopener');
      element.setAttribute('target', '_blank');
    }
    if (tag === 'input') {
      // GFM task lists only. Everything else is stripped to a checkbox.
      element.setAttribute('type', 'checkbox');
      element.setAttribute('disabled', '');
    }
  }

  // Unwrap rather than delete, so a disallowed wrapper does not silently eat
  // the text inside it.
  for (const element of doomed) {
    if (element.tagName.toLowerCase() === 'script' || element.tagName.toLowerCase() === 'style') {
      element.remove();
    } else {
      element.replaceWith(...element.childNodes);
    }
  }
};

export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

/** Outline for the status line and the palette's "jump to heading". */
export const outline = (source: string): Heading[] => {
  const headings: Heading[] = [];
  let inFence = false;

  source.split(/\r?\n/).forEach((line, index) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: index });
    }
  });

  return headings;
};

export const wordCount = (source: string): number => {
  const stripped = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_~\-|]/g, ' ');
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
};
