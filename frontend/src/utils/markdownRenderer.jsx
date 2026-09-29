import React from "react";

/**
 * Lightweight, robust Markdown renderer for AI Chatbot responses.
 * Renders headings, bold, code blocks, lists, and formatted HTML tables.
 */
export function renderMarkdown(content) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let tableBuffer = [];

  const flushTable = (key) => {
    if (tableBuffer.length === 0) return null;
    const rows = tableBuffer.filter((line) => line.trim().startsWith("|"));
    tableBuffer = [];
    if (rows.length < 2) return null;

    // Split cells
    const parseRow = (rowStr) =>
      rowStr
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

    const headerCells = parseRow(rows[0]);
    const bodyRows = rows.slice(2).map(parseRow);

    return (
      <div key={`table-${key}`} className="overflow-x-auto my-3">
        <table>
          <thead>
            <tr>
              {headerCells.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((r, rowIdx) => (
              <tr key={rowIdx}>
                {r.map((cell, colIdx) => (
                  <td key={colIdx}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`}>
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Markdown Tables
    if (line.trim().startsWith("|")) {
      tableBuffer.push(line);
      continue;
    } else if (tableBuffer.length > 0) {
      const tableElem = flushTable(i);
      if (tableElem) elements.push(tableElem);
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i}>{formatInline(line.replace("### ", ""))}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i}>{formatInline(line.replace("## ", ""))}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i}>{formatInline(line.replace("# ", ""))}</h1>);
    }
    // Lists
    else if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      elements.push(
        <ul key={i}>
          <li>{formatInline(line.trim().substring(2))}</li>
        </ul>
      );
    } else if (/^\d+\.\s/.test(line.trim())) {
      elements.push(
        <ol key={i}>
          <li>{formatInline(line.trim().replace(/^\d+\.\s/, ""))}</li>
        </ol>
      );
    }
    // Empty line
    else if (!line.trim()) {
      elements.push(<div key={i} className="h-1.5" />);
    }
    // Normal paragraph
    else {
      elements.push(<p key={i}>{formatInline(line)}</p>);
    }
  }

  if (tableBuffer.length > 0) {
    const tableElem = flushTable(lines.length);
    if (tableElem) elements.push(tableElem);
  }

  return <div className="md-content">{elements}</div>;
}

function formatInline(text) {
  // Regex to format **bold**, `code`, and *italic*
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}
