import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export type { Update } from "@tauri-apps/plugin-updater";

export async function fetchUpdate(): Promise<Update | null> {
  return check();
}

export async function installUpdate(
  update: Update,
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(downloaded, total);
    }
  });
}

export async function notifyUpdate(version: string): Promise<void> {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  await sendNotification({
    title: "Supersiftr update available",
    body: `Supersiftr v${version} is ready to install. Open Settings to get it.`,
  });
}