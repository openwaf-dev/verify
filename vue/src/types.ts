/** Colour scheme of the widget. `auto` follows `prefers-color-scheme`. */
export type VerifyTheme = 'auto' | 'light' | 'dark';
/** Widget language. `auto` follows the browser language. */
export type VerifyLanguage = 'auto' | 'en' | 'es';
export type VerifySize = 'normal' | 'compact';
/** `auto` renews the token before it expires; `manual` shows a retry button once it has expired. */
export type VerifyRefreshExpired = 'auto' | 'manual';

/** Options accepted by `window.owafVerify.render()`. */
export interface OwafVerifyRenderOptions {
  sitekey: string;
  action?: string;
  cdata?: string;
  callback?: (token: string) => void;
  errorCallback?: (code: string) => void;
  expiredCallback?: () => void;
  theme?: VerifyTheme;
  language?: VerifyLanguage;
  size?: VerifySize;
  accent?: string;
  responseFieldName?: string;
  refreshExpired?: VerifyRefreshExpired;
}

/** The `window.owafVerify` API exposed by `widget.js`. */
export interface OwafVerifyApi {
  render(container: HTMLElement | string, options?: OwafVerifyRenderOptions): string;
  execute(id?: string): Promise<string>;
  reset(id?: string): void;
  getResponse(id?: string): string;
  remove(id?: string): void;
  isExpired(id?: string): boolean;
}
