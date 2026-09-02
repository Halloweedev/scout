import type { ComponentProps } from "solid-js";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ArrowUpIcon as ArrowUp,
  CaretDownIcon as CaretDown,
  XIcon as X,
  CopyIcon as Copy,
  MonitorIcon as Monitor,
  FileTextIcon as FileText,
  DownloadIcon as Download,
  EyeIcon as Eye,
  EyeSlashIcon as EyeSlash,
  FileIcon as File,
  FolderIcon as Folder,
  FolderPlusIcon as FolderPlus,
  HouseIcon as House,
  LinkIcon as Link,
  DotsThreeIcon as DotsThree,
  PlusIcon as Plus,
  HexagonIcon as Hexagon,
  ColumnsIcon as Columns,
  TrashIcon as Trash,
  MagnifyingGlassIcon as MagnifyingGlass,
  SquaresFourIcon as SquaresFour,
  RowsIcon as Rows,
  GearIcon as Gear,
  HardDrivesIcon as HardDrives,
  CloudIcon as Cloud,
  GlobeIcon as Globe,
  MusicNotesIcon as MusicNotes,
  ImagesSquareIcon as ImagesSquare,
  VideoIcon as Video,
  HardDriveIcon as HardDrive,
  NetworkIcon as Network,
} from "@transitionsag/phosphor-solid";

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
  | "eye-slash"
  | "file"
  | "folder"
  | "folder-open"
  | "home"
  | "link"
  | "more"
  | "new-folder"
  | "plus"
  | "scout"
  | "split"
  | "trash"
  | "search"
  | "grid"
  | "rows"
  | "columns"
  | "gear"
  | "hard-drive"
  | "hard-drives"
  | "cloud"
  | "globe"
  | "music"
  | "image"
  | "video"
  | "network"
  | "cloud-arrow-down";

interface IconProps {
  name: IconName;
  size?: number;
  class?: string;
  weight?: ComponentProps<typeof House>["weight"];
}

export default function Icon(props: IconProps) {
  const size = () => props.size ?? 16;
  const weight = () => props.weight ?? "regular";
  const cls = () => props.class;

  const dim = () => size();

  switch (props.name) {
    case "arrow-left":
      return <ArrowLeft width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "arrow-right":
      return <ArrowRight width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "arrow-up":
      return <ArrowUp width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "chevron-down":
      return <CaretDown width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "close":
      return <X width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "copy":
      return <Copy width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "desktop":
      return <Monitor width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "document":
      return <FileText width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "download":
      return <Download width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "eye":
      return <Eye width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "eye-slash":
      return <EyeSlash width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "file":
      return <File width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "folder":
      return <Folder width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "folder-open":
      return <Folder width={dim()} height={dim()} weight="fill" class={cls()} />;
    case "home":
      return <House width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "link":
      return <Link width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "more":
      return <DotsThree width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "new-folder":
      return <FolderPlus width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "plus":
      return <Plus width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "scout":
      return <Hexagon width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "split":
      return <Columns width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "trash":
      return <Trash width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "search":
      return <MagnifyingGlass width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "grid":
      return <SquaresFour width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "rows":
      return <Rows width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "columns":
      return <Columns width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "gear":
      return <Gear width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "hard-drive":
      return <HardDrive width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "hard-drives":
      return <HardDrives width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "cloud":
      return <Cloud width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "cloud-arrow-down":
      return <Cloud width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "globe":
      return <Globe width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "music":
      return <MusicNotes width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "image":
      return <ImagesSquare width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "video":
      return <Video width={dim()} height={dim()} weight={weight()} class={cls()} />;
    case "network":
      return <Network width={dim()} height={dim()} weight={weight()} class={cls()} />;
    default:
      return <Folder width={dim()} height={dim()} weight={weight()} class={cls()} />;
  }
}
