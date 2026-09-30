import { PHOTO_TYPES, MAX_PHOTO_BYTES } from './supabaseActivityData.js'

export function checkPhoto(file) {
  if (!file) throw new Error('PROOF_REQUIRED')
  if (!PHOTO_TYPES.includes(file.type) || !file.size) throw new Error('INVALID_PROOF')
  if (file.size > MAX_PHOTO_BYTES) throw new Error('PHOTO_TOO_LARGE')
}
export async function validatePhoto(file, platform = { URL, Image }) {
  checkPhoto(file)
  const url = platform.URL.createObjectURL(file)
  try {
    await new Promise((resolve, reject) => {
      const image = new platform.Image()
      image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('PHOTO_DECODE_FAILED'))
      image.onerror = () => reject(new Error('PHOTO_DECODE_FAILED'))
      image.src = url
    })
    return file
  } finally { platform.URL.revokeObjectURL(url) }
}

export function cameraError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return 'Camera permission was denied. Allow camera access or choose a photo instead.'
  if (error?.name === 'NotFoundError') return 'No camera was found. You can choose a photo instead.'
  return 'The camera is unavailable. Use HTTPS or localhost and check camera access, or choose a photo instead.'
}
export function createActivityCamera(mediaDevices, secure = true) {
  let stream = null, generation = 0
  function stop() { generation++; stream?.getTracks().forEach(track => track.stop()); stream = null }
  return {
    stop,
    async start() {
      stop()
      const version = generation
      if (!secure || !mediaDevices?.getUserMedia) throw new Error('CAMERA_UNAVAILABLE')
      const result = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (version !== generation) { result.getTracks().forEach(track => track.stop()); return null }
      stream = result
      return stream
    },
    async capture(video, documentObject = document) {
      try {
        if (!stream || !video.videoWidth || !video.videoHeight) throw new Error('CAMERA_UNAVAILABLE')
        const canvas = documentObject.createElement('canvas')
        const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
        checkPhoto(blob)
        return blob
      } finally { stop() }
    },
  }
}
