import type { BrowserWindow } from 'electron';
import type { AppLog } from './log';

/**
 * Screen reader mode's text box as a native Windows rich edit control, placed over the page
 * where the web text box would be. Screen readers read a native edit control directly, as in
 * Paperback: Narrator's questions take a few milliseconds even with a whole book in it, where
 * the web text box took over a second with 20,000 characters. So the whole book goes in, and
 * nothing has to move on as the reader goes.
 *
 * The page stays in charge: it sends the text, the cursor, where the box goes and its colours,
 * and gets back the cursor, Reader's own keys (H, T, K…), Tab, and the menu bar keys. Shortcut
 * keys (Ctrl+O, F1…) run their menu items here. Arrow keys, Home, End and the Page keys are
 * the control's own, so the screen reader hears them exactly as in any Windows text box.
 */

export interface NativeBoxEvents {
  caret(offset: number): void;
  key(key: { key: string; code: string; shift: boolean; caret: number }): void;
  tab(shift: boolean): void;
  menu(letter: string | undefined): void;
  focus(focused: boolean): void;
}

type Koffi = typeof import('koffi');

const WM_SETFOCUS = 0x0007, WM_KILLFOCUS = 0x0008, WM_SETTEXT = 0x000c, WM_GETDLGCODE = 0x0087;
const WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_CHAR = 0x0102, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105, WM_SYSCHAR = 0x0106;
const WM_LBUTTONUP = 0x0202, WM_NCDESTROY = 0x0082;
const EM_SCROLLCARET = 0x00b7, EM_EXGETSEL = 0x0434, EM_EXLIMITTEXT = 0x0435, EM_EXSETSEL = 0x0437, EM_SETBKGNDCOLOR = 0x0443;
const EM_SETCHARFORMAT = 0x0444, EM_GETTEXTLENGTHEX = 0x045f;
const WS_CHILD = 0x40000000, WS_VSCROLL = 0x00200000, WS_TABSTOP = 0x00010000, WS_CLIPSIBLINGS = 0x04000000;
const ES_MULTILINE = 0x4, ES_NOOLEDRAGDROP = 0x8, ES_AUTOVSCROLL = 0x40, ES_NOHIDESEL = 0x100;
// Messages that would change the text, all refused (the box is editable only so screen readers
// treat it as text to move through; see create()).
const EDITS = new Set([0x0300 /* WM_CUT */, 0x0302 /* WM_PASTE */, 0x0303 /* WM_CLEAR */, 0x0304 /* WM_UNDO */, 0x00c7 /* EM_UNDO */, 0x0454 /* EM_REDO */, 0x0286 /* WM_IME_CHAR */, 0x010f /* WM_IME_COMPOSITION */, 0x0109 /* WM_UNICHAR */]);
const SW_HIDE = 0, SW_SHOWNA = 8, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
const VK = { TAB: 0x09, RETURN: 0x0d, SHIFT: 0x10, CONTROL: 0x11, MENU: 0x12, SPACE: 0x20, F10: 0x79 };
const CFM_SIZE = 0x80000000, CFM_FACE = 0x20000000, CFM_COLOR = 0x40000000, SCF_ALL = 0x4, SCF_DEFAULT = 0x0;
const DLGC_WANTALLKEYS = 0x4;

/** Reader's own keys in the text box (see plain-reader.ts): key code to the page's key name. */
function readerKey(vk: number, shift: boolean): { key: string; code: string } | undefined {
  if ('HPKTLIGFS'.includes(String.fromCharCode(vk)) && vk >= 0x41 && vk <= 0x5a) {
    const letter = String.fromCharCode(vk);
    return { key: shift ? letter : letter.toLowerCase(), code: `Key${letter}` };
  }
  if (vk >= 0x31 && vk <= 0x36) return { key: String.fromCharCode(vk), code: `Digit${String.fromCharCode(vk)}` };
  switch (vk) {
    case 0xdb: return { key: '[', code: 'BracketLeft' };
    case 0xdd: return { key: ']', code: 'BracketRight' };
    case 0xbb: return { key: '=', code: 'Equal' };
    case 0xbe: return { key: shift ? '>' : '.', code: 'Period' };
    case VK.RETURN: return { key: 'Enter', code: 'Enter' };
    case VK.SPACE: return { key: ' ', code: 'Space' };
  }
  return undefined;
}

/** A key as an accelerator string in the menu's own spelling, lower case ("ctrl+shift+r"). */
function acceleratorOf(vk: number, ctrl: boolean, alt: boolean, shift: boolean): string | undefined {
  let name: string | undefined;
  if (vk >= 0x41 && vk <= 0x5a) name = String.fromCharCode(vk).toLowerCase();
  else if (vk >= 0x30 && vk <= 0x39) name = String.fromCharCode(vk);
  else if (vk >= 0x70 && vk <= 0x7b) name = `f${vk - 0x6f}`;
  else
    name = ({ 0x21: 'pageup', 0x22: 'pagedown', 0x25: 'left', 0x26: 'up', 0x27: 'right', 0x28: 'down', 0x20: 'space', 0xbc: ',', 0xdb: '[', 0xdd: ']', 0xbb: 'plus', 0xbd: '-' } as Record<number, string>)[vk];
  if (!name) return undefined;
  return [ctrl && 'ctrl', alt && 'alt', shift && 'shift', name].filter(Boolean).join('+');
}

export class NativeBox {
  private k: Koffi;
  private api: ReturnType<NativeBox['bind']>;
  private hwnd: unknown;
  private provider: unknown;
  private altAlone = false;
  private subclass: unknown;
  private text = '';
  private lastStyle: [string, string, string, number] | undefined;
  focused = false;
  /** Whether the box should have the keyboard when the window is active. */
  wanted = false;

  private constructor(
    private readonly window: BrowserWindow,
    private readonly events: NativeBoxEvents,
    private readonly accelerators: (accelerator: string) => (() => void) | undefined,
    private readonly log: AppLog,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.k = require('koffi') as Koffi;
    this.api = this.bind();
    this.create();
  }

  /** The native box, or undefined where it can't be made (not Windows, or the library failed). */
  static create(window: BrowserWindow, events: NativeBoxEvents, accelerators: (a: string) => (() => void) | undefined, log: AppLog): NativeBox | undefined {
    if (process.platform !== 'win32') return undefined;
    try {
      return new NativeBox(window, events, accelerators, log);
    } catch (err) {
      log.error('native', `Native text box unavailable: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return undefined;
    }
  }

  private bind() {
    const k = this.k;
    const user32 = k.load('user32.dll');
    const comctl32 = k.load('comctl32.dll');
    const kernel32 = k.load('kernel32.dll');
    const uia = k.load('uiautomationcore.dll');
    const oleaut32 = k.load('oleaut32.dll');
    const CHARRANGE = k.struct('READER_CHARRANGE', { cpMin: 'int32', cpMax: 'int32' });
    const GETTEXTLENGTHEX = k.struct('READER_GETTEXTLENGTHEX', { flags: 'uint32', codepage: 'uint32' });
    const CHARFORMATW = k.struct('READER_CHARFORMATW', {
      cbSize: 'uint32', dwMask: 'uint32', dwEffects: 'uint32', yHeight: 'int32', yOffset: 'int32', crTextColor: 'uint32',
      bCharSet: 'uint8', bPitchAndFamily: 'uint8', szFaceName: k.array('uint16', 32),
    });
    const GUID = k.struct('READER_GUID', { a: 'uint32', b: 'uint16', c: 'uint16', d: k.array('uint8', 8) });
    const SetHwndPropStr = k.proto('int32 __stdcall READER_SetHwndPropStr(void* self, void* hwnd, uint32 idObject, uint32 idChild, READER_GUID prop, str16 value)');
    const SUBCLASSPROC = k.proto('intptr __stdcall READER_SUBCLASSPROC(void* hwnd, uint32 msg, uintptr wParam, intptr lParam, uintptr id, uintptr ref)');
    kernel32.func('void* __stdcall LoadLibraryW(str16 name)')('Msftedit.dll');
    const ole32 = k.load('ole32.dll');
    const uxtheme = k.load('uxtheme.dll');
    return {
      GUID,
      SetHwndPropStr,
      SetWindowTheme: uxtheme.func('int32 __stdcall SetWindowTheme(void* hwnd, str16 app, str16 idList)'),
      CoCreateInstance: ole32.func('int32 __stdcall CoCreateInstance(READER_GUID* clsid, void* outer, uint32 ctx, READER_GUID* iid, _Out_ void** out)'),
      CHARFORMATW,
      SUBCLASSPROC,
      CreateWindowExW: user32.func('void* __stdcall CreateWindowExW(uint32 ex, str16 cls, str16 name, uint32 style, int x, int y, int w, int h, void* parent, void* menu, void* inst, void* param)'),
      DestroyWindow: user32.func('int __stdcall DestroyWindow(void* hwnd)'),
      SendMessageW: user32.func('intptr __stdcall SendMessageW(void* hwnd, uint32 msg, uintptr w, intptr l)'),
      SendText: user32.func('intptr __stdcall SendMessageW(void* hwnd, uint32 msg, uintptr w, str16 l)'),
      SendRange: user32.func('intptr __stdcall SendMessageW(void* hwnd, uint32 msg, uintptr w, _Inout_ READER_CHARRANGE* l)'),
      SendLength: user32.func('intptr __stdcall SendMessageW(void* hwnd, uint32 msg, _In_ READER_GETTEXTLENGTHEX* w, intptr l)'),
      SendFormat: user32.func('intptr __stdcall SendMessageW(void* hwnd, uint32 msg, uintptr w, _In_ READER_CHARFORMATW* l)'),
      SetWindowPos: user32.func('int __stdcall SetWindowPos(void* hwnd, void* after, int x, int y, int w, int h, uint32 flags)'),
      ShowWindow: user32.func('int __stdcall ShowWindow(void* hwnd, int cmd)'),
      SetLayeredWindowAttributes: user32.func('int __stdcall SetLayeredWindowAttributes(void* hwnd, uint32 key, uint8 alpha, uint32 flags)'),
      SetFocus: user32.func('void* __stdcall SetFocus(void* hwnd)'),
      GetFocus: user32.func('void* __stdcall GetFocus()'),
      GetKeyState: user32.func('int16 __stdcall GetKeyState(int vk)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(uintptr hwnd, _Out_ uint16* name, int max)'),
      SetWindowSubclass: comctl32.func('int __stdcall SetWindowSubclass(void* hwnd, READER_SUBCLASSPROC* proc, uintptr id, uintptr ref)'),
      RemoveWindowSubclass: comctl32.func('int __stdcall RemoveWindowSubclass(void* hwnd, READER_SUBCLASSPROC* proc, uintptr id)'),
      DefSubclassProc: comctl32.func('intptr __stdcall DefSubclassProc(void* hwnd, uint32 msg, uintptr w, intptr l)'),
      UiaHostProviderFromHwnd: uia.func('int32 __stdcall UiaHostProviderFromHwnd(void* hwnd, _Out_ void** provider)'),
      UiaRaiseNotificationEvent: uia.func('int32 __stdcall UiaRaiseNotificationEvent(void* provider, int kind, int processing, void* text, void* activity)'),
      SysAllocString: oleaut32.func('void* __stdcall SysAllocString(str16 s)'),
      SysFreeString: oleaut32.func('void __stdcall SysFreeString(void* s)'),
      CHARRANGE,
      GETTEXTLENGTHEX,
    };
  }

  private create(): void {
    const { k, api } = this;
    const parent = k.decode(this.window.getNativeWindowHandle(), 'void*');
    // Layered (WS_EX_LAYERED): Chromium's window has no drawing surface of its own for child
    // windows (WS_EX_NOREDIRECTIONBITMAP), so an ordinary child window would never show its text.
    this.hwnd = api.CreateWindowExW(0x80000, 'RICHEDIT50W', 'Book text',
      // Not read-only: Narrator keeps scan mode on in read-only text, catching the arrow keys,
      // and turns it off in editable text, as in Word. Every change is refused in onMessage.
      WS_CHILD | WS_VSCROLL | WS_TABSTOP | WS_CLIPSIBLINGS | ES_MULTILINE | ES_NOOLEDRAGDROP | ES_AUTOVSCROLL | ES_NOHIDESEL,
      0, 0, 10, 10, parent, null, null, null);
    if (!this.hwnd) throw new Error('CreateWindowExW failed');
    api.SetLayeredWindowAttributes(this.hwnd, 0, 255, 2 /* LWA_ALPHA */);
    api.SendMessageW(this.hwnd, EM_EXLIMITTEXT, 0, 0x7fffffff);
    this.subclass = k.register((hwnd: unknown, msg: number, w: number | bigint, l: number | bigint) => this.onMessage(hwnd, msg, Number(w), l), k.pointer(api.SUBCLASSPROC));
    api.SetWindowSubclass(this.hwnd, this.subclass, 1, 0);
    const out = [null];
    if (api.UiaHostProviderFromHwnd(this.hwnd, out) === 0) this.provider = out[0];
    this.nameBox('Book text');
    this.log.info('native', 'Native text box ready.');
  }

  /** Gives the box an accessible name (it would otherwise be "RichEdit Control"), through Dynamic Annotation. */
  private nameBox(name: string): void {
    const k = this.k;
    // Rich edit's own UI Automation name (EM_SETUIANAME), which Narrator reads.
    this.api.SendText(this.hwnd, 0x0540, 0, name);
    const guid = (s: string) => {
      const h = s.replace(/[{}-]/g, '');
      return { a: parseInt(h.slice(0, 8), 16), b: parseInt(h.slice(8, 12), 16), c: parseInt(h.slice(12, 16), 16), d: Array.from({ length: 8 }, (_, i) => parseInt(h.slice(16 + i * 2, 18 + i * 2), 16)) };
    };
    try {
      const out = [null];
      const hr = this.api.CoCreateInstance(guid('b5f8350b-0548-48b1-a6ee-88bd00b4a5e7'), null, 1, guid('6e26e776-04f0-495d-80e4-3330352e3169'), out);
      if (hr !== 0 || !out[0]) throw new Error(`CoCreateInstance ${hr}`);
      const services = out[0];
      const vtable = k.decode(services, 'void*');
      const setStr = k.decode(vtable, k.array('void*', 8))[7];
      // MSAA name (PROPID_ACC_NAME) and UI Automation name (Name_Property_GUID), on OBJID_CLIENT.
      for (const prop of ['608d3df8-8128-4aa7-a428-f55e49267291', 'c3a6921b-4a99-44f1-bca6-61187052c431']) {
        const r = k.call(setStr, this.api.SetHwndPropStr, services, this.hwnd, 0xfffffffc, 0, guid(prop), name);
        if (r !== 0) this.log.info('native', `Naming the box (${prop.slice(0, 8)}): ${r}`);
      }
    } catch (err) {
      this.log.error('native', `Could not name the box: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Puts the book's text in (line breaks as paragraph breaks, one character each). */
  setText(text: string): void {
    this.text = text;
    this.api.SendText(this.hwnd, WM_SETTEXT, 0, text);
    if (this.lastStyle) this.style(...this.lastStyle);
    const length = Number(this.api.SendLength(this.hwnd, EM_GETTEXTLENGTHEX, { flags: 0x8 /* GTL_NUMCHARS */ | 0x4 /* GTL_PRECISE */, codepage: 1200 }, 0));
    if (length !== text.length) this.log.error('native', `Text length differs: box ${length}, book ${text.length}`);
  }

  get caret(): number {
    const range = { cpMin: 0, cpMax: 0 };
    this.api.SendRange(this.hwnd, EM_EXGETSEL, 0, range);
    return range.cpMin;
  }

  setCaret(offset: number): void {
    const at = Math.max(0, Math.min(offset, this.text.length));
    this.api.SendRange(this.hwnd, EM_EXSETSEL, 0, { cpMin: at, cpMax: at });
    this.api.SendMessageW(this.hwnd, EM_SCROLLCARET, 0, 0);
  }

  /** Where the box goes, in the window's pixels, or hidden. */
  layout(visible: boolean, x: number, y: number, w: number, h: number): void {
    if (!visible || w <= 0 || h <= 0) {
      this.api.ShowWindow(this.hwnd, SW_HIDE);
      return;
    }
    // HWND_TOP (0): above the page's own window.
    this.api.SetWindowPos(this.hwnd, null, Math.round(x), Math.round(y), Math.round(w), Math.round(h), SWP_NOACTIVATE | SWP_SHOWWINDOW);
    this.api.ShowWindow(this.hwnd, SW_SHOWNA);
  }

  /** Text and background colours (#rrggbb), font face and size in points. */
  style(fg: string, bg: string, face: string, points: number): void {
    this.lastStyle = [fg, bg, face, points];
    const colorref = (hex: string) => {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
      return m ? parseInt(m[1]!, 16) | (parseInt(m[2]!, 16) << 8) | (parseInt(m[3]!, 16) << 16) : 0;
    };
    this.api.SendMessageW(this.hwnd, EM_SETBKGNDCOLOR, 0, colorref(bg));
    // A dark scroll bar on a dark page.
    const b = colorref(bg);
    const dark = (b & 0xff) + ((b >> 8) & 0xff) + ((b >> 16) & 0xff) < 3 * 128;
    this.api.SetWindowTheme(this.hwnd, dark ? 'DarkMode_Explorer' : 'Explorer', null);
    const name = Array.from({ length: 32 }, (_, i) => (i < face.length ? face.charCodeAt(i) : 0));
    const format = {
      cbSize: 92, dwMask: CFM_COLOR | CFM_FACE | CFM_SIZE, dwEffects: 0, yHeight: Math.round(points * 20), yOffset: 0,
      crTextColor: colorref(fg), bCharSet: 1, bPitchAndFamily: 0, szFaceName: name,
    };
    // The default format (for text put in later) and all the text there is now.
    this.api.SendFormat(this.hwnd, EM_SETCHARFORMAT, SCF_DEFAULT, format);
    this.api.SendFormat(this.hwnd, EM_SETCHARFORMAT, SCF_ALL, format);
  }

  focus(): void {
    this.wanted = true;
    this.api.SetFocus(this.hwnd);
  }

  /** Speaks a message through the screen reader (a UI Automation notification from the box). */
  say(message: string): void {
    if (!this.provider) return;
    const text = this.api.SysAllocString(message);
    const activity = this.api.SysAllocString('ReaderMessage');
    // NotificationKind_Other (4), NotificationProcessing_ImportantMostRecent (1).
    this.api.UiaRaiseNotificationEvent(this.provider, 4, 1, text, activity);
    this.api.SysFreeString(text);
    this.api.SysFreeString(activity);
  }

  destroy(): void {
    if (!this.hwnd) return;
    this.api.RemoveWindowSubclass(this.hwnd, this.subclass, 1);
    this.api.DestroyWindow(this.hwnd);
    this.hwnd = undefined;
  }

  private down(vk: number): boolean {
    return (this.api.GetKeyState(vk) & 0x8000) !== 0;
  }

  private onMessage(hwnd: unknown, msg: number, w: number, l: number | bigint): number | bigint {
    const pass = () => this.api.DefSubclassProc(hwnd, msg, w, l);
    try {
      if (EDITS.has(msg)) return 0;
      switch (msg) {
        case WM_GETDLGCODE:
          return Number(pass()) | DLGC_WANTALLKEYS;
        case WM_SETFOCUS:
        case WM_KILLFOCUS: {
          this.focused = msg === WM_SETFOCUS;
          if (this.focused) this.wanted = true;
          let other = '';
          if (!this.focused && w) {
            const buf = new Uint16Array(64);
            const n = this.api.GetClassNameW(w, buf, 64);
            other = ` to ${String.fromCharCode(...buf.slice(0, n))}`;
          }
          this.log.info('native', this.focused ? 'Box has the keyboard' : `Box lost the keyboard${other}`);
          this.events.focus(this.focused);
          break;
        }
        case WM_KEYDOWN: {
          this.altAlone = false;
          const ctrl = this.down(VK.CONTROL), shift = this.down(VK.SHIFT);
          if (w === VK.TAB && !ctrl) {
            this.events.tab(shift);
            return 0;
          }
          if (w === VK.F10 && !ctrl && !shift) {
            this.events.menu(undefined);
            return 0;
          }
          if (!ctrl) {
            const key = readerKey(w, shift);
            if (key) {
              this.events.key({ ...key, shift, caret: this.caret });
              return 0;
            }
          }
          const run = (ctrl || (w >= 0x70 && w <= 0x7b)) && this.accelerators(acceleratorOf(w, ctrl, false, shift) ?? '');
          if (run) {
            run();
            return 0;
          }
          // Keys that would change the text: Backspace, Delete, Ctrl+X, V, Z, Y, Shift+Insert.
          if (w === 0x08 || w === 0x2e || (ctrl && [0x58, 0x56, 0x5a, 0x59].includes(w)) || (shift && w === 0x2d)) return 0;
          break;
        }
        case WM_CHAR:
          // Typing never changes the book; every character key is Reader's or nothing.
          return 0;
        case WM_SYSKEYDOWN: {
          if (w === VK.MENU) {
            this.altAlone = true;
            return 0;
          }
          this.altAlone = false;
          const shift = this.down(VK.SHIFT), ctrl = this.down(VK.CONTROL);
          // Alt+Up and Alt+Down are left to the screen reader (sentenceNav's sentence keys).
          if (w === 0x26 || w === 0x28) break;
          if (w >= 0x41 && w <= 0x5a && !shift && !ctrl) {
            this.events.menu(String.fromCharCode(w).toLowerCase());
            return 0;
          }
          const run = this.accelerators(acceleratorOf(w, ctrl, true, shift) ?? '');
          if (run) {
            run();
            return 0;
          }
          break;
        }
        case WM_SYSKEYUP:
          if (w === VK.MENU && this.altAlone) {
            this.altAlone = false;
            this.events.menu(undefined);
            return 0;
          }
          break;
        case WM_SYSCHAR:
          return 0;
        case WM_NCDESTROY:
          this.hwnd = undefined;
          break;
      }
      const result = pass();
      if (msg === WM_KEYUP || msg === WM_LBUTTONUP) this.events.caret(this.caret);
      return result;
    } catch (err) {
      this.log.error('native', `Message ${msg}: ${err instanceof Error ? err.message : String(err)}`);
      return pass();
    }
  }
}
