/**
 * How long after a dialog opens focus moves into it (ms). Chromium tells screen readers about
 * focus moving into a dialog that has just been shown before its accessibility tree has the
 * dialog: at that moment the focused title is an unnamed element outside any dialog, which
 * Narrator reads as nothing. A moment later the tree has "Settings, dialog" and its heading.
 */
const SETTLE = 120;

/**
 * Shows a modal dialog and moves focus to `target` once screen readers can see the dialog, so
 * they say its title. The dialog takes focus itself first (it carries tabindex="-1"), keeping
 * the keyboard inside it meanwhile.
 */
export function openDialog(dialog: HTMLDialogElement, target: () => HTMLElement | null): void {
  if (!dialog.open) {
    dialog.tabIndex = -1;
    dialog.showModal();
    dialog.focus();
  }
  setTimeout(() => {
    if (!dialog.open) return;
    const el = target();
    // Not if the user has already moved on within the dialog.
    if (el && (document.activeElement === dialog || !dialog.contains(document.activeElement))) el.focus();
  }, SETTLE);
}
