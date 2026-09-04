/**
 * Sitemap Parser Module
 * Parses markdown sitemaps into a hierarchical tree of nodes.
 *
 * Supports both:
 * 1. Indented Markdown (e.g. static sitemap.md with 2-space indentation)
 * 2. Unindented Markdown with URL path hierarchy (e.g. live GitBook llms.txt)
 *
 * Each node has the structure: { title: string, url: string, children: Array }
 */

function parseSitemap(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];

  const lines = markdown.split('\n');
  const root = [];
  const stack = [{ children: root, level: -1 }];
  const linkRegex = /^\s*-\s*\[([^\]]+)\]\(([^)]+)\)/;

  // Check if bullet points use indentation (e.g. sitemap.md)
  const hasIndentation = lines.some((l) => /^ {2,}-\s*\[/.test(l));

  for (const line of lines) {
    const match = line.match(linkRegex);
    if (!match) continue;
    const title = match[1].trim();
    const url = match[2].trim();

    let level;
    if (hasIndentation) {
      const leadingSpaces = (line.match(/^(\s*)/)[1] || '').length;
      level = Math.floor(leadingSpaces / 2);
    } else {
      // Derive level from URL path segments relative to the base space
      const withoutDomain = url.replace(/^https?:\/\/[^\/]+\/[^\/]+\/?/, '').replace(/\.md$/, '');
      const segments = withoutDomain.split('/').filter(Boolean);
      level = Math.max(0, segments.length - 1);
    }

    const node = { title, url, children: [] };

    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push({ children: node.children, level });
  }

  return root;
}

module.exports = { parseSitemap };
