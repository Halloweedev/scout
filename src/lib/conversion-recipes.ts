import { registerActions, type ScoutActionContext } from "./actions";
import { enqueueAndWait } from "./operation-queue";

interface ConversionResult {
  source: string;
  output: string;
  engine: string;
}

interface ImageTransformResult {
  source: string;
  output: string;
  width: number;
  height: number;
  format: string;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi", "webm", "mpeg", "mpg"]);
const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, "mp3", "m4a", "wav", "flac", "ogg", "aac"]);
const OFFICE_EXTENSIONS = new Set(["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp"]);

function oneFile(context: ScoutActionContext) {
  return context.selection.length === 1 && context.selection[0].kind === "file" && !!context.panePath;
}

function extension(context: ScoutActionContext) {
  return (context.selection[0]?.extension ?? "").toLocaleLowerCase();
}

function toast(message: string, error = false) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message, error } }));
}

async function media(context: ScoutActionContext, target: string, label: string) {
  if (!oneFile(context) || !context.panePath) throw new Error("Select one media file");
  const path = context.selection[0].path;
  toast(`${label} added to Operations`);
  const result = await enqueueAndWait<ConversionResult>("enqueue_media_conversion", {
    path,
    destination: context.panePath,
    target,
  });
  toast(`Created ${result.output.split(/[\\/]/).pop() ?? result.output}`);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }));
}

async function office(context: ScoutActionContext, target: string, label: string) {
  if (!oneFile(context) || !context.panePath) throw new Error("Select one document");
  const path = context.selection[0].path;
  toast(`${label} added to Operations`);
  const result = await enqueueAndWait<ConversionResult>("enqueue_libreoffice_conversion", {
    path,
    destination: context.panePath,
    target,
  });
  toast(`Created ${result.output.split(/[\\/]/).pop() ?? result.output}`);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }));
}

async function image(context: ScoutActionContext, format: "jpg" | "png" | "webp", quality = 88) {
  if (!oneFile(context) || !context.panePath) throw new Error("Select one image");
  const path = context.selection[0].path;
  toast(`Convert to ${format.toUpperCase()} added to Operations`);
  const results = await enqueueAndWait<ImageTransformResult[]>("enqueue_image_transform", {
    paths: [path],
    destination: context.panePath,
    options: { format, maxWidth: null, maxHeight: null, quality },
  });
  const output = results[0]?.output;
  if (output) toast(`Created ${output.split(/[\\/]/).pop() ?? output}`);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }));
}

export function installConversionRecipes() {
  return registerActions([
    {
      id: "recipe.image-webp",
      title: "Quick Convert to WebP",
      category: "Tools",
      subtitle: "Convert the selected image with Scout's native image engine",
      keywords: ["recipe", "image", "webp", "convert", "optimize"],
      available: (context) => oneFile(context) && IMAGE_EXTENSIONS.has(extension(context)) && extension(context) !== "webp",
      run: (context) => image(context, "webp"),
    },
    {
      id: "recipe.image-jpeg",
      title: "Quick Convert to JPEG",
      category: "Tools",
      subtitle: "JPEG quality 88",
      keywords: ["recipe", "image", "jpeg", "jpg", "convert"],
      available: (context) => oneFile(context) && IMAGE_EXTENSIONS.has(extension(context)) && !["jpg", "jpeg"].includes(extension(context)),
      run: (context) => image(context, "jpg", 88),
    },
    {
      id: "recipe.media-mp4",
      title: "Quick Convert Video to MP4",
      category: "Tools",
      subtitle: "Uses FFmpeg when installed",
      keywords: ["recipe", "video", "mp4", "ffmpeg", "convert"],
      available: (context) => oneFile(context) && VIDEO_EXTENSIONS.has(extension(context)) && extension(context) !== "mp4",
      run: (context) => media(context, "mp4", "MP4 conversion"),
    },
    {
      id: "recipe.media-audio",
      title: "Extract / Convert Audio to MP3",
      category: "Tools",
      subtitle: "Uses FFmpeg when installed",
      keywords: ["recipe", "audio", "mp3", "extract audio", "ffmpeg"],
      available: (context) => oneFile(context) && MEDIA_EXTENSIONS.has(extension(context)) && extension(context) !== "mp3",
      run: (context) => media(context, "mp3", "MP3 conversion"),
    },
    {
      id: "recipe.video-gif",
      title: "Quick Convert Video to GIF",
      category: "Tools",
      subtitle: "Uses FFmpeg when installed",
      keywords: ["recipe", "video", "gif", "animation", "ffmpeg"],
      available: (context) => oneFile(context) && VIDEO_EXTENSIONS.has(extension(context)),
      run: (context) => media(context, "gif", "GIF conversion"),
    },
    {
      id: "recipe.document-pdf",
      title: "Quick Export Document to PDF",
      category: "Tools",
      subtitle: "Uses LibreOffice when installed",
      keywords: ["recipe", "document", "pdf", "office", "export"],
      available: (context) => oneFile(context) && OFFICE_EXTENSIONS.has(extension(context)),
      run: (context) => office(context, "pdf", "PDF export"),
    },
  ]);
}
