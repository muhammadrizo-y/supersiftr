import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LicenseStore } from "@/types";

let cache: boolean | null = null;
let promise: Promise<boolean> | null = null;
const listeners = new Set<(isPro: boolean) => void>();

function isProStatus(license: LicenseStore): boolean {
  return license.status === "active" && license.activation_id !== null;
}

function fetchStatus(): Promise<boolean> {
  if (!promise) {
    promise = invoke<LicenseStore>("get_license_status")
      .then(isProStatus)
      .catch(() => false);
  }
  return promise;
}

function refresh() {
  cache = null;
  promise = null;
  feedback();
}

function feedback() {
  void fetchStatus().then((isPro) => {
    cache = isPro;
    listeners.forEach((fn) => fn(isPro));
  });
}

listen("license-changed", refresh).catch(() => {});

export function useProStatus(): boolean {
  const [isPro, setIsPro] = useState(() => cache ?? false);

  useEffect(() => {
    listeners.add(setIsPro);
    feedback();
    return () => {
      listeners.delete(setIsPro);
    };
  }, []);

  return isPro;
}