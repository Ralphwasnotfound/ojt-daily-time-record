import { EXPORT_LIMITS } from './journalExportModel.js'
export async function convertJournalImage(blob, signal) {
  if (signal?.aborted) throw Error('EXPORT_CANCELLED')
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null; error ? reject(error) : resolve() }
      const abort = () => finish(Error('EXPORT_CANCELLED'))
      const timer = setTimeout(() => finish(Error('EXPORT_IMAGE_UNAVAILABLE')), 15000)
      signal?.addEventListener('abort', abort, { once: true })
      image.onload = () => finish(); image.onerror = () => finish(Error('EXPORT_IMAGE_UNAVAILABLE')); image.src = url
    })
    if (signal?.aborted) throw Error('EXPORT_CANCELLED')
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > EXPORT_LIMITS.imagePixels) throw Error('EXPORT_IMAGE_UNAVAILABLE')
    const scale = Math.min(1, EXPORT_LIMITS.imageEdge / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale)
    const context = canvas.getContext('2d'); if (!context) throw Error('EXPORT_IMAGE_UNAVAILABLE')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', 0.88)
    if (signal?.aborted) throw Error('EXPORT_CANCELLED')
    return { data, width: canvas.width, height: canvas.height, bytes: Math.ceil(data.length * 0.75) }
  } finally { URL.revokeObjectURL(url) }
}
