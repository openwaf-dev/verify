import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { DEFAULT_SCRIPT_SRC, loadVerify } from './loader.js';
import type {
  OwafVerifyApi,
  OwafVerifyRenderOptions,
  VerifyLanguage,
  VerifyRefreshExpired,
  VerifySize,
  VerifyTheme,
} from './types.js';

/** Methods exposed on the component instance (template ref). */
export interface VerifyExposed {
  /** Discards the current token and solves a new challenge. */
  reset(): void;
  /** Resolves with a valid token, solving a challenge first when there is none. */
  execute(): Promise<string>;
  /** The current token, or `''` when there is none or it has expired. */
  getResponse(): string;
  isExpired(): boolean;
  /** Removes the widget; it is rendered again when a widget prop changes or the component remounts. */
  remove(): void;
}

interface Mounted {
  api: OwafVerifyApi;
  id: string;
}

export const Verify = defineComponent({
  name: 'OwafVerify',
  props: {
    /** Public sitekey (`owk_…`) of the widget. */
    siteKey: { type: String, required: true },
    /** Action label echoed back by siteverify, e.g. `login` or `signup`. */
    action: String,
    /** Customer data echoed back by siteverify. */
    cdata: String,
    theme: String as PropType<VerifyTheme>,
    language: String as PropType<VerifyLanguage>,
    size: String as PropType<VerifySize>,
    /** Accent colour, `#rgb` or `#rrggbb`. */
    accent: String,
    /** Name of the hidden form field that carries the token. Default `owaf-verify-response`. */
    responseFieldName: String,
    refreshExpired: String as PropType<VerifyRefreshExpired>,
    /** Widget script URL. Default `/__waf/challenge/v1/widget.js` (first-party, served by the OpenWAF edge). */
    scriptSrc: { type: String, default: DEFAULT_SCRIPT_SRC },
  },
  emits: {
    /** The widget solved; also after a refresh or reset. */
    success: (token: string) => typeof token === 'string',
    /** Widget error code, or `script-load` when the widget script cannot be loaded. */
    error: (code: string) => typeof code === 'string',
    /** The token expired without being refreshed. */
    expired: () => true,
  },
  setup(props, { emit, expose }) {
    const container = ref<HTMLElement | null>(null);
    let widget: Mounted | null = null;
    let ready: Promise<Mounted> | null = null;
    let teardown: (() => void) | null = null;

    function mountWidget(): void {
      const el = container.value;
      if (!el) return;
      let active = true;
      let mounted: Mounted | null = null;
      // The widget gets its own element so Vue never patches the widget DOM.
      const host = document.createElement('div');
      el.appendChild(host);
      const options: OwafVerifyRenderOptions = {
        sitekey: props.siteKey,
        callback: (token) => emit('success', token),
        errorCallback: (code) => emit('error', code),
        expiredCallback: () => emit('expired'),
      };
      if (props.action !== undefined) options.action = props.action;
      if (props.cdata !== undefined) options.cdata = props.cdata;
      if (props.theme !== undefined) options.theme = props.theme;
      if (props.language !== undefined) options.language = props.language;
      if (props.size !== undefined) options.size = props.size;
      if (props.accent !== undefined) options.accent = props.accent;
      if (props.responseFieldName !== undefined) options.responseFieldName = props.responseFieldName;
      if (props.refreshExpired !== undefined) options.refreshExpired = props.refreshExpired;

      const promise = loadVerify(props.scriptSrc).then(
        (api) => {
          if (!active) throw new Error('owafVerify: component unmounted');
          mounted = { api, id: api.render(host, options) };
          widget = mounted;
          return mounted;
        },
        (err: unknown) => {
          if (active) emit('error', 'script-load');
          throw err;
        },
      );
      promise.catch(() => {});
      ready = promise;

      teardown = () => {
        active = false;
        if (mounted) mounted.api.remove(mounted.id);
        host.remove();
        if (widget === mounted) widget = null;
        if (ready === promise) ready = null;
      };
    }

    function unmountWidget(): void {
      teardown?.();
      teardown = null;
    }

    onMounted(mountWidget);
    onBeforeUnmount(unmountWidget);
    watch(
      [
        () => props.siteKey,
        () => props.action,
        () => props.cdata,
        () => props.theme,
        () => props.language,
        () => props.size,
        () => props.accent,
        () => props.responseFieldName,
        () => props.refreshExpired,
        () => props.scriptSrc,
      ],
      () => {
        if (!container.value) return;
        unmountWidget();
        mountWidget();
      },
    );

    const exposed: VerifyExposed = {
      reset() {
        if (widget) widget.api.reset(widget.id);
      },
      execute() {
        const promise = ready;
        if (!promise) return Promise.reject(new Error('owafVerify: widget is not mounted'));
        return promise.then((w) => {
          if (widget !== w) throw new Error('owafVerify: widget was removed');
          return w.api.execute(w.id);
        });
      },
      getResponse() {
        return widget ? widget.api.getResponse(widget.id) : '';
      },
      isExpired() {
        return widget ? widget.api.isExpired(widget.id) : true;
      },
      remove() {
        if (!widget) return;
        widget.api.remove(widget.id);
        widget = null;
        ready = null;
      },
    };
    expose(exposed);

    return () => h('div', { ref: container });
  },
});
