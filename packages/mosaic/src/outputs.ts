export type MosaicOutputType =
  | "master"
  | "revealPreview"
  | "socialPreview"
  | "squarePreview"
  | "print20x30"
  | "print18x24"
  | "print12x18"
  | "phoneWallpaper"
  | "desktopWallpaper";

export const downloadOutputTypes: Record<MosaicOutputType, { filename: string; label: string }> = {
  master: { filename: "master-24x36.jpg", label: "24x36 master" },
  revealPreview: { filename: "reveal-1080x1920.jpg", label: "Reveal video mosaic" },
  print20x30: { filename: "print-20x30.jpg", label: "20x30 print" },
  print18x24: { filename: "print-18x24.jpg", label: "18x24 print" },
  print12x18: { filename: "print-12x18.jpg", label: "12x18 print" },
  phoneWallpaper: { filename: "wallpaper-phone.jpg", label: "Phone wallpaper" },
  desktopWallpaper: { filename: "wallpaper-desktop.jpg", label: "Desktop wallpaper" },
  socialPreview: { filename: "preview-social-1080x1350.jpg", label: "Social preview" },
  squarePreview: { filename: "preview-square-1080x1080.jpg", label: "Square preview" }
};
