# OpenWAF Verify — cliente

[English](README.md)

OpenWAF Verify es una comprobación por prueba de trabajo para formularios y llamadas a APIs que el borde de
[OpenWAF](https://openwaf.dev) sirve desde tu propio host: sin scripts, iframes ni cookies de terceros, y funciona con
`Content-Security-Policy: default-src 'self'`. Este repositorio contiene todo lo que se ejecuta fuera de los
servidores de OpenWAF:

| Ruta | Qué es |
|---|---|
| [`challengejs/`](challengejs/) | El widget del navegador, el Web Worker de la prueba de trabajo, la plantilla de la página intersticial y sus CSS, tal como el borde los sirve en `/__waf/challenge/v1/`. |
| [`spec/PROTOCOL.md`](spec/PROTOCOL.md) | El protocolo (en inglés): endpoints, prueba de trabajo, intersticial, token, siteverify, códigos de error y claves de prueba. |
| [`siteverify/`](siteverify/) | Cliente de siteverify en Go (`github.com/openwaf-dev/verify/siteverify`). |
| [`node/`](node/) | Cliente de siteverify en Node.js / TypeScript (`@openwaf/verify`). |
| [`php/`](php/) | Cliente de siteverify en PHP (`openwaf/verify`). |
| [`react/`](react/) | Componente de React (`@openwaf/verify-react`). |
| [`vue/`](vue/) | Componente de Vue 3 (`@openwaf/verify-vue`). |
| [`examples/`](examples/) | Ejemplos pequeños que funcionan, uno por pieza. |

Documentación del producto: [developers.openwaf.dev/es/waf/verify-widget/](https://developers.openwaf.dev/es/waf/verify-widget/)
y [la página de código abierto](https://developers.openwaf.dev/es/waf/verify-open-source/).

## Qué es abierto y qué no

Abierto, aquí: todo el código que reciben los navegadores de tus visitantes y todo el que ejecutan tus servidores para
comprobar un token.

Fuera de aquí: la parte del servidor que decide si una resolución se acepta (la puntuación de riesgo y sus señales,
la reputación de red, el propio borde) y un módulo de extensión con comprobaciones de sí o no dentro
de la página, que el servicio de OpenWAF compila dentro del widget. Ese módulo no lee canvas, WebGL, audio, fuentes ni
client hints de alta entropía, no pone cookies, no hace peticiones y añade un número entero a la petición de
resolución. La detección publicada se esquiva enseguida, así que se queda cerrada; lo que se ejecuta en el navegador
de tus visitantes debe poder leerse, así que el resto es abierto. Por ese módulo, el bundle que sirve el borde no es
idéntico byte a byte a una compilación de este repositorio. El [protocolo](spec/PROTOCOL.md#6-extension-point)
describe el punto de extensión.

## Instalar

Por ahora todo se instala desde este repositorio; los paquetes de npm y Packagist llegarán pronto.

```sh
go get github.com/openwaf-dev/verify/siteverify@v0.1.0
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-0.1.0.tgz        # @openwaf/verify
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-react-0.1.0.tgz  # @openwaf/verify-react
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-vue-0.1.0.tgz    # @openwaf/verify-vue
composer config repositories.openwaf-verify vcs https://github.com/openwaf-dev/verify
composer require openwaf/verify:^0.1
```

Los tarballs de npm van adjuntos a cada [versión](https://github.com/openwaf-dev/verify/releases), con su SHA-256 en
`SHA256SUMS`.

## Empezar en cinco minutos

1. Pon el widget en un formulario de un host que pase por OpenWAF (la clave de sitio de prueba funciona en cualquiera):

   ```html
   <script src="/__waf/challenge/v1/widget.js" async defer></script>
   <form action="/alta" method="post">
     <div class="owaf-verify" data-sitekey="owk_test_pass" data-action="signup"></div>
     <button>Darme de alta</button>
   </form>
   ```

2. En tu servidor, comprueba el campo `owaf-verify-response` con siteverify (el secreto de prueba acepta cualquier
   token):

   ```go
   c, _ := siteverify.New(os.Getenv("OPENWAF_VERIFY_SECRET")) // ows_test_pass mientras pruebas
   res, err := c.Verify(ctx, r.FormValue("owaf-verify-response"), siteverify.Params{RemoteIP: clientIP})
   if err != nil || !res.Success { /* rechazar */ }
   ```

   ```ts
   import { SiteverifyClient } from "@openwaf/verify";
   const res = await new SiteverifyClient({ secret: process.env.OPENWAF_VERIFY_SECRET! })
     .verify(token, { remoteIp, expectedAction: "signup" });
   ```

   ```php
   $res = (new OpenWAF\Verify\Siteverify\Client((string) getenv('OPENWAF_VERIFY_SECRET')))
       ->verify($_POST['owaf-verify-response'] ?? '', remoteIp: $ip);
   ```

3. En React: `<Verify siteKey="owk_test_pass" onSuccess={setToken} />` de `@openwaf/verify-react`.

Cambia las claves de prueba por la clave de sitio y el secreto de tu widget (panel: **Seguridad → Verificación →
Widgets**).

## Compilar el cliente

```sh
node challengejs/build.mjs          # esbuild y terser, versiones fijadas, con npx
go test ./challengejs/              # pruebas del widget en sandbox y de la plantilla intersticial (necesita node)
```

Los ficheros compilados (`*.min.js`, `*.min.css` y sus `.gz`/`.br`) están en el repositorio; la CI los vuelve a
compilar y falla si cambian. Cada biblioteca tiene su README con sus pruebas.

## Seguridad

Las vulnerabilidades se notifican en privado a **support@openwaf.dev** (ver [SECURITY.md](SECURITY.md)), nunca en una
issue pública.

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md). Los cambios en `challengejs/` se revisan aquí y salen con la siguiente versión
del borde.

## Licencia

[Apache License 2.0](LICENSE). © OpenWAF.
