import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../apps/web/public/manifest.webmanifest", import.meta.url), "utf8"));

const required = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
];

for (const icon of required) {
  const entry = manifest.icons?.find(
    (candidate) =>
      candidate.src === icon.src &&
      candidate.sizes === icon.sizes &&
      candidate.type === icon.type &&
      typeof candidate.purpose === "string" &&
      candidate.purpose.includes("any") &&
      candidate.purpose.includes("maskable"),
  );
  if (!entry) {
    throw new Error(`Manifest is missing required PNG icon entry: ${icon.src} ${icon.sizes}`);
  }
  await access(new URL(`../apps/web/public${icon.src}`, import.meta.url));
}

if (manifest.display !== "standalone") {
  throw new Error("Manifest display must stay standalone for installability");
}
if (manifest.start_url !== "/" || manifest.scope !== "/") {
  throw new Error("Manifest start_url and scope must remain rooted at /");
}

console.log("PWA manifest and installability assets verified.");
