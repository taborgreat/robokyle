/* Action errors, shown where the user actually is: a fixed strip at the
   bottom of the viewport instead of a line scrolled away at the top of the
   page. Tap to dismiss; the next action clears it anyway. */
export default function ErrorBar({ error, onDismiss }) {
  if (!error) return null;
  return (
    <button type="button" className="error-float" role="alert" onClick={onDismiss}
            title="Dismiss">
      {error}
    </button>
  );
}
