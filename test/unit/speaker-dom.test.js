import assert from "node:assert/strict";
import test from "node:test";

await import("../../extension/speaker-dom.js");

const {
  cleanSpeakerName,
  findSpeakerName,
  isDiscordSpeakingGreen,
  isSpeaking,
} = globalThis.DisccordSpeakerDom;

test("recognizes current and legacy Discord speaking greens", () => {
  for (const value of [
    "#23a55a",
    "#2ecc71",
    "#43b581",
    "#40a258",
    "rgb(67, 181, 129)",
    "0 0 0 2px rgba(64, 162, 88, 0.8)",
    "var(--green-360)",
  ]) {
    assert.equal(isDiscordSpeakingGreen(value), true, value);
  }
});

test("rejects inactive and transparent tile colors", () => {
  for (const value of [
    "rgb(255, 255, 255)",
    "rgb(88, 101, 242)",
    "rgba(67, 181, 129, 0)",
    "none",
  ]) {
    assert.equal(isDiscordSpeakingGreen(value), false, value);
  }
});

test("detects a speaking ring painted as a background", () => {
  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (_element, pseudoElement) => ({
    borderColor: "rgb(255, 255, 255)",
    backgroundColor: pseudoElement ? "rgba(0, 0, 0, 0)" : "rgb(64, 162, 88)",
    backgroundImage: "none",
    boxShadow: "none",
    outlineColor: "rgb(255, 255, 255)",
    color: "rgb(255, 255, 255)",
    fill: "rgb(0, 0, 0)",
    stroke: "none",
    getPropertyValue: () => "",
  });

  try {
    assert.equal(
      isSpeaking({
        className: "border__2f4f7",
        dataset: {},
        getAttribute: () => null,
      }),
      true,
    );
  } finally {
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test("extracts a username from Discord call-tile labels", () => {
  assert.equal(cleanSpeakerName("Call tile, thinkyhead"), "thinkyhead");
  assert.equal(cleanSpeakerName("Call tile, AI, speaking"), "AI");
  assert.equal(cleanSpeakerName("Call tile"), "");
});

test("finds the display name in Discord's role-image avatar", () => {
  const avatar = {
    getAttribute: (name) =>
      name === "aria-label" ? "juan_de_tejas" : null,
    textContent: "",
  };
  const tile = {
    closest: () => null,
    getAttribute: () => null,
    matches: () => false,
    parentElement: null,
    querySelector: (selector) =>
      selector.startsWith('[role="img"]') ? avatar : null,
  };
  const speakingBorder = {
    closest: () => null,
    getAttribute: () => null,
    matches: () => false,
    parentElement: tile,
    querySelector: () => null,
  };

  assert.equal(findSpeakerName(speakingBorder), "juan_de_tejas");
});
