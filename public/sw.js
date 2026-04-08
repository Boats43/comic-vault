// Comic Vault service worker — primarily to handle Web Share Target POSTs.
// When the OS shares an image into the PWA, the browser POSTs it to /share-target.
// We intercept that, stash the file in a cache, and redirect to /?share-target=1
// so the app can pick it up on load and feed it directly to the grader.

const SHARE_CACHE = "comic-vault-share-v1";
const SHARED_IMAGE_URL = "/__shared-image";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(handleShare(event.request));
    return;
  }

  // Serve the stashed shared image when the app requests it.
  if (event.request.method === "GET" && url.pathname === SHARED_IMAGE_URL) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHARE_CACHE);
        const cached = await cache.match(SHARED_IMAGE_URL);
        if (cached) {
          // Consume it — one-shot handoff.
          await cache.delete(SHARED_IMAGE_URL);
          return cached;
        }
        return new Response("", { status: 404 });
      })()
    );
  }
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");
    if (file && file instanceof File) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        SHARED_IMAGE_URL,
        new Response(file, {
          headers: {
            "Content-Type": file.type || "image/jpeg",
            "X-Shared-Filename": file.name || "shared.jpg",
          },
        })
      );
    }
  } catch (err) {
    // Swallow — the app will just show the normal scan zone.
  }
  return Response.redirect("/?share-target=1", 303);
}
