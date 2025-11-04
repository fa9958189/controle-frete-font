import { Buffer } from "node:buffer";

function escapeText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(line, maxChars) {
  const result = [];
  let current = "";
  const words = line.split(/\s+/);
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) result.push(current);
      if (word.length > maxChars) {
        for (let i = 0; i < word.length; i += maxChars) {
          result.push(word.slice(i, i + maxChars));
        }
        current = "";
      } else {
        current = word;
      }
    }
  });
  if (current) result.push(current);
  return result.length ? result : [" "];
}

function buildContentStream(lines, { fontSize, leading, marginLeft, startY, maxChars }) {
  const wrapped = lines.flatMap((line) => wrapLine(line, maxChars));
  const commands = [
    "BT",
    `/F1 ${fontSize} Tf`,
    `${leading} TL`,
    `1 0 0 1 ${marginLeft} ${startY} Tm`,
  ];

  wrapped.forEach((line, idx) => {
    const escaped = escapeText(line);
    if (idx === 0) {
      commands.push(`(${escaped}) Tj`);
    } else {
      commands.push("T*");
      commands.push(`(${escaped}) Tj`);
    }
  });

  commands.push("ET");
  return commands.join("\n");
}

function paginate(lines, linesPerPage) {
  if (!lines.length) return [[" "]];
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages;
}

export function createSimplePdf(lines, options = {}) {
  const {
    fontSize = 11,
    leading = 14,
    marginLeft = 50,
    marginTop = 40,
    pageWidth = 595,
    pageHeight = 842,
    maxCharsPerLine = 100,
  } = options;

  const usableHeight = pageHeight - marginTop * 2;
  const linesPerPage = Math.max(1, Math.floor(usableHeight / leading));
  const pagesLines = paginate(lines, linesPerPage);

  const objects = [];
  const catalogIndex = objects.push(null);
  const pagesIndex = objects.push(null);
  const fontIndex = objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObjectIndexes = [];

  pagesLines.forEach((pageLines) => {
    const startY = pageHeight - marginTop - fontSize;
    const content = buildContentStream(pageLines, {
      fontSize,
      leading,
      marginLeft,
      startY,
      maxChars: maxCharsPerLine,
    });
    const length = Buffer.byteLength(content, "utf8");
    const contentIndex = objects.push(
      `<< /Length ${length} >>\nstream\n${content}\nendstream`
    );
    const pageIndex = objects.push(
      `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /Font << /F1 ${fontIndex} 0 R >> >> /Contents ${contentIndex} 0 R >>`
    );
    pageObjectIndexes.push(pageIndex);
  });

  objects[pagesIndex - 1] = `<< /Type /Pages /Kids [${pageObjectIndexes
    .map((idx) => `${idx} 0 R`)
    .join(" ")}] /Count ${pageObjectIndexes.length} >>`;
  objects[catalogIndex - 1] = `<< /Type /Catalog /Pages ${pagesIndex} 0 R >>`;

  const header = "%PDF-1.4\n";
  let body = "";
  const offsets = [0];

  objects.forEach((obj, index) => {
    const objStr = `${index + 1} 0 obj\n${obj}\nendobj\n`;
    offsets.push(header.length + body.length);
    body += objStr;
  });

  const xrefStart = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogIndex} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "utf8");
}
