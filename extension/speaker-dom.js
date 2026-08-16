(() => {
  const SPEAKER_NAME_SELECTORS = [
    '[class*="username_"]',
    '[class*="nickname_"]',
    '[class*="overlayTitleText_"]',
    '[class*="name_"]',
    '[data-text-variant="text-sm/medium"]',
    '[role="img"][aria-label][aria-hidden="false"]',
    '[role="img"][aria-label]',
    '[role="button"][aria-label^="Call tile," i]',
    "img[alt]",
  ];

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

    return ["", "::before", "::after"].some((pseudoElement) => {
      const style = getComputedStyle(element, pseudoElement || null);
      return isDiscordSpeakingGreen(
        [
          style.borderColor,
          style.backgroundColor,
          style.backgroundImage,
          style.boxShadow,
          style.outlineColor,
          style.color,
          style.fill,
          style.stroke,
          style.getPropertyValue("--voice-surface-border-color"),
          style.getPropertyValue("--__adaptive-focus-ring-color"),
        ].join(" "),
      );
    });
  }

  function isDiscordSpeakingGreen(value) {
    if (typeof value !== "string" || !value) {
      return false;
    }

    const normalized = value.toLowerCase();
    if (/\b(?:green|positive|speaking)\b/.test(normalized)) {
      return true;
    }

    const colors = [
      ...parseRgbColors(normalized),
      ...parseHexColors(normalized),
    ];
    return colors.some(
      ({ red, green, blue, alpha }) =>
        alpha > 0 &&
        green >= 105 &&
        green - red >= 25 &&
        green - blue >= 12,
    );
  }

  function parseRgbColors(value) {
    return [...value.matchAll(/rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?%?))?/g)].map(
      (match) => ({
        red: Number(match[1]),
        green: Number(match[2]),
        blue: Number(match[3]),
        alpha: parseAlpha(match[4]),
      }),
    );
  }

  function parseHexColors(value) {
    return [...value.matchAll(/#([0-9a-f]{3,8})\b/g)]
      .map((match) => expandHexColor(match[1]))
      .filter(Boolean);
  }

  function expandHexColor(value) {
    if (![3, 4, 6, 8].includes(value.length)) {
      return null;
    }
    const expanded =
      value.length <= 4
        ? [...value].map((character) => character.repeat(2)).join("")
        : value;
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha:
        expanded.length === 8
          ? Number.parseInt(expanded.slice(6, 8), 16) / 255
          : 1,
    };
  }

  function parseAlpha(value) {
    if (!value) {
      return 1;
    }
    return value.endsWith("%")
      ? Number.parseFloat(value) / 100
      : Number.parseFloat(value);
  }

  function findSpeakerName(element) {
    const labelledName = cleanSpeakerName(element.getAttribute("aria-label"));
    if (labelledName) {
      return labelledName;
    }

    let container = element;
    for (let depth = 0; container && depth < 10; depth += 1) {
      const semanticContainer =
        container.closest?.('[data-list-item-id^="voice-users-"]') ||
        container.closest?.("button, [role=button]") ||
        container;
      const name =
        cleanSpeakerName(semanticContainer.getAttribute?.("aria-label")) ||
        findNameWithin(semanticContainer);
      if (name) {
        return name;
      }
      container = container.parentElement;
    }
    return "";
  }

  function findNameWithin(container) {
    for (const selector of SPEAKER_NAME_SELECTORS) {
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

  function cleanSpeakerName(value) {
    if (typeof value !== "string") {
      return "";
    }
    const firstLine = value
      .replace(/^call tile\s*,\s*/i, "")
      .split(/[\n\r,|]/)[0]
      .replace(/\b(?:is )?speaking\b/gi, "")
      .replace(/\b(?:muted|deafened|camera on|camera off)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      !firstLine ||
      firstLine.length > 80 ||
      /^(?:speaking|call tile|options|voice connected|user area)$/i.test(
        firstLine,
      )
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

  globalThis.DisccordSpeakerDom = Object.freeze({
    cleanSpeakerName,
    findSpeakerName,
    isDiscordSpeakingGreen,
    isSpeaking,
  });
})();
