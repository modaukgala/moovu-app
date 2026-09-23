"use client";
import { Capacitor } from "@capacitor/core";

export async function phase6NativeCapture() {
  if (!Capacitor.isNativePlatform()) throw new Error("Use the browser photo selector.");
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Camera, quality: 88, width: 2400, height: 2400, correctOrientation: true, saveToGallery: false });
  if (!photo.webPath) throw new Error("Capture was not available.");
  const response = await fetch(photo.webPath); const blob = await response.blob();
  return new File([blob], "capture.jpg", { type: blob.type || "image/jpeg" });
}

export async function phase6TransportImage(file: File) {
  if (file.size > 8388608) throw new Error("Choose an image under 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const node = new Image(); node.onload = () => resolve(node); node.onerror = () => reject(new Error("Image could not be decoded.")); node.src = url; });
    if (image.naturalWidth * image.naturalHeight > 24000000) throw new Error("Image has too many pixels.");
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d"); if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Image processing failed.")), "image/jpeg", 0.86));
    // Leave multipart overhead below the existing hosting request-body ceiling.
    if (blob.size > 4000000) throw new Error("Choose a smaller or less detailed capture.");
    return new File([blob], "capture.jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(url); }
}
