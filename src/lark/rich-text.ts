const MAX_REPLY_LEN = 4000;
const CARD_THRESHOLD = 200;
const MD_PATTERN =
  /(^#{1,3}\s|^\-{3,}$|^\*{3,}$|\*\*.*\*\*|\[.*\]\(.*\)|^- |^>\s)/m;
const TABLE_SEPARATOR_RE = /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?\s*$/;
const TABLE_ROW_RE = /^\|.+\|/;

export function splitText(text: string, limit = MAX_REPLY_LEN): string[] {
  if (text.length <= limit) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) {
      cut = limit;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  return chunks;
}

function hasMarkdownStructure(text: string): boolean {
  return MD_PATTERN.test(text);
}

export function shouldUseCard(text: string): boolean {
  return text.length > CARD_THRESHOLD || text.trim().includes("\n") || hasMarkdownStructure(text);
}

function splitMarkdown(content: string, maxLen = 3800): string[] {
  if (content.length <= maxLen) {
    return [content];
  }

  const chunks: string[] = [];
  const paragraphs = content.split("\n\n");
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxLen) {
      if (current) {
        chunks.push(current);
      }
      if (paragraph.length > maxLen) {
        let remaining = paragraph;
        while (remaining.length > 0) {
          chunks.push(remaining.slice(0, maxLen));
          remaining = remaining.slice(maxLen);
        }
        current = "";
      } else {
        current = paragraph;
      }
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function parseTableRow(line: string): string[] {
  let cells = line.split("|");
  if (cells[0] && !cells[0].trim()) {
    cells = cells.slice(1);
  }
  if (cells.length > 0 && !cells[cells.length - 1]!.trim()) {
    cells = cells.slice(0, -1);
  }
  return cells.map((cell) => cell.trim());
}

function tableToList(headerCells: string[], dataRows: string[][]): string[] {
  return dataRows
    .map((row) => {
      const parts = row
        .map((cell, index) => {
          const key = headerCells[index] ?? "";
          if (key && cell) {
            return `**${key}**: ${cell}`;
          }
          return cell;
        })
        .filter(Boolean);
      return parts.length > 0 ? `- ${parts.join(" · ")}` : "";
    })
    .filter(Boolean);
}

export function markdownToCard(text: string): Record<string, unknown> {
  const elements: Array<Record<string, string>> = [];
  const currentLines: string[] = [];
  let tableCount = 0;

  const flush = () => {
    const block = currentLines.join("\n").trim();
    currentLines.length = 0;
    if (!block) {
      return;
    }
    for (const chunk of splitMarkdown(block)) {
      elements.push({ tag: "markdown", content: chunk });
    }
  };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const stripped = line.trim();

    if (stripped === "---" || stripped === "***" || stripped === "___") {
      flush();
      if (elements[elements.length - 1]?.tag !== "hr") {
        elements.push({ tag: "hr" });
      }
      i += 1;
      continue;
    }

    if (TABLE_SEPARATOR_RE.test(stripped)) {
      const headerLine = currentLines.pop() ?? "";
      const headerCells = headerLine ? parseTableRow(headerLine) : [];
      const dataRows: string[][] = [];
      i += 1;
      while (i < lines.length && TABLE_ROW_RE.test(lines[i]!.trim())) {
        dataRows.push(parseTableRow(lines[i]!.trim()));
        i += 1;
      }
      tableCount += 1;
      if (tableCount <= 3) {
        currentLines.push(headerLine);
        currentLines.push(stripped);
        for (const row of dataRows) {
          currentLines.push(`| ${row.join(" | ")} |`);
        }
      } else {
        currentLines.push(...tableToList(headerCells, dataRows));
      }
      continue;
    }

    currentLines.push(line);
    i += 1;
  }
  flush();

  const title = text
    .trim()
    .split("\n")[0]
    ?.replace(/^#+\s*/, "")
    .trim()
    .slice(0, 30) || "回复";

  return {
    schema: "2.0",
    header: {
      title: {
        tag: "plain_text",
        content: title
      },
      template: "indigo"
    },
    body: {
      elements
    }
  };
}
