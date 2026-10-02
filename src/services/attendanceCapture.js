// Attendance-only selfie processing. No gallery or Activity edit dependencies.
export function checkSelfie(blob) {
  if (!blob || blob.type !== 'image/jpeg' || !blob.size || blob.size > 5242880) throw new Error('INVALID_SELFIE')
}
export function selfieError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return 'Camera permission was denied. Allow camera access in your browser, then try again.'
  if (error?.name === 'NotFoundError') return 'No camera was found. Connect a webcam or use a phone with a camera.'
  if (error?.name === 'NotReadableError') return 'The camera is busy or unavailable. Close other camera apps and try again.'
  return 'The camera could not capture a selfie. Use HTTPS or localhost, check camera access, and try again.'
}
export function createAttendanceCamera(mediaDevices, secure = true) {
  let stream = null, generation = 0
  const stop = () => { generation++; stream?.getTracks().forEach(track => track.stop()); stream = null }
  return {
    stop,
    async start() {
      stop(); const version = generation
      if (!secure || !mediaDevices?.getUserMedia) throw new Error('CAMERA_UNAVAILABLE')
      let result
      try { result = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false }) }
      catch (error) {
        if (version !== generation || error?.name !== 'OverconstrainedError') throw error
        result = await mediaDevices.getUserMedia({ video: true, audio: false })
      }
      if (version !== generation) { result.getTracks().forEach(track => track.stop()); return null }
      stream = result; return stream
    },
    async capture(video, documentObject = document) {
      const version = generation
      try {
        if (!stream || !video.videoWidth || !video.videoHeight) throw new Error('CAMERA_UNAVAILABLE')
        const canvas = documentObject.createElement('canvas')
        const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        // U4.4 may compose an approved watermark here before encoding.
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
        if (version !== generation) throw new Error('CAPTURE_CANCELLED')
        checkSelfie(blob); return blob
      } finally { if (version === generation) stop() }
    },
  }
}
