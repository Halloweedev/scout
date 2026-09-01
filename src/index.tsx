import { render } from "solid-js/web";
import App from "./App";
import { installDuplicateFinder } from "./lib/duplicates";
import { installGlobalSearch } from "./lib/global-search";
import { installImageThumbnails } from "./lib/thumbnails";
import { installInternalPointerDrag } from "./lib/internal-drag";
import { installNativeFileDrop } from "./lib/native-drop";
import { installQuickLook } from "./lib/quick-look";
import { installUtilities } from "./lib/utilities";
import "./styles.css";
import "./native-drop.css";
import "./internal-drag.css";
import "./quick-look.css";
import "./rich-previews.css";
import "./thumbnails.css";
import "./global-search.css";
import "./utilities.css";
import "./duplicates.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Scout root element was not found");
}

const nativeDropCleanup = installNativeFileDrop();
const internalDragCleanup = installInternalPointerDrag();
const quickLookCleanup = installQuickLook();
const thumbnailCleanup = installImageThumbnails();
const globalSearchCleanup = installGlobalSearch();
const utilitiesCleanup = installUtilities();
const duplicateFinderCleanup = installDuplicateFinder();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    internalDragCleanup();
    quickLookCleanup();
    thumbnailCleanup();
    globalSearchCleanup();
    utilitiesCleanup();
    duplicateFinderCleanup();
    void nativeDropCleanup.then((cleanup) => cleanup());
  });
}

render(() => <App />, root);