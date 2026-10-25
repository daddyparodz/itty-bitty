# itty.bitty

itty.bitty takes html (or other data), compresses it into a URL fragment, and provides a link that can be shared. When it is opened, it inflates that data on the receiver’s side.

Learn more at: [about.bitty.site](http://about.bitty.site)

How it works: [how.bitty.site](http://how.bitty.site)

For more info: [wiki.bitty.site](https://github.com/alcor/itty-bitty/wiki/)

## Self-hosting

### Local runtime prerequisites
- Node.js 22.13.0 or newer
- npm 9 or newer

### Netlify functions
The rasterization handler in `functions/rasterize.js` uses Node.js 22 and its own
locked `sharp` dependency. Netlify installs that package before building the site;
`NODE_VERSION` in `netlify.toml` selects the build and default function runtime.
A site-level `AWS_LAMBDA_JS_RUNTIME` override must also select a supported runtime
when deploying. Firebase configuration in this repository is for hosting; there
is no Firebase Functions entry point.

Run `npm run test:functions` on Node.js 22 or 24 to install the function in an
isolated directory and exercise its native encoders and rasterization response.

### Run locally
1. Install dependencies with `npm install`.
2. Start the server with `npm run dev`.
3. Visit `http://localhost:8080`.

Optional environment variables:
- `PORT`: server port (defaults to `8080`).
- `UA_ARRAY`: comma separated list of User-Agents to block with HTTP 401.
- `REQUEST_LOG`: set to `silent` to disable HTTP request logging.

### Docker workflow
1. Build the image locally: `docker build -t itty-bitty .`.
2. Run the container: `docker run --rm -d -p 8080:8080 --name itty-bitty itty-bitty`.
3. Open `http://localhost:8080/` in your browser.
4. Stop it with `docker rm -f itty-bitty` (or let `--rm` clean up if you stop the container normally).

### Docker Compose
```
docker compose up --build -d
```
Stop the stack with `docker compose down` when you are done.

### Local development and validation

Node.js 22.13.0 or newer is required (including the tooling's transitive engine
requirements). The application image uses Node.js 22;
the functions deployment runtime remains Node.js 22.

Install with `npm ci`, run `npm test` and `npm run test:functions`, then
`npm run build`. Function bundling uses the official
`@netlify/zip-it-and-ship-it` package directly rather than installing the
Netlify CLI. TOML validation uses `smol-toml`. No local dependency patches,
postinstall hooks, or dependency overrides are needed.

The optional Netlify editor extension uses its separately installed CLI; it is
not part of the application's dependency tree.
