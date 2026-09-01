import { render } from "solid-js/web";
import App from "./App";
import { installNativeFileDrop } from "./lib/native-drop";
import "./styles.css";
import "./native-drop.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Scout root element was not found");
}

const nativeDropCleanup = installNativeFileDrop();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void nativeDropCleanup.then((cleanup) => cleanup());
  });
}

render(() => <App />, root);
