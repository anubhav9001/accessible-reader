import { openDialog } from './open-dialog';

const STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/**
 * Enlarging a picture (DAISY Must-have "enlarge images"): clicking a picture in the book text opens
 * it in a window of its own, as large as fits the window, with Larger and Smaller (Ctrl+= and Ctrl+-)
 * and Fit the window (Ctrl+0); the frame scrolls when the picture is larger than the window.
 */
export function usePictureViewer(text: HTMLElement): void {
  const dialog = document.getElementById('ui-picture') as HTMLDialogElement;
  const img = document.getElementById('ui-picture-img') as HTMLImageElement;
  const frame = document.getElementById('ui-picture-frame')!;
  const caption = document.getElementById('ui-picture-caption')!;
  let zoom = 0; // 0: fit the window; otherwise times the picture's own size.

  const show = () => {
    if (!zoom) {
      // As large as fits, small pictures too, keeping their shape.
      Object.assign(img.style, { width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', flexShrink: '1' });
    } else {
      Object.assign(img.style, { width: `${Math.round(img.naturalWidth * zoom)}px`, height: 'auto', maxWidth: 'none', maxHeight: 'none', flexShrink: '0' });
    }
  };
  const step = (direction: 1 | -1) => {
    // From "fit", the first step is relative to the size it was fitted to.
    const now = zoom || Math.min(img.clientWidth / Math.max(1, img.naturalWidth), img.clientHeight / Math.max(1, img.naturalHeight));
    zoom = direction > 0 ? STEPS.find((s) => s > now + 0.01) ?? STEPS.at(-1)! : [...STEPS].reverse().find((s) => s < now - 0.01) ?? STEPS[0]!;
    show();
  };

  text.addEventListener('click', (event) => {
    const picture = (event.target as Element).closest('img, image');
    if (!picture || picture.closest('a[href]')) return;
    const src = picture instanceof HTMLImageElement ? picture.currentSrc || picture.src : picture.getAttribute('href') ?? '';
    if (!src) return;
    event.preventDefault();
    img.src = src;
    const alt = picture.getAttribute('alt')?.trim() || picture.getAttribute('aria-label')?.trim() || '';
    img.alt = alt;
    caption.textContent = alt || 'This picture has no description.';
    zoom = 0;
    show();
    openDialog(dialog, () => document.getElementById('ui-picture-title'));
  });
  document.getElementById('ui-picture-in')!.addEventListener('click', () => step(1));
  document.getElementById('ui-picture-out')!.addEventListener('click', () => step(-1));
  document.getElementById('ui-picture-fit')!.addEventListener('click', () => {
    zoom = 0;
    show();
  });
  dialog.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === '=' || e.key === '+') step(1);
    else if (e.key === '-') step(-1);
    else if (e.key === '0') {
      zoom = 0;
      show();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  frame.tabIndex = 0;
  frame.setAttribute('role', 'region');
  frame.setAttribute('aria-label', 'Picture; scroll with the arrow keys');
}
