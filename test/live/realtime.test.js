import "dotenv/config";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import WebSocket from "ws";

import { createDisccordServer } from "../../server/index.js";

test(
  "the local relay returns a finalized live caption for spoken audio",
  { timeout: 30_000 },
  async () => {
    assert.ok(
      process.env.OPENAI_API_KEY,
      "OPENAI_API_KEY must be set to run the live test",
    );

    const fixture = createSpokenFixture();
    const server = createDisccordServer({
      apiKey: process.env.OPENAI_API_KEY,
      accessKey: "",
      host: "127.0.0.1",
      transcriptionModel:
        process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-live-transcribe",
      port: 0,
    });

    try {
      await new Promise((resolve, reject) => {
        server.httpServer.once("error", reject);
        server.httpServer.listen(0, "127.0.0.1", resolve);
      });

      const address = server.httpServer.address();
      const transcript = await transcribeFixture(address.port, fixture.pcm);

      assert.match(
        transcript.toLowerCase(),
        /purple|bicycle/,
        `Unexpected transcript: ${transcript}`,
      );
    } finally {
      fixture.cleanup();
      await server.close();
    }
  },
);

function createSpokenFixture() {
  if (process.platform !== "darwin") {
    throw new Error(
      "The live spoken-audio test currently requires macOS `say` and ffmpeg.",
    );
  }

  const directory = mkdtempSync(join(tmpdir(), "disccord-live-test-"));
  const aiffPath = join(directory, "spoken.aiff");
  const pcmPath = join(directory, "spoken.pcm");

  execFileSync("/usr/bin/say", [
    "-o",
    aiffPath,
    "Good morning. The purple bicycle is ready.",
  ]);
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-i",
    aiffPath,
    "-f",
    "s16le",
    "-ac",
    "1",
    "-ar",
    "24000",
    pcmPath,
  ]);

  return {
    pcm: readFileSync(pcmPath),
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function transcribeFixture(port, pcm) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/captions`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for a finalized caption"));
    }, 25_000);

    let streamed = false;

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "start",
          config: {
            languages: ["en"],
            keywords: ["purple bicycle"],
            prompt: "A clear synthetic voice reading one English sentence.",
          },
        }),
      );
    });

    socket.on("message", async (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === "error") {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(`${message.code}: ${message.message}`));
        return;
      }

      if (
        message.type === "status" &&
        message.status === "ready" &&
        !streamed
      ) {
        streamed = true;
        try {
          for (let offset = 0; offset < pcm.length; offset += 4_800) {
            socket.send(pcm.subarray(offset, offset + 4_800));
            await delay(20);
          }
          socket.send(JSON.stringify({ type: "commit" }));
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }

      if (message.type === "caption" && message.final) {
        clearTimeout(timeout);
        socket.close(1000, "Live test complete");
        resolve(message.text);
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
