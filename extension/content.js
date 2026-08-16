(() => {
  const CAPTION_LIFETIME_MS = 12_000;
  const MAX_CAPTIONS = 3;

  let overlay;
  let captionList;
  let speakerTimer;
  let statusLabel;
  const captions = new Map();

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.type?.startsWith("disccord:")) {
      return;
    }

    ensureOverlay();

    if (message.type === "disccord:status") {
      showOverlay();
      setStatus(message.status, message.message);
      startSpeakerMonitoring();
    }

    if (message.type === "disccord:caption") {
      showOverlay();
      setStatus("ready", "Live captions");
      updateCaption(message);
    }

    if (message.type === "disccord:error") {
      showOverlay();
      setStatus(
        "error",
        message.message || "Discord Closed Captions hit an error.",
      );
    }

    if (message.type === "disccord:stopped") {
      stopSpeakerMonitoring();
      setStatus("stopped", "Captions off");
      setTimeout(hideOverlay, 1200);
    }
  });

  document.addEventListener("fullscreenchange", mountOverlay);

  chrome.runtime
    .sendMessage({
      target: "service-worker",
      type: "disccord:get-state",
    })
    .then((state) => {
      if (state?.active) {
        ensureOverlay();
        showOverlay();
        setStatus("connecting", "Restoring live captions…");
        startSpeakerMonitoring();
      }
    })
    .catch(() => {});

  function ensureOverlay() {
    if (overlay?.isConnected) {
      return;
    }

    overlay = document.createElement("section");
    overlay.id = "disccord-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "region");
    overlay.setAttribute("aria-label", "Discord live closed captions");
    overlay.innerHTML = `
      <div class="disccord-header">
        <span class="disccord-dot" aria-hidden="true"></span>
        <span class="disccord-status">Starting captions…</span>
        <button class="disccord-close" type="button" aria-label="Stop Discord closed captions">×</button>
      </div>
      <div class="disccord-captions" role="status" aria-live="polite" aria-atomic="false"></div>
    `;

    statusLabel = overlay.querySelector(".disccord-status");
    captionList = overlay.querySelector(".disccord-captions");
    overlay
      .querySelector(".disccord-close")
      .addEventListener("click", () => {
        chrome.runtime.sendMessage({
          target: "service-worker",
          type: "disccord:stop-request",
        });
      });

    mountOverlay();
  }

  function mountOverlay() {
    if (!overlay) {
      return;
    }

    const parent = document.fullscreenElement || document.body;
    if (parent && overlay.parentElement !== parent) {
      parent.append(overlay);
    }
  }

  function updateCaption(message) {
    const itemId = message.itemId || "current";
    let caption = captions.get(itemId);

    if (!caption) {
      caption = {
        text: "",
        element: document.createElement("p"),
        speakerElement: document.createElement("span"),
        textElement: document.createElement("span"),
        cleanupTimer: null,
      };
      caption.element.className = "disccord-caption";
      caption.speakerElement.className = "disccord-speaker";
      caption.speakerElement.hidden = true;
      caption.textElement.className = "disccord-caption-text";
      caption.element.append(caption.speakerElement, caption.textElement);
      captionList.append(caption.element);
      captions.set(itemId, caption);
    }

    caption.text = message.final
      ? message.text
      : `${caption.text}${message.text || ""}`;
    caption.textElement.textContent = caption.text.trim();
    caption.speakerElement.textContent = message.speaker || "";
    caption.speakerElement.hidden = !message.speaker;
    caption.element.dataset.final = String(Boolean(message.final));

    if (message.final) {
      clearTimeout(caption.cleanupTimer);
      caption.cleanupTimer = setTimeout(
        () => removeCaption(itemId),
        CAPTION_LIFETIME_MS,
      );
    }

    while (captionList.children.length > MAX_CAPTIONS) {
      const oldest = captionList.firstElementChild;
      const oldestEntry = [...captions.entries()].find(
        ([, value]) => value.element === oldest,
      );
      if (oldestEntry) {
        removeCaption(oldestEntry[0]);
      } else {
        oldest.remove();
      }
    }
  }

  function removeCaption(itemId) {
    const caption = captions.get(itemId);
    clearTimeout(caption?.cleanupTimer);
    caption?.element.remove();
    captions.delete(itemId);
  }

  function setStatus(state, message) {
    overlay.dataset.state = state;
    statusLabel.textContent = message || "Live captions";
  }

  function showOverlay() {
    overlay.hidden = false;
  }

  function hideOverlay() {
    if (overlay?.dataset.state === "stopped") {
      overlay.hidden = true;
      for (const itemId of captions.keys()) {
        removeCaption(itemId);
      }
    }
  }

  function startSpeakerMonitoring() {
    if (speakerTimer) {
      return;
    }
    scanActiveSpeakers();
    speakerTimer = setInterval(scanActiveSpeakers, 250);
  }

  function stopSpeakerMonitoring() {
    clearInterval(speakerTimer);
    speakerTimer = null;
  }

  function scanActiveSpeakers() {
    const speakers = new Set();
    const candidates = document.querySelectorAll(
      [
        '[aria-label*="speaking" i]',
        '[data-speaking="true"]',
        '[class*="speaking_"]',
        '[class*="avatarSpeaking_"]',
        '[class*="border_"]',
      ].join(","),
    );

    for (const candidate of candidates) {
      if (candidate.closest("#disccord-overlay") || !isSpeaking(candidate)) {
        continue;
      }
      const name = findSpeakerName(candidate);
      if (name) {
        speakers.add(name);
      }
    }

    chrome.runtime
      .sendMessage({
        target: "service-worker",
        type: "disccord:speakers",
        speakers: [...speakers],
        selfName: findSelfName(),
        at: Date.now(),
      })
      .catch(() => {});
  }

  function isSpeaking(element) {
    const className = getClassName(element);
    const ariaLabel = element.getAttribute("aria-label") || "";
    if (
      element.dataset.speaking === "true" ||
      /speaking/i.test(className) ||
      /\bspeaking\b/i.test(ariaLabel)
    ) {
      return true;
    }

    if (!/(border|avatar|voice|tile|participant)/i.test(className)) {
      return false;
    }
    const style = getComputedStyle(element);
    return isDiscordSpeakingGreen(
      [
        style.borderColor,
        style.boxShadow,
        style.outlineColor,
        style.getPropertyValue("--__adaptive-focus-ring-color"),
      ].join(" "),
    );
  }

  function isDiscordSpeakingGreen(value) {
    return /(?:rgb\(\s*)?(?:35\s*,\s*165\s*,\s*9[01]|46\s*,\s*204\s*,\s*113)|#23a55a|#2ecc71/i.test(
      value,
    );
  }

  function findSpeakerName(element) {
    const labelledName = cleanSpeakerName(element.getAttribute("aria-label"));
    if (labelledName) {
      return labelledName;
    }

    let container = element;
    for (let depth = 0; container && depth < 8; depth += 1) {
      const semanticContainer =
        container.closest?.('[data-list-item-id^="voice-users-"]') || container;
      const name = findNameWithin(semanticContainer);
      if (name) {
        return name;
      }
      container = container.parentElement;
    }
    return "";
  }

  function findNameWithin(container) {
    const selectors = [
      '[class*="username_"]',
      '[class*="name_"]',
      '[class*="nickname_"]',
      '[data-text-variant="text-sm/medium"]',
      "img[alt]",
    ];
    for (const selector of selectors) {
      const element = container.matches?.(selector)
        ? container
        : container.querySelector?.(selector);
      const value =
        element?.getAttribute?.("alt") ||
        element?.getAttribute?.("aria-label") ||
        element?.textContent;
      const name = cleanSpeakerName(value);
      if (name) {
        return name;
      }
    }
    return "";
  }

  function findSelfName() {
    const userPanel = document.querySelector(
      '[class*="panels_"] [class*="nameTag_"], [aria-label="User area"] [class*="name_"]',
    );
    return cleanSpeakerName(userPanel?.textContent) || "You";
  }

  function cleanSpeakerName(value) {
    if (typeof value !== "string") {
      return "";
    }
    const firstLine = value
      .split(/[\n\r,|]/)[0]
      .replace(/\b(?:is )?speaking\b/gi, "")
      .replace(/\b(?:muted|deafened|camera on|camera off)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      !firstLine ||
      firstLine.length > 80 ||
      /^(?:speaking|voice connected|user area)$/i.test(firstLine)
    ) {
      return "";
    }
    return firstLine;
  }

  function getClassName(element) {
    return typeof element.className === "string"
      ? element.className
      : element.getAttribute("class") || "";
  }
})();
