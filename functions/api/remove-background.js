// ---------------------------------------------------------------------------
// Cloudflare Pages Function — Server-side background removal
//
// This runs on Cloudflare's edge, offloading background removal from the
// user's device entirely. Critical for iPhone 12/13 where the ~176MB ONNX
// model exceeds Safari's per-tab memory budget.
//
// Backends (tried in order):
//   1. Cloudflare Images (segment=foreground) — needs IMAGES_BUCKET R2 binding
//   2. remove.bg API — needs REMOVE_BG_API_KEY env var
//
// Setup:
//   1. Create an R2 bucket and bind it as IMAGES_BUCKET in Pages settings,
//      OR set REMOVE_BG_API_KEY as an environment variable.
//
//   2. Deploy: npx wrangler pages deploy . --project-name id-photo-editor
//
//   3. The client (app.js) auto-detects this endpoint on iOS and routes
//      background removal here instead of running the model locally.
// ---------------------------------------------------------------------------

export async function onRequestPost(context) {
    const { request, env } = context;

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    try {
        const formData = await request.formData();
        const imageFile = formData.get("image");

        if (!imageFile) {
            return new Response("No image provided", {
                status: 400,
                headers: corsHeaders,
            });
        }

        const imageBytes = new Uint8Array(await imageFile.arrayBuffer());

        // Strategy 1: Cloudflare Images transformation (segment=foreground)
        // Requires: R2 bucket bound as IMAGES_BUCKET + Cloudflare Images enabled on zone
        // Free tier: 5,000 unique transformations/month, R2 storage/ops free tier
        if (env.IMAGES_BUCKET) {
            const key = `tmp/${crypto.randomUUID()}.png`;
            try {
                // Upload to R2 temporarily
                await env.IMAGES_BUCKET.put(key, imageBytes, {
                    httpMetadata: { contentType: imageFile.type || "image/png" },
                });

                // Apply segment=foreground transformation
                const host = new URL(request.url).origin;
                const transformUrl = `${host}/cdn-cgi/image/segment=foreground,format=png/${host}/r2/${key}`;

                const transformed = await fetch(transformUrl);
                if (transformed.ok) {
                    const result = await transformed.arrayBuffer();
                    await env.IMAGES_BUCKET.delete(key);
                    return new Response(result, {
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "image/png",
                        },
                    });
                }

                await env.IMAGES_BUCKET.delete(key);
            } catch (e) {
                console.log("Cloudflare Images strategy failed:", e.message);
                try { await env.IMAGES_BUCKET.delete(key); } catch {}
            }
        }

        // Strategy 2: Proxy to remove.bg API
        // Requires: REMOVE_BG_API_KEY env var set in Pages settings
        // Free tier: 50 preview-resolution images/month
        if (env.REMOVE_BG_API_KEY) {
            const apiResp = await fetch("https://api.remove.bg/v1.0/removebg", {
                method: "POST",
                headers: {
                    "X-Api-Key": env.REMOVE_BG_API_KEY,
                },
                body: formData,
            });

            if (apiResp.ok) {
                const result = await apiResp.arrayBuffer();
                return new Response(result, {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "image/png",
                    },
                });
            }
        }

        // No backend configured
        return new Response(
            "Server-side background removal not configured. " +
            "Set up Cloudflare Images (IMAGES_BUCKET R2 binding) or REMOVE_BG_API_KEY.",
            { status: 503, headers: corsHeaders }
        );
    } catch (err) {
        return new Response("Server error: " + err.message, {
            status: 500,
            headers: corsHeaders,
        });
    }
}

// Handle CORS preflight
export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}
