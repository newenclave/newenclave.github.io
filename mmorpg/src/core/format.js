// 754 -> "12:34"
export function mmss(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Splits text into lines no wider than maxWidth in the context's current font.
export function wrapText(ctx, text, maxWidth) {
  if (text.includes('\n')) return text.split('\n').flatMap((part) => (part ? wrapText(ctx, part, maxWidth) : [''])); // paragraphs
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
