const STORAGE_KEY = "phi3-assistant-v1";
const DEFAULT_MODEL = "moondream";
const VISION_HINTS = ["moondream", "llava", "vision", "bakllava"];

const DEFAULTS = {
  persona: {
    name: "Nova",
    avatar: "N",
    instructions:
      "You are a thoughtful, capable assistant running locally via Ollama. You help with coding, writing, planning, and explaining ideas clearly.",
    rules:
      "- Be direct and helpful; avoid filler.\n- If you are unsure, say so and suggest next steps.\n- Match the user's language and tone.\n- For code, prefer working examples and brief explanations.",
    greeting:
      "Hi — I'm Nova. Tell me what you're working on, or attach a photo if you want me to look at something.",
  },
  settings: {
    ollamaBase: "http://127.0.0.1:11434",
    textModel: "",
    visionModel: "",
    temperature: 0.7,
    topP: 0.9,
    stream: true,
    keepHistory: true,
  },
};

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("form");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");
const attachBtn = document.getElementById("attach");
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const statusEl = document.getElementById("status");
const modelSelect = document.getElementById("model");
const headerTitle = document.getElementById("header-title");
const headerSubtitle = document.getElementById("header-subtitle");
const headerAvatar = document.getElementById("header-avatar");
const headerActions = document.querySelector(".header-actions--chat");
const toastEl = document.getElementById("toast");

const personaForm = document.getElementById("persona-form");
const settingsForm = document.getElementById("settings-form");
const views = {
  chat: document.getElementById("view-chat"),
  persona: document.getElementById("view-persona"),
  settings: document.getElementById("view-settings"),
};
const navItems = document.querySelectorAll(".nav-item");

let installedModels = [];
/** @type {{ role: string, content: string, images?: string[] }[]} */
let history = [];
let isGenerating = false;
/** @type {{ dataUrl: string, base64: string, name: string } | null} */
let pendingImage = null;
let currentView = "chat";
let toastTimer = null;

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      persona: { ...DEFAULTS.persona, ...parsed.persona },
      settings: { ...DEFAULTS.settings, ...parsed.settings },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

let config = loadConfig();

function getOllamaBase() {
  return (config.settings.ollamaBase || DEFAULTS.settings.ollamaBase).replace(/\/$/, "");
}

function showToast(message, duration = 2600) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), duration);
}

function setStatus(state, label) {
  statusEl.className = `status status--${state}`;
  statusEl.textContent = label;
}

function isVisionModel(name) {
  const n = name.toLowerCase();
  return VISION_HINTS.some((h) => n.includes(h));
}

function assistantDisplayName() {
  return config.persona.name?.trim() || "Assistant";
}

function assistantAvatarChar() {
  const a = config.persona.avatar?.trim();
  if (a) return a.slice(0, 2);
  const name = assistantDisplayName();
  return name.slice(0, 1).toUpperCase() || "◎";
}

function buildSystemPrompt() {
  const { instructions, rules, name } = config.persona;
  const parts = [];
  if (name?.trim()) parts.push(`Your name is ${name.trim()}.`);
  if (instructions?.trim()) parts.push(instructions.trim());
  if (rules?.trim()) {
    parts.push(`You must follow these rules:\n${rules.trim()}`);
  }
  return parts.join("\n\n").trim();
}

function applyBranding() {
  const name = assistantDisplayName();
  const avatar = assistantAvatarChar();
  headerTitle.textContent = name;
  headerSubtitle.textContent = currentView === "chat" ? "Local · Ollama" : currentView === "persona" ? "Setup" : "Preferences";
  headerAvatar.textContent = avatar;
  document.title = currentView === "chat" ? name : `${name} — ${currentView === "persona" ? "Assistant" : "Settings"}`;
}

function syncPersonaForm() {
  document.getElementById("persona-name").value = config.persona.name;
  document.getElementById("persona-avatar").value = config.persona.avatar;
  document.getElementById("persona-instructions").value = config.persona.instructions;
  document.getElementById("persona-rules").value = config.persona.rules;
  document.getElementById("persona-greeting").value = config.persona.greeting;
  updatePersonaPreview();
}

function updatePersonaPreview() {
  const name = document.getElementById("persona-name").value.trim() || "Assistant";
  const avatar =
    document.getElementById("persona-avatar").value.trim().slice(0, 2) ||
    name.slice(0, 1).toUpperCase();
  const greeting =
    document.getElementById("persona-greeting").value.trim() ||
    "Your opening message will appear here.";
  document.getElementById("preview-avatar").textContent = avatar;
  document.getElementById("preview-greeting").textContent = greeting;
}

function syncSettingsForm() {
  document.getElementById("settings-base").value = config.settings.ollamaBase;
  document.getElementById("settings-temperature").value = config.settings.temperature;
  document.getElementById("settings-top-p").value = config.settings.topP;
  document.getElementById("temp-value").textContent = config.settings.temperature;
  document.getElementById("topp-value").textContent = config.settings.topP;
  document.getElementById("settings-stream").checked = config.settings.stream;
  document.getElementById("settings-keep-history").checked = config.settings.keepHistory;
}

function fillModelSelects(models) {
  const textSel = document.getElementById("settings-text-model");
  const visionSel = document.getElementById("settings-vision-model");
  const textCurrent = config.settings.textModel;
  const visionCurrent = config.settings.visionModel;

  for (const sel of [textSel, visionSel]) {
    const isVision = sel === visionSel;
    const current = isVision ? visionCurrent : textCurrent;
    sel.innerHTML = '<option value="">Auto</option>';
    const list = isVision ? models.filter(isVisionModel) : models.filter((m) => !isVisionModel(m));
    const source = list.length ? list : models;
    for (const name of source) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === current) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

function navigate(view) {
  currentView = view;
  for (const [key, el] of Object.entries(views)) {
    const active = key === view;
    el.classList.toggle("view--active", active);
    el.hidden = !active;
  }
  navItems.forEach((btn) => {
    const on = btn.dataset.nav === view;
    btn.classList.toggle("nav-item--active", on);
    btn.setAttribute("aria-current", on ? "page" : null);
  });
  headerActions?.classList.toggle("hidden", view !== "chat");
  applyBranding();
  if (view === "chat") {
    inputEl.focus();
    scrollToBottom();
  }
}

function autoResizeTextarea() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 160)}px`;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatContent(text) {
  const escaped = escapeHtml(text);
  const parts = [];
  let lastIndex = 0;
  const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
  let match;

  while ((match = codeRe.exec(escaped)) !== null) {
    if (match.index > lastIndex) {
      parts.push(formatInline(escaped.slice(lastIndex, match.index)));
    }
    const lang = match[1] ? ` class="language-${match[1]}"` : "";
    parts.push(`<pre><code${lang}>${match[2].trim()}</code></pre>`);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < escaped.length) {
    parts.push(formatInline(escaped.slice(lastIndex)));
  }

  return parts.join("") || formatInline(escaped);
}

function formatInline(text) {
  return text
    .split(/\n\n+/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function imageHtml(dataUrl, alt = "Attached photo") {
  return `<figure class="msg-image"><img src="${dataUrl}" alt="${escapeHtml(alt)}" loading="lazy" /></figure>`;
}

function renderWelcome() {
  const greeting = config.persona.greeting?.trim() || DEFAULTS.persona.greeting;
  messagesEl.innerHTML = "";
  const article = document.createElement("article");
  article.className = "message message--assistant welcome";
  article.innerHTML = `
    <div class="message-avatar" aria-hidden="true">${escapeHtml(assistantAvatarChar())}</div>
    <div class="message-body"><p>${escapeHtml(greeting)}</p></div>
  `;
  messagesEl.appendChild(article);
}

function createMessage(role, content = "", imageDataUrl = null) {
  const article = document.createElement("article");
  article.className = `message message--${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "You" : assistantAvatarChar();

  const body = document.createElement("div");
  body.className = "message-body";
  let html = "";
  if (imageDataUrl) html += imageHtml(imageDataUrl);
  if (content) html += formatContent(content);
  if (html) body.innerHTML = html;

  article.append(avatar, body);
  messagesEl.appendChild(article);
  scrollToBottom();
  return body;
}

function showTyping() {
  const body = createMessage("assistant");
  body.innerHTML =
    '<div class="typing-indicator" aria-label="Generating"><span></span><span></span><span></span></div>';
  return body;
}

function resolveModel(prefix, available = installedModels) {
  return available.find((m) => m === prefix || m.startsWith(`${prefix}:`)) || null;
}

function messagesForApi() {
  const system = buildSystemPrompt();
  const out = [];
  if (system) out.push({ role: "system", content: system });
  out.push(...history);
  return out;
}

async function checkOllama() {
  try {
    const res = await fetch(`${getOllamaBase()}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error("not ok");
    const data = await res.json();
    installedModels = (data.models || []).map((m) => m.name).sort();
    populateModels(installedModels);
    fillModelSelects(installedModels);
    setStatus("online", "Online");
    return true;
  } catch {
    setStatus("offline", "Offline");
    modelSelect.innerHTML = `<option value="${DEFAULT_MODEL}">${DEFAULT_MODEL}</option>`;
    return false;
  }
}

function populateModels(models) {
  modelSelect.innerHTML = "";
  const prefText = config.settings.textModel;
  const preferred =
    (prefText && models.includes(prefText) && prefText) ||
    resolveModel("llama3.2", models) ||
    resolveModel("phi3", models) ||
    models.find((m) => !isVisionModel(m)) ||
    models[0] ||
    DEFAULT_MODEL;

  if (models.length === 0) {
    const opt = document.createElement("option");
    opt.value = DEFAULT_MODEL;
    opt.textContent = DEFAULT_MODEL;
    modelSelect.appendChild(opt);
    return;
  }

  for (const name of models) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === preferred) opt.selected = true;
    modelSelect.appendChild(opt);
  }
}

function setGenerating(active) {
  isGenerating = active;
  inputEl.disabled = active;
  sendBtn.disabled = active;
  attachBtn.disabled = active;
  modelSelect.disabled = active;
}

function clearPendingImage() {
  pendingImage = null;
  imageInput.value = "";
  imagePreview.classList.add("hidden");
  imagePreview.innerHTML = "";
}

function renderImagePreview() {
  if (!pendingImage) {
    imagePreview.classList.add("hidden");
    imagePreview.innerHTML = "";
    return;
  }

  imagePreview.classList.remove("hidden");
  imagePreview.innerHTML = `
    <img src="${pendingImage.dataUrl}" alt="Preview" />
    <div class="image-preview-meta">
      <span>${escapeHtml(pendingImage.name)}</span>
      <button type="button" class="btn btn--ghost btn--sm" id="remove-image">Remove</button>
    </div>
  `;
  document.getElementById("remove-image").addEventListener("click", clearPendingImage);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = String(dataUrl).split(",")[1] || "";
      resolve({ dataUrl, base64 });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function resetChat() {
  history = [];
  clearPendingImage();
  renderWelcome();
  inputEl.placeholder = `Message ${assistantDisplayName()}…`;
  inputEl.focus();
}

function pickModelForSend(hasImage) {
  if (hasImage) {
    const pref = config.settings.visionModel;
    if (pref && installedModels.includes(pref)) return pref;
    const vision =
      resolveModel("moondream") || installedModels.find(isVisionModel);
    if (!vision) throw new Error("No vision model installed. Run: ollama pull moondream");
    return vision;
  }
  const pref = config.settings.textModel;
  if (pref && installedModels.includes(pref)) return pref;
  return modelSelect.value || installedModels.find((m) => !isVisionModel(m)) || installedModels[0] || DEFAULT_MODEL;
}

async function sendMessage(text, image = pendingImage) {
  const hasImage = Boolean(image?.base64);
  let model;

  try {
    model = pickModelForSend(hasImage);
  } catch (err) {
    createMessage("assistant").innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    return;
  }

  if (hasImage && !isVisionModel(model)) {
    createMessage("assistant").innerHTML = `<p class="error-text">Model <strong>${escapeHtml(model)}</strong> cannot see images. Pick a vision model in Settings.</p>`;
    return;
  }

  const prompt = text || (hasImage ? "Describe this image in detail." : "");
  if (!prompt && !hasImage) return;

  const userMsg = { role: "user", content: prompt };
  if (hasImage) userMsg.images = [image.base64];
  history.push(userMsg);

  createMessage("user", prompt, image?.dataUrl);

  const typingBody = showTyping();
  setGenerating(true);

  let assistantText = "";
  let bodyEl = null;
  const { temperature, topP, stream } = config.settings;

  try {
    const res = await fetch(`${getOllamaBase()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: messagesForApi(),
        stream: Boolean(stream),
        options: {
          temperature: Number(temperature),
          top_p: Number(topP),
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `HTTP ${res.status}`);
    }

    typingBody.remove();
    bodyEl = createMessage("assistant");

    if (!stream) {
      const data = await res.json();
      assistantText = data.message?.content || "";
      bodyEl.innerHTML = formatContent(assistantText);
      scrollToBottom();
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let chunk;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }

          if (chunk.message?.content) {
            assistantText += chunk.message.content;
            bodyEl.innerHTML = formatContent(assistantText);
            scrollToBottom();
          }

          if (chunk.done) break;
        }
      }
    }

    if (config.settings.keepHistory) {
      history.push({ role: "assistant", content: assistantText });
    } else {
      history = [
        { role: "user", content: prompt, ...(hasImage ? { images: [image.base64] } : {}) },
        { role: "assistant", content: assistantText },
      ];
    }
    clearPendingImage();
  } catch (err) {
    typingBody?.remove();
    if (!bodyEl) bodyEl = createMessage("assistant");
    bodyEl.innerHTML = `<p class="error-text">Could not reach Ollama.<br><small>${escapeHtml(err.message)}</small></p>`;
    history.pop();
  } finally {
    setGenerating(false);
    inputEl.focus();
  }
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.nav));
});

attachBtn.addEventListener("click", () => imageInput.click());

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast("Image must be under 8 MB.");
    imageInput.value = "";
    return;
  }

  try {
    const { dataUrl, base64 } = await fileToBase64(file);
    pendingImage = { dataUrl, base64, name: file.name };
    renderImagePreview();
    const md = resolveModel("moondream");
    if (md) modelSelect.value = md;
    if (!inputEl.value.trim()) {
      inputEl.placeholder = "What should I look at in this image?";
    }
  } catch {
    showToast("Could not read image.");
  }
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if ((!text && !pendingImage) || isGenerating) return;

  inputEl.value = "";
  autoResizeTextarea();
  await sendMessage(text);
});

inputEl.addEventListener("input", autoResizeTextarea);

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

clearBtn.addEventListener("click", resetChat);

personaForm.addEventListener("submit", (e) => {
  e.preventDefault();
  config.persona = {
    name: document.getElementById("persona-name").value.trim() || DEFAULTS.persona.name,
    avatar: document.getElementById("persona-avatar").value.trim(),
    instructions: document.getElementById("persona-instructions").value,
    rules: document.getElementById("persona-rules").value,
    greeting: document.getElementById("persona-greeting").value,
  };
  saveConfig(config);
  applyBranding();
  if (currentView === "chat") renderWelcome();
  showToast("Assistant saved");
});

document.getElementById("persona-reset").addEventListener("click", () => {
  if (!confirm("Reset assistant fields to defaults?")) return;
  config.persona = structuredClone(DEFAULTS.persona);
  saveConfig(config);
  syncPersonaForm();
  applyBranding();
  if (currentView === "chat") renderWelcome();
  showToast("Assistant reset");
});

["persona-name", "persona-avatar", "persona-greeting"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updatePersonaPreview);
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  config.settings = {
    ollamaBase: document.getElementById("settings-base").value.trim() || DEFAULTS.settings.ollamaBase,
    textModel: document.getElementById("settings-text-model").value,
    visionModel: document.getElementById("settings-vision-model").value,
    temperature: parseFloat(document.getElementById("settings-temperature").value),
    topP: parseFloat(document.getElementById("settings-top-p").value),
    stream: document.getElementById("settings-stream").checked,
    keepHistory: document.getElementById("settings-keep-history").checked,
  };
  saveConfig(config);
  checkOllama();
  populateModels(installedModels);
  showToast("Settings saved");
});

document.getElementById("settings-temperature").addEventListener("input", (e) => {
  document.getElementById("temp-value").textContent = e.target.value;
});

document.getElementById("settings-top-p").addEventListener("input", (e) => {
  document.getElementById("topp-value").textContent = e.target.value;
});

document.getElementById("settings-test").addEventListener("click", async () => {
  const result = document.getElementById("settings-test-result");
  result.textContent = "Testing…";
  const ok = await checkOllama();
  result.textContent = ok
    ? `Connected — ${installedModels.length} model(s) found.`
    : "Could not connect. Check URL and that Ollama is running.";
});

document.getElementById("settings-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${assistantDisplayName().replace(/\s+/g, "-").toLowerCase()}-config.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Config downloaded");
});

document.getElementById("settings-import").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.persona) config.persona = { ...config.persona, ...data.persona };
    if (data.settings) config.settings = { ...config.settings, ...data.settings };
    saveConfig(config);
    syncPersonaForm();
    syncSettingsForm();
    applyBranding();
    renderWelcome();
    await checkOllama();
    showToast("Config imported");
  } catch {
    showToast("Invalid config file");
  }
  e.target.value = "";
});

document.getElementById("settings-clear-all").addEventListener("click", () => {
  if (!confirm("Delete all saved assistant and settings data?")) return;
  localStorage.removeItem(STORAGE_KEY);
  config = loadConfig();
  syncPersonaForm();
  syncSettingsForm();
  applyBranding();
  resetChat();
  checkOllama();
  showToast("All data cleared");
});

applyBranding();
syncPersonaForm();
syncSettingsForm();
renderWelcome();
inputEl.placeholder = `Message ${assistantDisplayName()}…`;
checkOllama();
navigate("chat");
