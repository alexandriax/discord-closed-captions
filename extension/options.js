import {
  loadSettings,
  parseList,
  saveSettings,
} from "./settings.js";

const form = document.querySelector("#settings-form");
const status = document.querySelector("#save-status");

restore().catch((error) => showStatus(error.message, true));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("Saving…");

  try {
    const formData = new FormData(form);
    await saveSettings({
      relayUrl: formData.get("relayUrl"),
      accessKey: formData.get("accessKey"),
      languages: parseList(formData.get("languages")),
      keywords: parseList(formData.get("keywords")),
      prompt: formData.get("prompt"),
    });
    showStatus("Saved");
  } catch (error) {
    showStatus(error.message, true);
  }
});

async function restore() {
  const settings = await loadSettings();
  form.elements.relayUrl.value = settings.relayUrl;
  form.elements.accessKey.value = settings.accessKey;
  form.elements.languages.value = settings.languages.join(", ");
  form.elements.keywords.value = settings.keywords.join(", ");
  form.elements.prompt.value = settings.prompt;
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}

