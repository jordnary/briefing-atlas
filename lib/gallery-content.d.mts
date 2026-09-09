export type GalleryImage = {
  src: string;
  alt: string;
  caption: string;
  captionHtml?: string;
};
export function galleryParts(
  html: string,
): Array<{ html: string } | { images: GalleryImage[] }>;
