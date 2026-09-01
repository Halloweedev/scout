import type { JSX } from "solid-js";

export type IconName =
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "chevron-down"
  | "close"
  | "copy"
  | "desktop"
  | "document"
  | "download"
  | "eye"
  | "file"
  | "folder"
  | "home"
  | "link"
  | "more"
  | "new-folder"
  | "plus"
  | "scout"
  | "split"
  | "trash";

interface IconProps {
  name: IconName;
  size?: number;
  class?: string;
}

const iconContent: Record<IconName, JSX.Element> = {
  "arrow-left": <path d="M15 18l-6-6 6-6" />,
  "arrow-right": <path d="M9 6l6 6-6 6" />,
  "arrow-up": <path d="M12 19V5m-5 5 5-5 5 5" />,
  "chevron-down": <path d="m8 10 4 4 4-4" />,
  close: <path d="m8 8 8 8m0-8-8 8" />,
  copy: <><rect x="8" y="8" width="10" height="10" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  desktop: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  document: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" />,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
  file: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /></>,
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />,
  home: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
  link: <><path d="M10.5 13.5 13.5 10.5" /><path d="M8.2 15.8 6.4 17.6a3.4 3.4 0 0 1-4.8-4.8l3.6-3.6A3.4 3.4 0 0 1 10 9" /><path d="m14 15 4.8-4.8a3.4 3.4 0 0 0-4.8-4.8l-1.8 1.8" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  "new-folder": <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /><path d="M12 10v6m-3-3h6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  scout: <><path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" /><path d="m8.5 10 3.5-2 3.5 2-3.5 2zM8.5 14l3.5 2 3.5-2" /></>,
  split: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7" /><path d="M10 11v6m4-6v6" /></>,
};

export default function Icon(props: IconProps) {
  return (
    <svg
      class={props.class}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {iconContent[props.name]}
    </svg>
  );
}
