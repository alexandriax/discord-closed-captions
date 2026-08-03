(() => {
  const CAPTION_LIFETIME_MS = 12_000;
  const MAX_CAPTIONS = 3;

  let overlay;
  let captionList;
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
        cleanupTimer: null,
      };
      caption.element.className = "disccord-caption";
      captionList.append(caption.element);
      captions.set(itemId, caption);
    }

    caption.text = message.final
      ? message.text
      : `${caption.text}${message.text || ""}`;
    caption.element.textContent = caption.text.trim();
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
})();
