const EDGE_SIZE = 44;
const MAX_SPEED = 18;

let frame: number | null = null;
let verticalTarget: HTMLElement | null = null;
let horizontalTarget: HTMLElement | null = null;
let verticalSpeed = 0;
let horizontalSpeed = 0;

function edgeSpeed(position: number, start: number, end: number) {
  const fromStart = position - start;
  const fromEnd = end - position;
  if (fromStart >= 0 && fromStart < EDGE_SIZE) {
    return -MAX_SPEED * (1 - fromStart / EDGE_SIZE);
  }
  if (fromEnd >= 0 && fromEnd < EDGE_SIZE) {
    return MAX_SPEED * (1 - fromEnd / EDGE_SIZE);
  }
  return 0;
}

function stopFrame() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}

function reset() {
  stopFrame();
  verticalTarget = null;
  horizontalTarget = null;
  verticalSpeed = 0;
  horizontalSpeed = 0;
}

function tick() {
  frame = null;
  if (!document.documentElement.classList.contains("internal-file-drag")) {
    reset();
    return;
  }

  let moved = false;
  if (verticalTarget && verticalSpeed) {
    const before = verticalTarget.scrollTop;
    verticalTarget.scrollTop += verticalSpeed;
    moved ||= verticalTarget.scrollTop !== before;
  }
  if (horizontalTarget && horizontalSpeed) {
    const before = horizontalTarget.scrollLeft;
    horizontalTarget.scrollLeft += horizontalSpeed;
    moved ||= horizontalTarget.scrollLeft !== before;
  }

  if ((verticalSpeed || horizontalSpeed) && moved) frame = requestAnimationFrame(tick);
}

function ensureFrame() {
  if (frame === null && (verticalSpeed || horizontalSpeed)) frame = requestAnimationFrame(tick);
}

function handlePointerMove(event: PointerEvent) {
  if (!document.documentElement.classList.contains("internal-file-drag")) {
    reset();
    return;
  }

  const hit = document.elementFromPoint(event.clientX, event.clientY);
  if (!hit) {
    reset();
    return;
  }

  verticalTarget = hit.closest<HTMLElement>(".column-browser-list, .file-area, .sidebar");
  horizontalTarget = hit.closest<HTMLElement>(".column-browser");

  if (verticalTarget && verticalTarget.scrollHeight > verticalTarget.clientHeight) {
    const rect = verticalTarget.getBoundingClientRect();
    verticalSpeed = edgeSpeed(event.clientY, rect.top, rect.bottom);
  } else {
    verticalTarget = null;
    verticalSpeed = 0;
  }

  if (horizontalTarget && horizontalTarget.scrollWidth > horizontalTarget.clientWidth) {
    const rect = horizontalTarget.getBoundingClientRect();
    horizontalSpeed = edgeSpeed(event.clientX, rect.left, rect.right);
  } else {
    horizontalTarget = null;
    horizontalSpeed = 0;
  }

  if (!verticalSpeed && !horizontalSpeed) stopFrame();
  else ensureFrame();
}

export function installDragAutoscroll() {
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", reset);
  window.addEventListener("pointercancel", reset);

  return () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", reset);
    window.removeEventListener("pointercancel", reset);
    reset();
  };
}
