import type { MenuEntry, ReaderApi } from '../shared/api';

/** A label's text without "&", and its access key (the letter after "&"), lower case. */
function parseLabel(label: string): { text: string; key: string; at: number } {
  let text = '';
  let key = '';
  let at = -1;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '&' && i + 1 < label.length) {
      i++;
      if (label[i] !== '&' && !key) {
        key = label[i]!.toLowerCase();
        at = text.length;
      }
    }
    text += label[i];
  }
  return { text, key, at };
}

/** The label as nodes, the access key underlined (shown once the keyboard opens the menu). */
function labelNodes(label: string): Node[] {
  const { text, at } = parseLabel(label);
  if (at < 0) return [document.createTextNode(text)];
  const u = document.createElement('u');
  u.textContent = text[at]!;
  return [document.createTextNode(text.slice(0, at)), u, document.createTextNode(text.slice(at + 1))];
}

/**
 * The window's menu bar. It is drawn here rather than by Electron because Electron's menu bar
 * on Windows lets Tab move between its menus and leaves altogether on Escape. This one
 * behaves like a Windows menu: Alt or F10 moves to it, Alt with a letter opens that menu, the
 * arrow keys move, Tab does nothing, and Escape steps back one level at a time before going
 * back to where you were. Its items come from the app's menu, so they and their shortcut
 * keys are the same.
 */
export class MenuBar {
  private entries: MenuEntry[] = [];
  private tops: HTMLElement[] = [];
  /** Open menus, outermost first. */
  private menus: HTMLElement[] = [];
  private readonly entryOf = new WeakMap<HTMLElement, MenuEntry>();
  private readonly ownerOf = new WeakMap<HTMLElement, HTMLElement>();
  private returnTo: HTMLElement | null = null;
  /** Told when menus open (true) and when the last one closes (false). */
  onMenus: ((open: boolean) => void) | undefined;
  private altAlone = false;

  constructor(
    private readonly bar: HTMLElement,
    private readonly api: ReaderApi,
  ) {
    void this.refresh();
    document.addEventListener('keydown', (e) => this.onGlobalKey(e), true);
    document.addEventListener('keyup', (e) => this.onGlobalKeyUp(e), true);
    document.addEventListener('keydown', (e) => this.onMenuKey(e), true);
    document.addEventListener('focusin', (e) => {
      if (this.active && !this.owns(e.target as Node)) this.close(false);
    });
    document.addEventListener(
      'mousedown',
      (e) => {
        this.altAlone = false;
        if (this.active && !this.owns(e.target as Node)) this.close(false);
      },
      true,
    );
    window.addEventListener('blur', () => this.menus.length && this.close(false));
    window.addEventListener('resize', () => this.menus.length && this.close(false));
  }

  /** True while focus is in the menu bar or one of its menus. */
  get active(): boolean {
    return this.owns(document.activeElement);
  }

  private owns(node: Node | null): boolean {
    return !!node && (this.bar.contains(node) || this.menus.some((m) => m.contains(node)));
  }

  /** Reads the app's menu again, so ticks and greyed items are current. */
  private async refresh(): Promise<void> {
    this.entries = await this.api.menuEntries();
    if (this.tops.length === this.entries.length) return;
    this.tops = this.entries.map((entry, i) => {
      const top = document.createElement('div');
      top.className = 'ui-menu-top';
      top.setAttribute('role', 'menuitem');
      top.setAttribute('aria-haspopup', 'menu');
      top.setAttribute('aria-expanded', 'false');
      top.tabIndex = -1;
      top.append(...labelNodes(entry.label));
      top.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (top.getAttribute('aria-expanded') === 'true') return this.close(true);
        if (!this.active) this.returnTo = document.activeElement as HTMLElement | null;
        this.bar.classList.remove('keys');
        void this.openTop(i);
      });
      top.addEventListener('mouseenter', () => {
        if (this.menus.length && top.getAttribute('aria-expanded') !== 'true') void this.openTop(i);
      });
      return top;
    });
    this.bar.replaceChildren(...this.tops);
  }

  private modalOpen(): boolean {
    return !!document.querySelector('dialog:modal');
  }

  private onGlobalKey(e: KeyboardEvent): void {
    if (e.key === 'Alt') {
      if (!e.repeat) this.altAlone = true;
      return;
    }
    this.altAlone = false;
    if (this.modalOpen()) return;
    if (e.key === 'F10' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (this.active) this.close(true);
      else void this.enter(0);
      return;
    }
    // Alt with a menu's letter opens it, from anywhere.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const letter = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase() ?? e.key.toLowerCase();
      const i = this.entries.findIndex((t) => parseLabel(t.label).key === letter);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (!this.active) this.returnTo = document.activeElement as HTMLElement | null;
      this.bar.classList.add('keys');
      void this.openTop(i);
    }
  }

  private onGlobalKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'Alt' || !this.altAlone) return;
    this.altAlone = false;
    if (this.modalOpen()) return;
    e.preventDefault();
    if (this.active) this.close(true);
    else void this.enter(0);
  }

  /** Moves to the menu bar, on menu `i`, without opening it. */
  private async enter(i: number): Promise<void> {
    this.returnTo = document.activeElement as HTMLElement | null;
    await this.refresh();
    this.bar.classList.add('keys');
    this.tops[i]?.focus();
  }

  /** Leaves the menu bar, going back to where focus was if `restore`. */
  private close(restore: boolean): void {
    this.closeFrom(0);
    this.bar.classList.remove('keys');
    const back = this.returnTo;
    this.returnTo = null;
    if (restore) {
      if (back?.isConnected && !this.owns(back)) back.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  /** Closes the open menus from `level` inwards. */
  private closeFrom(level: number): void {
    const had = this.menus.length > 0;
    for (const menu of this.menus.splice(level)) {
      this.ownerOf.get(menu)?.setAttribute('aria-expanded', 'false');
      menu.remove();
    }
    if (had && !this.menus.length) this.onMenus?.(false);
  }

  /** Alt, F10 or Alt with a letter pressed where the page doesn't see it (the native text box). */
  fromOutside(letter: string | undefined): void {
    if (this.modalOpen()) return;
    if (!this.active) this.returnTo = document.activeElement as HTMLElement | null;
    const back = this.returnTo;
    if (letter === undefined) {
      void this.enter(0).then(() => (this.returnTo = back));
      return;
    }
    const i = this.entries.findIndex((t) => parseLabel(t.label).key === letter);
    if (i < 0) return;
    this.bar.classList.add('keys');
    void this.openTop(i);
  }

  private async openTop(i: number, last = false): Promise<void> {
    const n = this.tops.length;
    i = ((i % n) + n) % n;
    await this.refresh();
    this.closeFrom(0);
    const top = this.tops[i]!;
    const menu = this.buildMenu(this.entries[i]?.submenu ?? [], top, 0);
    const r = top.getBoundingClientRect();
    this.place(menu, r.left, r.bottom);
    this.focusItem(menu, last ? -1 : 0);
  }

  private openSub(item: HTMLElement, level: number): void {
    const entry = this.entryOf.get(item);
    if (!entry?.submenu) return;
    this.closeFrom(level + 1);
    const menu = this.buildMenu(entry.submenu, item, level + 1);
    const r = item.getBoundingClientRect();
    this.place(menu, r.right - 2, r.top - 5, r.left);
    this.focusItem(menu, 0);
  }

  private buildMenu(entries: MenuEntry[], owner: HTMLElement, level: number): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'ui-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', parseLabel(this.entryOf.get(owner)?.label ?? owner.textContent ?? '').text);
    for (const entry of entries) {
      if (entry.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'ui-menu-sep';
        sep.setAttribute('role', 'separator');
        menu.append(sep);
        continue;
      }
      const item = document.createElement('div');
      item.className = 'ui-menu-item';
      item.tabIndex = -1;
      item.setAttribute('role', entry.type === 'checkbox' ? 'menuitemcheckbox' : entry.type === 'radio' ? 'menuitemradio' : 'menuitem');
      if (entry.type === 'checkbox' || entry.type === 'radio') item.setAttribute('aria-checked', String(entry.checked));
      if (!entry.enabled) item.setAttribute('aria-disabled', 'true');
      if (entry.submenu) {
        item.setAttribute('aria-haspopup', 'menu');
        item.setAttribute('aria-expanded', 'false');
      }
      const mark = document.createElement('span');
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = entry.checked ? (entry.type === 'radio' ? '●' : '✓') : '';
      const label = document.createElement('span');
      label.append(...labelNodes(entry.label));
      const keys = document.createElement('span');
      keys.className = 'ui-menu-key';
      keys.textContent = entry.accelerator;
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = entry.submenu ? '›' : '';
      item.append(mark, label, keys, arrow);
      this.entryOf.set(item, entry);
      item.addEventListener('mouseenter', () => {
        item.focus();
        if (entry.submenu) this.openSub(item, level);
        else this.closeFrom(level + 1);
      });
      item.addEventListener('click', () => this.choose(item, level));
      menu.append(item);
    }
    owner.setAttribute('aria-expanded', 'true');
    this.ownerOf.set(menu, owner);
    if (!this.menus.length) this.onMenus?.(true);
    this.menus.push(menu);
    document.body.append(menu);
    return menu;
  }

  /** Puts a menu at (x, y), kept inside the window; `flipX` is where it goes if it won't fit on the right. */
  private place(menu: HTMLElement, x: number, y: number, flipX?: number): void {
    const { width, height } = menu.getBoundingClientRect();
    if (x + width > innerWidth - 4) x = flipX !== undefined ? flipX - width + 2 : innerWidth - width - 4;
    if (y + height > innerHeight - 4) y = innerHeight - height - 4;
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
  }

  private items(menu: HTMLElement): HTMLElement[] {
    return [...menu.querySelectorAll<HTMLElement>('.ui-menu-item')];
  }

  private focusItem(menu: HTMLElement, index: number): void {
    const list = this.items(menu);
    list.at(index)?.focus();
  }

  /** Runs an item, or opens its submenu. */
  private choose(item: HTMLElement, level: number): void {
    const entry = this.entryOf.get(item);
    if (!entry) return;
    if (entry.submenu) return this.openSub(item, level);
    if (!entry.enabled) return;
    this.close(true);
    this.api.runMenuItem(entry.path);
  }

  private onMenuKey(e: KeyboardEvent): void {
    const target = document.activeElement as HTMLElement | null;
    if (!target || !this.active || e.key === 'Alt') return;
    // A shortcut key leaves the menu and does its job where you were.
    if (e.ctrlKey || e.metaKey) return this.close(true);
    if (e.altKey) return;
    const topIndex = this.tops.indexOf(target);
    const handled = topIndex >= 0 ? this.onTopKey(e, topIndex) : this.onItemKey(e, target);
    // Tab and anything else not handled stays in the menu, as in Windows.
    if (handled || e.key === 'Tab' || e.key.length === 1) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private onTopKey(e: KeyboardEvent, i: number): boolean {
    const n = this.tops.length;
    switch (e.key) {
      case 'ArrowRight':
        this.tops[(i + 1) % n]!.focus();
        return true;
      case 'ArrowLeft':
        this.tops[(i - 1 + n) % n]!.focus();
        return true;
      case 'Home':
        this.tops[0]!.focus();
        return true;
      case 'End':
        this.tops[n - 1]!.focus();
        return true;
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        void this.openTop(i);
        return true;
      case 'ArrowUp':
        void this.openTop(i, true);
        return true;
      case 'Escape':
        this.close(true);
        return true;
    }
    if (e.key.length === 1) {
      const j = this.entries.findIndex((t) => parseLabel(t.label).key === e.key.toLowerCase());
      if (j >= 0) void this.openTop(j);
      return true;
    }
    return false;
  }

  private onItemKey(e: KeyboardEvent, item: HTMLElement): boolean {
    const level = this.menus.findIndex((m) => m.contains(item));
    const menu = this.menus[level];
    if (!menu) return false;
    const list = this.items(menu);
    const at = list.indexOf(item);
    const topIndex = this.tops.indexOf(this.ownerOf.get(this.menus[0]!)!);
    switch (e.key) {
      case 'ArrowDown':
        list[(at + 1) % list.length]!.focus();
        return true;
      case 'ArrowUp':
        list[(at - 1 + list.length) % list.length]!.focus();
        return true;
      case 'Home':
        list[0]!.focus();
        return true;
      case 'End':
        list[list.length - 1]!.focus();
        return true;
      case 'Enter':
      case ' ':
        this.choose(item, level);
        return true;
      case 'ArrowRight':
        if (this.entryOf.get(item)?.submenu) this.openSub(item, level);
        else void this.openTop(topIndex + 1);
        return true;
      case 'ArrowLeft':
        if (level > 0) this.back(level);
        else void this.openTop(topIndex - 1);
        return true;
      case 'Escape':
        this.back(level);
        return true;
    }
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const letter = e.key.toLowerCase();
      const entries = list.map((el) => parseLabel(this.entryOf.get(el)?.label ?? ''));
      const byKey = list.filter((_, k) => entries[k]!.key === letter);
      if (byKey.length === 1) {
        this.choose(byKey[0]!, level);
        return true;
      }
      // Several items share the letter, or none has it as its key: move to the next one starting with it.
      const pool = byKey.length ? byKey : list.filter((_, k) => entries[k]!.text.toLowerCase().startsWith(letter));
      const next = pool.find((el) => list.indexOf(el) > at) ?? pool[0];
      next?.focus();
      return true;
    }
    return false;
  }

  /** Escape: closes this menu and goes back to the item or menu name that opened it. */
  private back(level: number): void {
    const owner = this.ownerOf.get(this.menus[level]!);
    this.closeFrom(level);
    owner?.focus();
  }
}
