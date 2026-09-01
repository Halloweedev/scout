import { invoke } from "@tauri-apps/api/core";
import { enqueueAndWait, type OperationJob } from "./operation-queue";

interface ConverterCapabilities {
  ffmpeg: boolean;
  pandoc: boolean;
  libreoffice: boolean;
}

interface ConversionResult {
  source: string;
  output: string;
  engine: string;
}

const MEDIA_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi", "webm", "mp3", "m4a", "wav", "flac", "ogg", "aac", "mpeg", "mpg"]);
const DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "html", "htm", "txt", "doc", "docx", "odt", "rtf", "epub", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp"]);
let observer: MutationObserver | null = null;
let overlay: HTMLDivElement | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function selectedRow() {
  const rows = [...document.querySelectorAll<HTMLElement>(".explorer-pane.active .pane-file-row.selected")];
  return rows.length === 1 && rows[0].dataset.entryKind === "file" ? rows[0] : null;
}

function selectedPath() {
  return selectedRow()?.dataset.entryPath ?? null;
}

function selectedExtension() {
  return (selectedRow()?.dataset.entryExtension ?? "").toLowerCase();
}

function activeDirectory() {
  return document.querySelector<HTMLElement>(".explorer-pane.active")?.dataset.panePath ?? null;
}

function close() {
  overlay?.remove();
  overlay = null;
}

function optionSelect(values: Array<[string, string]>) {
  const select = element("select", "converter-select");
  for (const [value, label] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
}

function engineRow(name: string, copy: string, available: boolean) {
  const row = element("div", `converter-engine${available ? "" : " unavailable"}`);
  const info = element("div", "converter-engine-info");
  const title = element("div", "converter-engine-name");
  title.textContent = name;
  const description = element("div", "converter-engine-copy");
  description.textContent = copy;
  info.append(title, description);
  const status = element("span", "converter-engine-status");
  status.textContent = available ? "Available" : "Not found";
  row.append(info, status);
  return row;
}

function queuedStatus(job: OperationJob<ConversionResult>) {
  if (job.status === "queued") return "Queued in Operations…";
  return job.detail ?? `Running ${job.label}…`;
}

async function execute(command: string, args: Record<string, unknown>, output: HTMLElement, button: HTMLButtonElement) {
  button.disabled = true;
  const original = button.textContent ?? "Convert";
  button.textContent = "Queued…";
  output.className = "converter-result";
  output.textContent = "Added to Operations. You can close this sheet without stopping the conversion.";
  try {
    const result = await enqueueAndWait<ConversionResult>(command, args, (job) => {
      if (!overlay || !button.isConnected) return;
      button.textContent = job.status === "queued" ? "Queued…" : "Converting…";
      output.className = "converter-result";
      output.textContent = queuedStatus(job);
    });
    if (!overlay) return;
    output.className = "converter-result success";
    output.textContent = `${result.engine} created ${result.output.split(/[\\/]/).pop() ?? result.output}`;
    button.textContent = "Done";
  } catch (error) {
    if (!overlay) return;
    output.className = "converter-result error";
    output.textContent = String(error);
    button.disabled = false;
    button.textContent = original;
  }
}

async function openConverter(kind: "media" | "document") {
  const path = selectedPath();
  const destination = activeDirectory();
  if (!path || !destination) return;
  close();

  overlay = element("div", "converter-backdrop");
  const sheet = element("section", "converter-sheet");
  const header = element("header", "converter-header");
  const heading = element("div", "converter-heading");
  const title = element("div", "converter-title");
  title.textContent = kind === "media" ? "Convert media" : "Convert document";
  const source = element("div", "converter-source");
  source.textContent = path;
  source.title = path;
  heading.append(title, source);
  const closeButton = element("button", "converter-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(heading, closeButton);
  const body = element("div", "converter-body");
  const loading = element("div", "converter-loading");
  loading.textContent = "Checking local conversion tools…";
  body.append(loading);
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);

  try {
    const capabilities = await invoke<ConverterCapabilities>("converter_capabilities");
    if (!overlay) return;
    body.replaceChildren();
    const engines = element("div", "converter-engines");
    engines.append(
      engineRow("FFmpeg", "Video and audio conversion", capabilities.ffmpeg),
      engineRow("Pandoc", "Text and document conversion", capabilities.pandoc),
      engineRow("LibreOffice", "Office formats and PDF export", capabilities.libreoffice),
    );
    body.append(engines);

    const queueNote = element("div", "converter-result");
    queueNote.textContent = "Conversions run in Operations and can be cancelled there.";
    body.append(queueNote);

    const result = element("div", "converter-result");
    const controls = element("div", "converter-controls");
    if (kind === "media") {
      const target = optionSelect([["mp4", "MP4"], ["webm", "WebM"], ["mp3", "MP3"], ["m4a", "M4A"], ["wav", "WAV"], ["gif", "GIF"]]);
      const convert = element("button", "converter-primary");
      convert.type = "button";
      convert.textContent = "Convert with FFmpeg";
      convert.disabled = !capabilities.ffmpeg;
      convert.addEventListener("click", () => void execute("enqueue_media_conversion", { path, destination, target: target.value }, result, convert));
      controls.append(target, convert);
    } else {
      const pandocTarget = optionSelect([["html", "HTML"], ["docx", "DOCX"], ["odt", "ODT"], ["rtf", "RTF"], ["epub", "EPUB"], ["md", "Markdown"], ["txt", "Text"]]);
      const pandoc = element("button", "converter-secondary");
      pandoc.type = "button";
      pandoc.textContent = "Pandoc";
      pandoc.disabled = !capabilities.pandoc;
      pandoc.addEventListener("click", () => void execute("enqueue_pandoc_conversion", { path, destination, target: pandocTarget.value }, result, pandoc));

      const officeTarget = optionSelect([["pdf", "PDF"], ["docx", "DOCX"], ["odt", "ODT"], ["xlsx", "XLSX"], ["csv", "CSV"], ["pptx", "PPTX"]]);
      const office = element("button", "converter-secondary");
      office.type = "button";
      office.textContent = "LibreOffice";
      office.disabled = !capabilities.libreoffice;
      office.addEventListener("click", () => void execute("enqueue_libreoffice_conversion", { path, destination, target: officeTarget.value }, result, office));
      const pairOne = element("div", "converter-control-pair");
      pairOne.append(pandocTarget, pandoc);
      const pairTwo = element("div", "converter-control-pair");
      pairTwo.append(officeTarget, office);
      controls.append(pairOne, pairTwo);
    }
    body.append(controls, result);
  } catch (error) {
    const message = element("div", "converter-error");
    message.textContent = String(error);
    body.replaceChildren(message);
  }
}

function enhanceMenu(menu: HTMLElement) {
  if (menu.dataset.convertersEnhanced === "1") return;
  menu.dataset.convertersEnhanced = "1";
  const path = selectedPath();
  if (!path) return;
  const extension = selectedExtension();
  const isMedia = MEDIA_EXTENSIONS.has(extension);
  const isDocument = DOCUMENT_EXTENSIONS.has(extension);
  if (!isMedia && !isDocument) return;
  const separator = element("div", "menu-separator converter-menu-separator");
  menu.append(separator);
  if (isMedia) {
    const button = element("button");
    button.type = "button";
    button.textContent = "Convert Media…";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.remove();
      void openConverter("media");
    });
    menu.append(button);
  }
  if (isDocument) {
    const button = element("button");
    button.type = "button";
    button.textContent = "Convert Document…";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.remove();
      void openConverter("document");
    });
    menu.append(button);
  }
}

function reconcile() {
  for (const menu of document.querySelectorAll<HTMLElement>(".context-menu")) enhanceMenu(menu);
}

export function installConverters() {
  observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer?.disconnect();
    observer = null;
    close();
  };
}
