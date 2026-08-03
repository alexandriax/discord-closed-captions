import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const extensionRoot = resolve("extension");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const chromeMock = `
<script>
  (() => {
    const makeStorage = (initial = {}) => {
      const data = { ...initial };
      return {
        async setAccessLevel() {},
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
          }
          if (typeof keys === "string") {
            return keys in data ? { [keys]: data[keys] } : {};
          }
          return { ...(keys || {}), ...data };
        },
        async set(values) { Object.assign(data, values); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
        },
      };
    };
    window.chrome = {
      runtime: { id: "options-preview" },
      storage: { local: makeStorage(), session: makeStorage() },
    };
  })();
</script>`;

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${host}:${port}`);
    const pathname = requestUrl.pathname === "/" ? "/options.html" : requestUrl.pathname;
    const filePath = resolve(extensionRoot, `.${pathname}`);

    if (!filePath.startsWith(`${extensionRoot}/`)) {
      respond(response, 403, "Forbidden");
      return;
    }

    let body = await readFile(filePath);
    if (extname(filePath) === ".html") {
      body = Buffer.from(
        body.toString("utf8").replace("</head>", `${chromeMock}</head>`),
      );
    }

    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      respond(response, 404, "Not found");
      return;
    }
    respond(response, 500, "Preview server error");
  }
});

server.listen(port, host, () => {
  console.log(`Options preview: http://${host}:${port}/options.html`);
});

function respond(response, status, message) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}
