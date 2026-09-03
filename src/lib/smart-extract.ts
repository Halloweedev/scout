import { registerAction, type ScoutActionContext } from "./actions";
import { enqueueAndWait } from "./operation-queue";

interface SmartExtractResult {
  archive: string;
  destination: string;
  entries: number;
  layout: "single-root" | "wrapped";
}

function selectedZip(context: ScoutActionContext) {
  if (!context.panePath || context.selection.length !== 1) return null;
  const entry = context.selection[0];
  if (entry.kind !== "file" || entry.extension?.toLocaleLowerCase() !== "zip") return null;
  return entry;
}

function toast(message: string, error = false) {
  window.dispatchEvent(new CustomEvent("scout:toast", { detail: { message, error } }));
}

async function smartExtract(context: ScoutActionContext) {
  const entry = selectedZip(context);
  if (!entry || !context.panePath) throw new Error("Select one ZIP archive");
  toast("Smart Extract added to Operations");
  const result = await enqueueAndWait<SmartExtractResult>(
    "enqueue_smart_zip_extraction",
    { path: entry.path, destination: context.panePath },
  );
  const name = result.destination.split(/[\\/]/).filter(Boolean).at(-1) ?? result.destination;
  toast(result.layout === "single-root"
    ? `Extracted ${result.entries} items into ${name}`
    : `Extracted ${result.entries} items into ${name}`);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }));
}

export function installSmartExtract() {
  return registerAction({
    id: "utilities.smart-extract",
    title: "Smart Extract ZIP",
    category: "Tools",
    subtitle: "Avoid unnecessary nested folders when the archive already contains one",
    keywords: ["zip", "archive", "extract", "unpack", "smart extract", "files"],
    contextMenu: true,
    contextMenuOrder: 92,
    available: (context) => !!selectedZip(context),
    run: smartExtract,
  });
}
