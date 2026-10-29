// OpenWAF Verify extension point: widget.src.js and worker.src.js import it as 'verify-ext'.
//
// A deployment can build the widget and the worker with its own module of this shape (build.mjs --ext <file>) to add
// data to the solve. This default adds nothing: the widget and the interstitial work the same without it.
//
//   report(scope)  runs in the Web Worker before the work; a string it returns is posted to the page as {nav} and
//                  reaches the session's nav (nothing is posted otherwise).
//   session(ch)    runs on the page when a challenge (the /start answer) is about to be solved, and returns
//                  {nav(s), activation(event), fields()}: nav gets the worker's report (undefined when solved on the
//                  page), activation the trusted event that ticked the verification box, and fields() the extra fields
//                  of the /solve body (an object, or undefined for none; called once, at the solve).
//   page           members added to globalThis.owafPow when worker.js runs as a classic script (the interstitial).

export function report() {}

export function session() {
  return {nav() {}, activation() {}, fields() {}};
}

export const page = {};
