import { getCurrentWebview } from "@tauri-apps/api/webview";
import { copyEntries, getActiveDirectory } from "./fs";

const DROP_CLASS = "native-file-drop";

function setDropActive(active: boolean) {
  document.documentElement.classList.toggle(DROP_CLASS, active);
}

export async function installNativeFileDrop(): Promise<() => void> {
  try {
    return await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDropActive(true);
        return;
      }

      if (event.payload.type === "leave") {
        setDropActive(false);
        return;
      }

      setDropActive(false);
      const destination = getActiveDirectory();
      if (!destination || event.payload.paths.length === 0) return;

      void copyEntries(event.payload.paths, destination).catch((error) => {
        console.error("Scout could not copy dropped files", error);
      });
    });
  } catch {
    return () => {};
  }
}
