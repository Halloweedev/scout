import "../destructive-confirm.css";

export interface DestructiveConfirmationOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PendingConfirmation {
  options: DestructiveConfirmationOptions;
  resolve: (confirmed: boolean) => void;
}

interface ActiveConfirmation extends PendingConfirmation {
  backdrop: HTMLDivElement;
}

let active: ActiveConfirmation | null = null;
let queue: PendingConfirmation[] = [];
let nextId = 1;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function finish(confirmed: boolean) {
  const current = active;
  if (!current) return;
  active = null;
  current.backdrop.remove();
  current.resolve(confirmed);
  queueMicrotask(showNext);
}

function showNext() {
  if (active || !queue.length) return;
  const request = queue.shift()!;
  const id = nextId++;
  const titleId = `scout-destructive-confirm-title-${id}`;
  const descriptionId = `scout-destructive-confirm-description-${id}`;

  const backdrop = element("div", "destructive-confirm-backdrop");
  const panel = element("section", "destructive-confirm-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", titleId);
  panel.setAttribute("aria-describedby", descriptionId);

  const copy = element("div", "destructive-confirm-copy");
  const title = element("h2", "destructive-confirm-title");
  title.id = titleId;
  title.textContent = request.options.title;
  const message = element("p", "destructive-confirm-message");
  message.id = descriptionId;
  message.textContent = request.options.message;
  copy.append(title, message);

  if (request.options.detail) {
    const detail = element("p", "destructive-confirm-detail");
    detail.textContent = request.options.detail;
    copy.append(detail);
  }

  const actions = element("div", "destructive-confirm-actions");
  const cancel = element("button", "destructive-confirm-button secondary");
  cancel.type = "button";
  cancel.autofocus = true;
  cancel.textContent = request.options.cancelLabel ?? "Cancel";
  cancel.addEventListener("click", () => finish(false));

  const confirm = element("button", "destructive-confirm-button danger");
  confirm.type = "button";
  confirm.textContent = request.options.confirmLabel ?? "Confirm";
  confirm.addEventListener("click", () => finish(true));
  actions.append(cancel, confirm);

  panel.append(copy, actions);
  backdrop.append(panel);
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) finish(false);
  });

  active = { ...request, backdrop };
  document.body.append(backdrop);
}

export function confirmDestructive(options: DestructiveConfirmationOptions) {
  return new Promise<boolean>((resolve) => {
    queue.push({ options, resolve });
    showNext();
  });
}

function cancelAll() {
  if (active) finish(false);
  const pending = queue;
  queue = [];
  for (const request of pending) request.resolve(false);
}

if (import.meta.hot) {
  import.meta.hot.dispose(cancelAll);
}
