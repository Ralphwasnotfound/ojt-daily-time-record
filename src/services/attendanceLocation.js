export function validAttendanceLocation(value) {
  return !!value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 &&
    Number.isFinite(value.accuracy) && value.accuracy >= 0
}
async function locationDenied(permissions) {
  const error = new Error('LOCATION_DENIED')
  error.permissionState = 'unknown'
  let timer
  try {
    // Advisory only: a site grant does not guarantee device location access.
    // Query fresh after each denial, without blocking geolocation or requiring
    // Permissions API support. Never retain a stale PermissionStatus/listener.
    const status = await Promise.race([
      Promise.resolve().then(() => permissions?.query?.({ name: 'geolocation' })),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 300) }),
    ])
    if (['granted', 'denied', 'prompt'].includes(status?.state)) error.permissionState = status.state
  } catch { /* Unsupported permission queries must not replace the actual error. */ }
  finally { clearTimeout(timer) }
  return error
}
export function getAttendanceLocation({ geolocation = globalThis.navigator?.geolocation, permissions = globalThis.navigator?.permissions, signal, now = Date.now, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, timer
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve(value)
    }
    const cancel = () => finish(new Error('LOCATION_CANCELLED'))
    if (signal?.aborted) return cancel()
    if (!geolocation?.getCurrentPosition) return finish(new Error('LOCATION_UNSUPPORTED'))
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => finish(new Error('LOCATION_TIMEOUT')), timeoutMs)
    try {
      geolocation.getCurrentPosition(position => {
        const coords = position?.coords
        const value = { latitude: coords?.latitude, longitude: coords?.longitude, accuracy: coords?.accuracy }
        // maximumAge=0 requests a new fix; also reject stale/future results.
        const age = now() - position?.timestamp
        if (!validAttendanceLocation(value) || !Number.isFinite(age) || age > 30000 || age < -5000) return finish(new Error('INVALID_LOCATION'))
        finish(null, Object.freeze(value))
      }, error => {
        if (settled) return
        if (error?.code === 1) {
          // The native request has completed; bound optional diagnosis separately.
          clearTimeout(timer)
          void locationDenied(permissions).then(denied => finish(denied))
        } else finish(new Error(({ 2: 'LOCATION_UNAVAILABLE', 3: 'LOCATION_TIMEOUT' })[error?.code] || 'LOCATION_UNAVAILABLE'))
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 })
    } catch { finish(new Error('LOCATION_UNAVAILABLE')) }
  })
}
