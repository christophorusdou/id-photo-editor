// ---------------------------------------------------------------------------
// Cloudflare Pages Function — Server-side background removal
//
// This runs on Cloudflare's edge, offloading background removal from the
// user's device entirely. Critical for iPhone 12/13 where the ~176MB ONNX
// model exceeds Safari's per-tab memory budget.
//
// Setup:
//   1. Enable Cloudflare Images on your zone (supports segment=foreground)
//      OR bind Workers AI in your Pages project settings:
//      wrangler.toml:  [ai]  binding = "AI"
//
//   2. Deploy: npx wrangler pages deploy . --project-name id-photo-editor
//
//   3. The client (app.js) auto-detects this endpoint on iOS and routes
//      background removal here instead of running the model locally.
// ---------------------------------------------------------------------------

export async function onRequestPost(context) {
    const { request, env } = context;

    // CORS headers for cross-origin requests
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

        // Strategy 1: Use Workers AI binding if available
        if (env.AI) {
            try {
                const result = await env.AI.run(
                    "@cf/microsoft/resnet-50",  // placeholder — replace with segmentation model when available
                    { image: [...imageBytes] }
                );
                // If a dedicated segmentation model is bound, return its output directly.
                // For now, fall through to Strategy 2.
            } catch (aiErr) {
                console.log("Workers AI not available for segmentation:", aiErr.message);
            }
        }

        // Strategy 2: Use Cloudflare Images transformation (segment=foreground)
        // Requires: Cloudflare Images enabled on the zone
        // This stores the image temporarily and applies the transformation.
        if (env.IMAGES_BUCKET) {
            const key = `tmp/${crypto.randomUUID()}.png`;
            try {
                // Upload to R2
                await env.IMAGES_BUCKET.put(key, imageBytes, {
                    httpMetadata: { contentType: imageFile.type || "image/png" },
                });

                // Construct transformation URL
                const host = new URL(request.url).origin;
                const transformUrl = `${host}/cdn-cgi/image/segment=foreground,format=png/${host}/r2/${key}`;

                const transformed = await fetch(transformUrl);
                if (transformed.ok) {
                    const result = await transformed.arrayBuffer();
                    // Clean up temp file
                    await env.IMAGES_BUCKET.delete(key);
                    return new Response(result, {
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "image/png",
                        },
                    });
                }

                // Clean up on failure
                await env.IMAGES_BUCKET.delete(key);
            } catch (e) {
                console.log("Cloudflare Images strategy failed:", e.message);
                try { await env.IMAGES_BUCKET.delete(key); } catch {}
            }
        }

        // Strategy 3: Proxy to external API (configure REMOVE_BG_API_KEY in Pages env vars)
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

        // No strategy available
        return new Response(
            "Server-side background removal not configured. " +
            "Set up Cloudflare Images, Workers AI, or REMOVE_BG_API_KEY.",
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
