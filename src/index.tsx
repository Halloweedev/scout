import { render } from "solid-js/web";
import App from "./App";
import { installInternalPointerDrag } from "./lib/internal-drag";
import { installNativeFileDrop } from "./lib/native-drop";
import "./styles.css";
import "./native-drop.css";
import "./internal-drag.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Scout root element was not found");
}

const nativeDropCleanup = installNativeFileDrop();
const internalDragCleanup = installInternalPointerDrag();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    internalDragCleanup();
    void nativeDropCleanup.then((cleanup) => cleanup());
  });
}

render(() => <App />, root);
