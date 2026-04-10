import { env } from "../config.js";

/**
 * Uploads a buffer to Bunny.net Storage API.
 * @param filename The destination filename (and path) within the storage zone.
 * @param buffer The file content buffer.
 * @returns The CDN URL path if successful, otherwise null.
 */
export async function uploadToBunny(filename: string, buffer: Buffer): Promise<string | null> {
  const zone = env.BUNNY_STORAGE_ZONE;
  const apiKey = env.BUNNY_API_KEY;

  if (!zone || !apiKey) {
    console.warn("Bunny.net credentials missing, skipping upload.");
    return null;
  }

  // Bunny.net uses PUT request to upload files directly.
  // URL format: https://storage.bunnycdn.com/{storageZone}/{path}/{filename}
  const url = `https://storage.bunnycdn.com/${zone}/${filename}`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        AccessKey: apiKey,
        "Content-Type": "application/octet-stream",
      },
      body: buffer as any, // Node 18+ fetch accepts Buffer or ReadableStream
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Bunny.net upload failed: ${response.status} ${response.statusText}`, errorText);
      return null;
    }

    // Success! Return the relative path or the full CDN URL.
    // The CDN base URL is usually defined in env.BUNNY_CDN_URL.
    return filename;
  } catch (error) {
    console.error("Error uploading to Bunny.net:", error);
    return null;
  }
}
