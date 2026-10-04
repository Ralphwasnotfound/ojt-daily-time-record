// Check the bundled font's actual Unicode cmap instead of silently printing missing glyphs.
export function pdfFontSupportsText(base64, text) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)), view = new DataView(bytes.buffer)
  let cmap = 0
  for (let i = 0; i < view.getUint16(4); i++) {
    const offset = 12 + i * 16
    if (String.fromCharCode(...bytes.slice(offset, offset + 4)) === 'cmap') cmap = view.getUint32(offset + 8)
  }
  if (!cmap) return false
  const tables = []
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const table = cmap + view.getUint32(cmap + 4 + i * 8 + 4), format = view.getUint16(table)
    if ([4, 12].includes(format)) tables.push({ table, format })
  }
  function supported(code) {
    for (const { table: t, format } of tables) {
      if (format === 12) {
        for (let i = 0; i < view.getUint32(t + 12); i++) {
          const p = t + 16 + i * 12, start = view.getUint32(p), end = view.getUint32(p + 4)
          if (code >= start && code <= end && view.getUint32(p + 8) + code - start !== 0) return true
        }
      } else if (code <= 65535) {
        const n = view.getUint16(t + 6) / 2, end = t + 14, start = end + n * 2 + 2, delta = start + n * 2, range = delta + n * 2
        for (let i = 0; i < n; i++) if (code >= view.getUint16(start + i * 2) && code <= view.getUint16(end + i * 2)) {
          const r = view.getUint16(range + i * 2), d = view.getInt16(delta + i * 2)
          const glyph = r ? view.getUint16(range + i * 2 + r + (code - view.getUint16(start + i * 2)) * 2) : code
          if (glyph && ((glyph + d) & 65535)) return true
        }
      }
    }
    return false
  }
  return [...new Set(text)].every(c => /[\n\r\t]/.test(c) || supported(c.codePointAt(0)))
}
