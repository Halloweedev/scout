import { render } from "solid-js/web";
import App from "./App";
import { installConverters } from "./lib/converters";
import { installDiskMap } from "./lib/disk-map";
import { installDuplicateFinder } from "./lib/duplicates";
import { installGlobalSearch } from "./lib/global-search";
import { installImageThumbnails } from "./lib/thumbnails";
import { installImageTools } from "./lib/image-tools";
import { installInternalPointerDrag } from "./lib/internal-drag";
import { installNativeFileDrop } from "./lib/native-drop";
import { installPortal } from "./lib/portal";
import { installQuickLook } from "./lib/quick-look";
import { installSimilarPhotos } from "./lib/similar-photos";
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
import "./disk-map.css";
import "./image-tools.css";
import "./similar-photos.css";
import "./portal.css";
import "./converters.css";

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
const diskMapCleanup = installDiskMap();
const imageToolsCleanup = installImageTools();
const similarPhotosCleanup = installSimilarPhotos();
const portalCleanup = installPortal();
const convertersCleanup = installConverters();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    internalDragCleanup();
    quickLookCleanup();
    thumbnailCleanup();
    globalSearchCleanup();
    utilitiesCleanup();
    duplicateFinderCleanup();
    diskMapCleanup();
    imageToolsCleanup();
    similarPhotosCleanup();
    portalCleanup();
    convertersCleanup();
    void nativeDropCleanup.then((cleanup) => cleanup());
  });
}

render(() => <App />, root);
