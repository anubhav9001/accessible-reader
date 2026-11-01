import { parseClock } from './clock.js';
import type { AudioRef, NarrationClip, TextRef } from './model.js';
import { resolveHref, resolvePath } from './paths.js';
import { attr, children, descendants, localName } from './xml.js';

/**
 * Flattens a SMIL document into narration clips. One parser covers EPUB 3 media overlays,
 * DAISY 3 and DAISY 2.02: all three are seq/par trees of <text> and <audio>, differing
 * mainly in attribute names (clipBegin vs clip-begin) and clock syntax.
 */
export function parseSmil(doc: Document, smilPath: string, firstIndex: number): NarrationClip[] {
  const clips: NarrationClip[] = [];
  // Ids of enclosing <seq> elements not yet attached to a clip; navigation may target them.
  const pendingIds: string[] = [];

  // A par with several separate audio clips becomes several clips sharing the same text.
  const emit = (text: TextRef | undefined, audios: AudioRef[], ids: string[]) => {
    if (audios.length === 0) {
      clips.push({ index: firstIndex + clips.length, text, smil: { path: smilPath, ids } });
      return;
    }
    audios.forEach((audio, i) => {
      clips.push({ index: firstIndex + clips.length, text, audio, smil: { path: smilPath, ids: i === 0 ? ids : [] } });
    });
  };

  const takeIds = (...own: (string | undefined)[]) =>
    pendingIds.splice(0).concat(own.filter((id): id is string => !!id));

  const handlePar = (par: Element) => {
    const textEl = descendants(par, 'text')[0];
    const src = textEl && attr(textEl, 'src');
    const text = src ? resolveHref(smilPath, src) : undefined;
    const audios = mergeContiguous(descendants(par, 'audio').flatMap((a) => audioRef(a, smilPath)));
    emit(text, audios, takeIds(attr(par, 'id'), textEl && attr(textEl, 'id')));
  };

  const walk = (parent: Element) => {
    for (const el of children(parent)) {
      switch (localName(el)) {
        case 'seq':
        case 'body': {
          const id = attr(el, 'id');
          if (id) pendingIds.push(id);
          walk(el);
          break;
        }
        case 'par':
          handlePar(el);
          break;
        case 'text': {
          const src = attr(el, 'src');
          emit(src ? resolveHref(smilPath, src) : undefined, [], takeIds(attr(el, 'id')));
          break;
        }
        case 'audio':
          emit(undefined, audioRef(el, smilPath), takeIds(attr(el, 'id')));
          break;
      }
    }
  };

  const body = descendants(doc, 'body')[0];
  if (body) {
    const id = attr(body, 'id');
    if (id) pendingIds.push(id);
    walk(body);
  }
  return clips;
}

function audioRef(el: Element, smilPath: string): AudioRef[] {
  const src = attr(el, 'src');
  if (!src) return [];
  return [
    {
      path: resolvePath(smilPath, src.split('#')[0]!),
      begin: parseClock(attr(el, 'clipBegin') ?? attr(el, 'clip-begin')) ?? 0,
      end: parseClock(attr(el, 'clipEnd') ?? attr(el, 'clip-end')),
    },
  ];
}

/** DAISY 2.02 often splits one phrase into back-to-back clips of the same file; join them. */
function mergeContiguous(audios: AudioRef[]): AudioRef[] {
  const out: AudioRef[] = [];
  for (const a of audios) {
    const prev = out[out.length - 1];
    if (prev && prev.path === a.path && prev.end !== undefined && Math.abs(prev.end - a.begin) < 0.001) {
      prev.end = a.end;
    } else {
      out.push({ ...a });
    }
  }
  return out;
}
