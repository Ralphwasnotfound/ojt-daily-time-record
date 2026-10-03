# U5.2 attendance proof photo presentation

Student and Admin share `AttendanceProofPhoto` through `AttendanceProofViewer`.
The CSS strip is presentation-only. It never changes the original private selfie,
Blob, Storage path or finalized proof metadata. It is not a cryptographic signature
or an independent authenticity guarantee.

Both the strip and detailed card use the same `formatProof` result, derived from
finalized `official_punch_at` in Asia/Manila, including seconds. Session 1/2 comes
from the existing server-derived ordinal for the complete Manila Time In day.
No viewing/capture timestamp or independent session calculation is introduced.

An intrinsic-size image wrapper keeps the strip within the displayed image bounds
without cropping. Inspect original hides only the strip; Return to evidence view
restores it. Neither changes the image source nor fetches or creates another URL.
The toggle resets when the photo changes or the viewer closes/reloads.

The original details, historical proofless state, retry and private URL cleanup
remain unchanged. Readable addresses/reverse geocoding are deferred to U5.3;
export, Canvas, print and PDF are outside this phase.

U5.3 adds an independent approximate-location section below the photo; see
[u5-attendance-proof-location.md](u5-attendance-proof-location.md). It never changes
watermark content, official timestamp, original selfie or Inspect original behavior.
