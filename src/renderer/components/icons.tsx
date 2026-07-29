/**
 * Icons drawn in the machine's own grammar: a 16-unit grid, 1.5 stroke, butt
 * caps, mitre joins, no rounded corners anywhere. They read as engraved legends
 * on a console panel rather than as a general-purpose icon set.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const Icon = ({ size = 14, children, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="butt"
    strokeLinejoin="miter"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5" />
  </Icon>
);

export const IconOpen = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.75 13.25V3.25h4.5l1.5 2h6.5v8z" />
  </Icon>
);

export const IconSave = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.25 2.25h9l2.5 2.5v9h-11.5z" />
    <path d="M4.75 2.25v4h6v-4M4.75 13.75v-4.5h6.5v4.5" />
  </Icon>
);

export const IconPin = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 9.5v4.25M4.5 9.5h7l-1.25-2V3h.75V1.75h-6V3h.75v4.5z" />
  </Icon>
);

export const IconFolder = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.75 13.25V3.25h4.5l1.5 2h6.5v8z" />
  </Icon>
);

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
  </Icon>
);

export const IconMinimise = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h10" />
  </Icon>
);

export const IconMaximise = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.25" y="3.25" width="9.5" height="9.5" />
  </Icon>
);

export const IconRestore = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.25" y="4.75" width="8" height="8" />
    <path d="M4.75 4.75V2.25h8v8h-2.5" />
  </Icon>
);

export const IconChevronDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 5.75 8 10.25l4.5-4.5" />
  </Icon>
);

export const IconRotate = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 8a5 5 0 1 1-1.6-3.65" />
    <path d="M13.5 1.75v3.5H10" />
  </Icon>
);

export const IconTrash = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.75 3.75h10.5M6 3.75V1.75h4v2M4 3.75l.75 10.5h6.5L12 3.75" />
  </Icon>
);

export const IconHighlight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.25 13.75h11.5" />
    <path d="M4.5 11.25 10.75 5l2.5 2.5-6.25 6.25H4.5z" />
    <path d="M9.25 3.5 12 .75l3.25 3.25L12.5 6.5" transform="translate(-1.5 2)" />
  </Icon>
);

export const IconNote = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.25 2.25h11.5v8.5H8l-3.5 3v-3h-2.25z" />
    <path d="M5 5.75h6M5 8h4" />
  </Icon>
);

export const IconCursor = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.75 1.75 12 8.5l-3.5.75 2 4.25-1.75.75-2-4.25L4 12.5z" />
  </Icon>
);

export const IconSplit = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" />
    <path d="M8 2.75v10.5" />
  </Icon>
);

export const IconSource = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </Icon>
);

export const IconPreview = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" />
    <path d="M4.25 6h7.5M4.25 8.5h7.5M4.25 11h4.5" />
  </Icon>
);

export const IconZoomIn = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5M5 7h4M7 5v4" />
  </Icon>
);

export const IconZoomOut = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5M5 7h4" />
  </Icon>
);

export const IconSun = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="3.25" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4" />
  </Icon>
);

export const IconMoon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.25 9.75A5.75 5.75 0 0 1 6.25 2.75a5.75 5.75 0 1 0 7 7z" />
  </Icon>
);

export const IconListing = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.25 3.25h11.5M2.25 6.5h11.5M2.25 9.75h11.5M2.25 13h11.5" />
  </Icon>
);

export const IconConvert = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.25 5.25h9.5M9.25 2.75l2.5 2.5-2.5 2.5" />
    <path d="M13.75 10.75h-9.5M6.75 8.25l-2.5 2.5 2.5 2.5" />
  </Icon>
);

export const IconCommand = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.75 5.75h4.5v4.5h-4.5z" />
    <path d="M5.75 5.75V4a1.75 1.75 0 1 0-1.75 1.75zM10.25 5.75V4A1.75 1.75 0 1 1 12 5.75zM5.75 10.25V12a1.75 1.75 0 1 1-1.75-1.75zM10.25 10.25V12A1.75 1.75 0 1 0 12 10.25z" />
  </Icon>
);
