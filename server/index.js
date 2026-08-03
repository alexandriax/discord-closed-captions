import "dotenv/config";

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { WebSocketServer } from "ws";

import { CaptionSession } from "./caption-session.js";
import { loadConfig } from "./config.js";

export function createDisccordServer(config) {
  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          ok: true,
          service: "disccord",
          transcriptionModel: config.transcriptionModel,
        }),
      );
      return;
    }

    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url, "http://localhost");
    if (requestUrl.pathname !== "/captions" || !isAllowedOrigin(request.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });

  websocketServer.on("connection", (client) => {
    new CaptionSession(client, config);
  });

  return {
    httpServer,
    websocketServer,
    async close() {
      for (const client of websocketServer.clients) {
        client.close(1001, "Server shutting down");
      }

      await new Promise((resolve, reject) => {
        websocketServer.close((websocketError) => {
          if (websocketError) {
            reject(websocketError);
            return;
          }

          httpServer.close((httpError) => {
            if (httpError) {
              reject(httpError);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}

function isAllowedOrigin(origin) {
  return !origin || origin.startsWith("chrome-extension://");
}

async function main() {
  const config = loadConfig();
  const server = createDisccordServer(config);

  await new Promise((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(config.port, config.host, resolve);
  });

  console.log(
    `Disccord relay listening on http://${config.host}:${config.port} (${config.transcriptionModel})`,
  );

  const shutdown = async () => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    await server.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(`Disccord relay failed: ${error.message}`);
    process.exitCode = 1;
  });
}
