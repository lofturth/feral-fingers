const key = 'piano-trainer.keyboard-visible';
export function loadKeyboardVisibility(): boolean {
  try { return localStorage.getItem(key) !== 'false'; } catch { return true; }
}
export function saveKeyboardVisibility(visible: boolean): void {
  try { localStorage.setItem(key, String(visible)); } catch { /* Keep the session setting. */ }
}
