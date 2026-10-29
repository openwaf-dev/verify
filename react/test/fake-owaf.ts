import type { OwafVerifyApi, OwafVerifyRenderOptions } from '../src/types.js';

export interface FakeWidget {
  id: string;
  container: HTMLElement;
  options: OwafVerifyRenderOptions;
  token: string;
  removed: boolean;
}

/** In-memory stand-in for `window.owafVerify` that records every call. */
export class FakeOwafVerify implements OwafVerifyApi {
  widgets: FakeWidget[] = [];
  calls: string[] = [];
  private next = 0;

  get live(): FakeWidget[] {
    return this.widgets.filter((w) => !w.removed);
  }

  render(container: HTMLElement | string, options?: OwafVerifyRenderOptions): string {
    if (typeof container === 'string') throw new Error('fake: selectors not supported');
    const widget: FakeWidget = {
      id: `w${++this.next}`,
      container,
      options: options ?? { sitekey: '' },
      token: '',
      removed: false,
    };
    const root = document.createElement('div');
    root.className = 'owaf-v';
    root.setAttribute('data-state', 'solving');
    container.appendChild(root);
    this.widgets.push(widget);
    this.calls.push(`render:${widget.id}`);
    return widget.id;
  }

  private get(id?: string): FakeWidget | undefined {
    return this.widgets.find((w) => w.id === id && !w.removed);
  }

  /** Simulates the widget solving: stores the token and calls `callback`. */
  solve(id: string, token: string): void {
    const w = this.get(id);
    if (!w) throw new Error(`fake: no live widget ${id}`);
    w.token = token;
    w.options.callback?.(token);
  }

  execute(id?: string): Promise<string> {
    this.calls.push(`execute:${id}`);
    const w = this.get(id);
    return w ? Promise.resolve(w.token || 'v1.EXECUTED') : Promise.reject(new Error('unknown widget'));
  }

  reset(id?: string): void {
    this.calls.push(`reset:${id}`);
    const w = this.get(id);
    if (w) w.token = '';
  }

  getResponse(id?: string): string {
    return this.get(id)?.token ?? '';
  }

  isExpired(id?: string): boolean {
    return !this.get(id)?.token;
  }

  remove(id?: string): void {
    this.calls.push(`remove:${id}`);
    const w = this.get(id);
    if (!w) return;
    w.removed = true;
    w.container.replaceChildren();
  }
}
