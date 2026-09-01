import { render } from "solid-js/web";
import App from "./App";
import { installInternalPointerDrag } from "./lib/internal-drag";
import { installNativeFileDrop } from "./lib/native-drop";
import { installQuickLook } from "./lib/quick-look";
import "./styles.css";
import "./native-drop.css";
import "./internal-drag.css";
import "./quick-look.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Scout root element was not found");
}

const nativeDropCleanup = installNativeFileDrop();
const internalDragCleanup = installInternalPointerDrag();
const quickLookCleanup = installQuickLook();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    internalDragCleanup();
    quickLookCleanup();
    void nativeDropCleanup.then((cleanup) => cleanup());
  });
}

render(() => <App />, root);
