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
    const now = Date.now();
    const makeStorage = (initial = {}) => {
      const data = { ...initial };
      return {
        async setAccessLevel() {},
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(
              keys.filter((key) => key in data).map((key) => [key, data[key]]),
            );
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
    const local = makeStorage({
      discordClosedCaptionsDeviceApiKey: "preview-only-not-a-real-api-key-1234567890",
      discordClosedCaptionsKeyMode: "device",
      languages: ["en"],
      keywords: ["Discord"],
      prompt: "A casual Discord call between friends.",
      saveTranscripts: true,
      speakerAttribution: true,
      transcribeSelf: false,
      disccordLatestTranscript: {
        version: 1,
        sessionId: "preview-session",
        startedAt: now - 180000,
        endedAt: now,
        entries: [
          {
            itemId: "one",
            speaker: "Alex",
            speakerCandidates: ["Alex"],
            text: "The speaker labels should update without delaying the captions.",
            createdAt: now - 120000,
            updatedAt: now - 120000,
          },
          {
            itemId: "two",
            speaker: "Sam or Jordan",
            speakerCandidates: ["Sam", "Jordan"],
            text: "If two people overlap, the transcript can preserve that ambiguity.",
            createdAt: now - 60000,
            updatedAt: now - 60000,
          },
        ],
      },
    });
    const session = makeStorage();
    window.chrome = {
      runtime: {
        id: "extension-preview",
        async sendMessage(message) {
          if (message.type === "disccord:get-state") return { ok: true, activeTabId: null };
          if (message.type === "disccord:update-settings") {
            await local.set(message.settings);
            return {
              ok: true,
              settings: {
                saveTranscripts: true,
                speakerAttribution: true,
                transcribeSelf: false,
                ...message.settings,
              },
            };
          }
          if (message.type === "disccord:clear-transcript") {
            await local.remove("disccordLatestTranscript");
            return { ok: true };
          }
          return { ok: true };
        },
        async openOptionsPage() {},
      },
      storage: {
        local,
        session,
        onChanged: { addListener() {} },
      },
      tabs: {
        async query() { return [{ id: 1, url: "https://discord.com/channels/preview" }]; },
        async get(id) { return { id, url: "https://discord.com/channels/preview" }; },
      },
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
  console.log(`Popup preview: http://${host}:${port}/popup.html`);
});

function respond(response, status, message) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}
