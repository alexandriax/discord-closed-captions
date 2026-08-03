import {
  clearApiKey,
  configureStorageAccess,
  getApiKeyState,
  lockApiKey,
  storeEncryptedApiKey,
  storeSessionApiKey,
  unlockApiKey,
} from "./key-vault.js";
import { loadSettings, parseList, saveSettings } from "./settings.js";

const keyForm = document.querySelector("#key-form");
const settingsForm = document.querySelector("#settings-form");
const unlockForm = document.querySelector("#unlock-form");
const vaultFields = document.querySelector("#vault-fields");
const keyState = document.querySelector("#key-state");
const keySummary = document.querySelector("#key-summary");
const keyControls = document.querySelector("#key-controls");
const lockButton = document.querySelector("#lock-key");
const clearButton = document.querySelector("#clear-key");
const keyStatus = document.querySelector("#key-status");
const settingsStatus = document.querySelector("#settings-status");

initialize().catch((error) => showStatus(keyStatus, error.message, true));

keyForm.addEventListener("change", (event) => {
  if (event.target.name === "storageMode") {
    updateVaultFields();
  }
});

keyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(keyStatus, "Securing key…");

  const formData = new FormData(keyForm);
  const apiKey = formData.get("apiKey");
  const mode = formData.get("storageMode");

  try {
    if (mode === "vault") {
      const passphrase = formData.get("vaultPassphrase");
      if (passphrase !== formData.get("vaultPassphraseConfirm")) {
        throw new Error("The vault passphrases do not match.");
      }
      await storeEncryptedApiKey(apiKey, passphrase);
    } else {
      await storeSessionApiKey(apiKey);
    }

    clearSecretFields(keyForm);
    showStatus(keyStatus, "API key ready");
    await refreshKeyState();
  } catch (error) {
    showStatus(keyStatus, error.message, true);
  }
});

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(keyStatus, "Unlocking…");

  try {
    await unlockApiKey(new FormData(unlockForm).get("unlockPassphrase"));
    clearSecretFields(unlockForm);
    showStatus(keyStatus, "Vault unlocked");
    await refreshKeyState();
  } catch (error) {
    showStatus(keyStatus, error.message, true);
  }
});

lockButton.addEventListener("click", async () => {
  await lockApiKey();
  showStatus(keyStatus, "Vault locked");
  await refreshKeyState();
});

clearButton.addEventListener("click", async () => {
  if (!window.confirm("Clear the saved OpenAI API key from this extension?")) {
    return;
  }

  await clearApiKey();
  showStatus(keyStatus, "API key cleared");
  await refreshKeyState();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(settingsStatus, "Saving…");

  try {
    const formData = new FormData(settingsForm);
    await saveSettings({
      languages: parseList(formData.get("languages")),
      keywords: parseList(formData.get("keywords")),
      prompt: formData.get("prompt"),
    });
    showStatus(settingsStatus, "Caption settings saved");
  } catch (error) {
    showStatus(settingsStatus, error.message, true);
  }
});

async function initialize() {
  await configureStorageAccess();
  const settings = await loadSettings();
  settingsForm.elements.languages.value = settings.languages.join(", ");
  settingsForm.elements.keywords.value = settings.keywords.join(", ");
  settingsForm.elements.prompt.value = settings.prompt;
  await refreshKeyState();
}

async function refreshKeyState() {
  const state = await getApiKeyState();
  const modeInput = keyForm.querySelector(
    `input[name="storageMode"][value="${state.mode}"]`,
  );
  modeInput.checked = true;
  updateVaultFields();

  unlockForm.hidden = !state.locked;
  keyControls.hidden = !state.available && !state.hasVault;
  lockButton.hidden = state.mode !== "vault" || !state.available;

  if (state.locked) {
    keyState.dataset.state = "locked";
    keyState.textContent = "Vault locked";
    keySummary.textContent =
      "Your encrypted API key is stored locally. Unlock it for this Chrome session before starting captions.";
    return;
  }

  if (state.available) {
    keyState.dataset.state = "ready";
    keyState.textContent = "Ready";
    keySummary.textContent =
      state.mode === "vault"
        ? "The encrypted vault is unlocked for this Chrome session."
        : "The API key is available until Chrome closes or the extension reloads.";
    return;
  }

  keyState.dataset.state = "missing";
  keyState.textContent = "Not configured";
  keySummary.textContent = "Add an OpenAI API key before starting captions.";
}

function updateVaultFields() {
  const mode = keyForm.elements.storageMode.value;
  vaultFields.hidden = mode !== "vault";
  for (const input of vaultFields.querySelectorAll("input")) {
    input.required = mode === "vault";
  }
}

function clearSecretFields(form) {
  for (const input of form.querySelectorAll('input[type="password"]')) {
    input.value = "";
  }
}

function showStatus(output, message, isError = false) {
  output.textContent = message;
  output.dataset.error = String(isError);
}
