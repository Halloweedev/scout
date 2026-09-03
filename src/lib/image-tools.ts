import { registerAction, type ScoutActionContext } from "./actions";
import { enqueueAndWait, type OperationJob } from "./operation-queue";

interface ImageTransformResult {
  source: string;
  output: string;
  width: number;
  height: number;
  format: string;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico"]);
let overlay: HTMLDivElement | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function imagePaths(context: ScoutActionContext) {
  if (!context.panePath || !context.selection.length) return [];
  if (!context.selection.every((entry) => entry.kind === "file" && IMAGE_EXTENSIONS.has((entry.extension ?? "").toLowerCase()))) return [];
  return context.selectedPaths;
}

function close() {
  overlay?.remove();
  overlay = null;
}

function field(labelText: string, input: HTMLElement) {
  const label = element("label", "utility-field");
  const caption = element("span");
  caption.textContent = labelText;
  label.append(caption, input);
  return label;
}

function optionalDimension(input: HTMLInputElement) {
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

async function openImageTools(paths: string[], destination: string) {
  if (!paths.length) return;
  close();

  overlay = element("div", "utility-backdrop");
  const sheet = element("section", "utility-sheet image-tools-sheet");
  const header = element("header", "utility-header");
  const title = element("div", "utility-title");
  title.textContent = paths.length === 1 ? "Convert image" : `Convert ${paths.length} images`;
  const closeButton = element("button", "utility-close");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);

  const body = element("div", "utility-body");
  const controls = element("div", "image-tools-controls");
  const formatSelect = element("select", "utility-input image-tools-select");
  for (const [value, label] of [["jpg", "JPEG"], ["png", "PNG"], ["webp", "WebP"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    formatSelect.append(option);
  }

  const widthInput = element("input", "utility-input");
  widthInput.type = "number";
  widthInput.min = "1";
  widthInput.placeholder = "Original";
  const heightInput = element("input", "utility-input");
  heightInput.type = "number";
  heightInput.min = "1";
  heightInput.placeholder = "Original";
  const qualityInput = element("input", "utility-input");
  qualityInput.type = "number";
  qualityInput.min = "1";
  qualityInput.max = "100";
  qualityInput.value = "88";

  controls.append(
    field("Format", formatSelect),
    field("Max width", widthInput),
    field("Max height", heightInput),
    field("JPEG quality", qualityInput),
  );

  const note = element("div", "rename-hint");
  note.textContent = "Leave width and height empty to preserve dimensions. PNG and WebP are written losslessly; quality applies to JPEG. Long batches appear in Operations and can be cancelled.";
  const resultNode = element("div", "image-tools-results");
  const actions = element("div", "utility-actions");
  const cancel = element("button", "utility-secondary-button");
  cancel.type = "button";
  cancel.textContent = "Close";
  cancel.addEventListener("click", close);
  const convert = element("button", "utility-primary-button");
  convert.type = "button";
  convert.textContent = "Convert";
  actions.append(cancel, convert);
  body.append(controls, note, resultNode, actions);
  sheet.append(header, body);
  overlay.append(sheet);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);

  const syncQuality = () => {
    const jpeg = formatSelect.value === "jpg";
    qualityInput.disabled = !jpeg;
    qualityInput.closest("label")?.classList.toggle("disabled", !jpeg);
  };
  formatSelect.addEventListener("change", syncQuality);
  syncQuality();

  convert.addEventListener("click", async () => {
    convert.disabled = true;
    convert.textContent = "Queued…";
    resultNode.classList.remove("utility-error");
    resultNode.textContent = "Added to Operations…";
    try {
      const results = await enqueueAndWait<ImageTransformResult[]>(
        "enqueue_image_transform",
        {
          paths,
          destination,
          options: {
            format: formatSelect.value,
            maxWidth: optionalDimension(widthInput),
            maxHeight: optionalDimension(heightInput),
            quality: Math.max(1, Math.min(100, Number(qualityInput.value) || 88)),
          },
        },
        (job: OperationJob<ImageTransformResult[]>) => {
          if (!overlay) return;
          convert.textContent = job.status === "queued" ? "Queued…" : "Converting…";
          resultNode.textContent = job.detail ?? "Converting images…";
        },
      );
      if (!overlay) return;
      resultNode.replaceChildren();
      for (const result of results) {
        const row = element("div", "image-tools-result");
        const name = element("span", "image-tools-result-name");
        name.textContent = result.output.split(/[\\/]/).pop() ?? result.output;
        const meta = element("span", "image-tools-result-meta");
        meta.textContent = `${result.width} × ${result.height} · ${result.format.toUpperCase()}`;
        row.append(name, meta);
        resultNode.append(row);
      }
      convert.textContent = "Done";
    } catch (error) {
      if (!overlay) return;
      resultNode.textContent = String(error);
      resultNode.classList.add("utility-error");
      convert.disabled = false;
      convert.textContent = "Convert";
    }
  });
}

export function installImageTools() {
  const unregister = registerAction({
    id: "tools.convert-images",
    title: "Convert / Resize Images…",
    category: "Tools",
    keywords: ["image", "resize", "convert", "webp", "png", "jpeg", "jpg"],
    contextMenu: true,
    contextMenuOrder: 122,
    available: (context) => imagePaths(context).length > 0,
    run: async (context) => {
      const paths = imagePaths(context);
      if (!paths.length || !context.panePath) throw new Error("Select one or more images to convert");
      await openImageTools(paths, context.panePath);
    },
  });

  return () => {
    unregister();
    close();
  };
}
