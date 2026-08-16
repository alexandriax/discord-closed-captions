import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSpeakers,
  SpeakerAttributionTracker,
} from "../../extension/speaker-attribution.js";

test("speaker attribution chooses a dominant recent Discord speaker", () => {
  const tracker = new SpeakerAttributionTracker();
  tracker.addSample(["Alex"], 1_000);
  tracker.addSample(["Alex"], 1_300);
  tracker.addSample(["Alex", "Sam"], 1_600);

  assert.deepEqual(tracker.attribute(1_900), {
    speaker: "Alex",
    speakerCandidates: ["Alex"],
  });
});

test("speaker attribution marks overlapping speakers as ambiguous", () => {
  const tracker = new SpeakerAttributionTracker();
  tracker.addSample(["Alex", "Sam"], 1_000);
  tracker.addSample(["Alex", "Sam"], 1_300);

  assert.deepEqual(tracker.attribute(1_600), {
    speaker: "Alex or Sam",
    speakerCandidates: ["Alex", "Sam"],
  });
});

test("speaker normalization supports calls with dozens of participants", () => {
  const participants = Array.from({ length: 256 }, (_, index) => `Person ${index}`);

  assert.deepEqual(normalizeSpeakers(participants), participants);
});
