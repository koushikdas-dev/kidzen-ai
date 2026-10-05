// ==================================================
// CONFIGURATION
// ==================================================

const ALLOWED_QUALITIES = [
  "low",
  "medium",
  "high",
];

const ALLOWED_VARIANT_COUNTS = [
  1,
  2,
  3,
  4,
];

const MAX_REFERENCE_IMAGE_SIZE = 10 * 1024 * 1024;
const MODERATION_MODEL = "omni-moderation-latest";

const OPENAI_MODEL =
  "gpt-image-2";

const IMAGE_SIZE =
  "1024x1024";

const IMAGE_OUTPUT_FORMAT =
  "webp";

// WebP compression.
// 100 = highest quality / larger file
// Lower values = smaller file
const IMAGE_OUTPUT_COMPRESSION =
  90;

const POST_CONTENT_MODEL =
  "gpt-4o-mini";


// ==================================================
// WORKER
// ==================================================

export default {

  async fetch(
    request,
    env
  ) {

    // ==================================================
    // CORS
    // ==================================================

    const corsHeaders = {

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Methods":
        "POST, OPTIONS, GET, DELETE",

      "Access-Control-Allow-Headers":
        "Content-Type, X-Veyora-User-Id, X-Veyora-Plan, X-Veyora-Timezone, X-BrandCraft-User-Id, X-BrandCraft-Plan, X-BrandCraft-Timezone, X-Hypezy-User-Id, X-Hypezy-Plan, X-Hypezy-Timezone",

    };


    // ==================================================
    // OPTIONS / PREFLIGHT
    // ==================================================

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,

          headers:
            corsHeaders,
        }
      );
    }


    // ==================================================
    // URL
    // ==================================================

    const url =
      new URL(
        request.url
      );


    // ==================================================
    // ENDPOINT CHECK
    // ==================================================

    const allowedEndpoints = [

      "/generate",

      "/upload-reference",

      "/ideas",

      "/upload-brand-logo",

      "/delete-brand-logo",

      "/brand-logo",

    ];


    if (
      !allowedEndpoints.includes(
        url.pathname
      )
    ) {

      return jsonResponse(

        {

          success:
            false,

          message:
            "Endpoint not found",

        },

        404,

        corsHeaders

      );

    }


    // ==================================================
    // METHOD CHECK
    // ==================================================

    if (
      request.method !== "POST" &&
      !(
        url.pathname ===
        "/brand-logo" &&
        request.method === "GET"
      ) &&
      !(
        url.pathname ===
        "/delete-brand-logo" &&
        request.method === "DELETE"
      )
    ) {

      return jsonResponse(

        {
          success:
            false,

          message:
            "Invalid request method",
        },

        405,

        corsHeaders

      );

    }


    // ==================================================
    // ENVIRONMENT CHECK
    // ==================================================

    if (
      !env.GPT_API
    ) {

      return jsonResponse(

        {
          success:
            false,

          message:
            "OpenAI API key is not configured",
        },

        500,

        corsHeaders

      );

    }


    // ==================================================
    // POPULAR IDEAS
    // ==================================================

    if (
      url.pathname ===
      "/ideas"
    ) {

      try {

        return await generatePopularIdeas(
          request,
          env,
          corsHeaders
        );

      } catch (
        error
      ) {

        console.error(
          "Ideas Error:",
          error
        );

        return jsonResponse(

          {
            success:
              false,

            message:
              "Failed to generate popular ideas",

            code:
              "INTERNAL_ERROR",

          },

          500,

          corsHeaders

        );

      }

    }


    // ==================================================
    // R2 CHECK
    // ==================================================

    if (
      !env.IMAGE_BUCKET
    ) {

      return jsonResponse(

        {
          success:
            false,

          message:
            "R2 IMAGE_BUCKET binding is not configured",
        },

        500,

        corsHeaders

      );

    }


    if (
      !env.IMAGE_BASE_URL
    ) {

      return jsonResponse(

        {
          success:
            false,

          message:
            "IMAGE_BASE_URL is not configured",
        },

        500,

        corsHeaders

      );

    }


    // ==================================================
    // UPLOAD REFERENCE IMAGE
    // ==================================================

    if (
      url.pathname ===
      "/upload-reference"
    ) {

      try {

        return await uploadReferenceImage(
          request,
          env,
          corsHeaders
        );

      } catch (
        error
      ) {

        console.error(
          "Reference Upload Error:",
          error
        );

        return jsonResponse(

          {
            success:
              false,

            message:
              "Failed to upload reference image",

            code:
              "INTERNAL_ERROR",

          },

          500,

          corsHeaders

        );

      }

    }


    // ==================================================
    // UPLOAD BRAND LOGO
    // ==================================================

    if (
      url.pathname ===
      "/upload-brand-logo"
    ) {

      try {

        return await uploadBrandLogo(
          request,
          env,
          corsHeaders
        );

      } catch (
        error
      ) {

        console.error(
          "Brand Logo Upload Error:",
          error
        );

        return jsonResponse(

          {
            success:
              false,

            message:
              error?.message ||
              "Failed to upload brand logo",

          },

          500,

          corsHeaders

        );

      }

    }


    // ==================================================
    // DELETE BRAND LOGO
    // ==================================================

    if (
      url.pathname ===
      "/delete-brand-logo"
    ) {

      try {

        return await deleteBrandLogo(
          request,
          env,
          corsHeaders
        );

      } catch (
        error
      ) {

        console.error(
          "Brand Logo Delete Error:",
          error
        );

        return jsonResponse(

          {
            success:
              false,

            message:
              error?.message ||
              "Failed to delete brand logo",

          },

          500,

          corsHeaders

        );

      }

    }


    // ==================================================
    // SERVE BRAND LOGO
    // ==================================================

    if (
      url.pathname ===
      "/brand-logo" &&
      request.method ===
      "GET"
    ) {

      try {

        return await serveBrandLogo(
          request,
          env,
          corsHeaders
        );

      } catch (
        error
      ) {

        console.error(
          "Brand Logo Serve Error:",
          error
        );

        return jsonResponse(

          {
            success:
              false,

            message:
              "Brand logo not found",

          },

          404,

          corsHeaders

        );

      }

    }


    // ==================================================
    // MAIN GENERATION LOGIC
    // ==================================================

    try {

      // -----------------------------------------------
      // Read request body
      // -----------------------------------------------

      const body =
        await request.json();


      // -----------------------------------------------
      // Prompt
      // -----------------------------------------------

      const prompt =
        body?.prompt;


      // -----------------------------------------------
      // Quality
      // -----------------------------------------------

      const quality =
        body?.quality ||
        "medium";


      // -----------------------------------------------
      // Variant Count
      // -----------------------------------------------

      const requestedVariantCount =
        Number.parseInt(
          body?.variant_count,
          10
        );

      const variantCount =
        ALLOWED_VARIANT_COUNTS.includes(
          requestedVariantCount
        )
          ? requestedVariantCount
          : 1;


      // -----------------------------------------------
      // Reference image
      // -----------------------------------------------

      const referenceImageUrl =
        typeof body?.reference_image_url === "string" &&
        body.reference_image_url.trim()
          ? body.reference_image_url.trim()
          : null;


      // -----------------------------------------------
      // Brand logo
      // -----------------------------------------------

      const brandLogoUrl =
        typeof body?.brand_logo_url ===
        "string" &&
        body.brand_logo_url.trim()
          ? body.brand_logo_url.trim()
          : null;


      // -----------------------------------------------
      // Post content
      // -----------------------------------------------

      const generatePostContent =
        body?.generate_post_content ===
        true;


      const postType =
        String(
          body?.post_type ||
          "Social Post"
        ).trim() ||
        "Social Post";


      // ==================================================
      // VALIDATE PROMPT
      // ==================================================

      if (
        !prompt ||
        typeof prompt !==
        "string" ||
        prompt.trim().length ===
        0
      ) {

        return jsonResponse(

          {
            success:
              false,

            message:
              "Prompt is required",

          },

          400,

          corsHeaders

        );

      }


      // ==================================================
      // VALIDATE QUALITY
      // ==================================================

      if (
        !ALLOWED_QUALITIES.includes(
          quality
        )
      ) {

        return jsonResponse(

          {
            success:
              false,

            message:
              "Invalid quality. Allowed values: low, medium, high",

          },

          400,

          corsHeaders

        );

      }


      // ==================================================
      // DETERMINE GENERATION MODE
      // ==================================================

      const hasReferenceImage =
        typeof referenceImageUrl ===
          "string" &&
        referenceImageUrl.trim().length >
          0;

      if (hasReferenceImage && !isAllowedReferenceUrl(env, referenceImageUrl)) {

        return jsonResponse(
          {
            success: false,
            code: "INVALID_REFERENCE_IMAGE",
            message: "The reference image is not a valid Hypezy image.",
          },
          400,
          corsHeaders
        );
      }


      console.log(
        "Generation mode:",
        hasReferenceImage
          ? "EDIT EXISTING CHARACTER"
          : "CREATE NEW CHARACTER"
      );


      console.log(
        "Requested variant count:",
        variantCount
      );


      const cleanPrompt = prompt.trim();


      // ==================================================
      // CONTENT SAFETY
      // ==================================================

      const moderation =
        await moderateGenerationRequest(
          env,
          cleanPrompt,
          hasReferenceImage
            ? referenceImageUrl.trim()
            : null
        );

      if (!moderation.allowed) {

        return jsonResponse(
          {
            success: false,
            code: "CONTENT_NOT_ALLOWED",
            message: "This request cannot be used to create this image.",
          },
          400,
          corsHeaders
        );
      }


      // ==================================================
      // CLIENT-SIDE QUOTA MODE
      //
      // Generation limits and usage accounting are intentionally
      // handled by the Flutter client/Firebase for this version.
      // The Worker only performs the requested generation.
      // ==================================================

      // ==================================================
      // GENERATE IMAGE VARIANTS
      // ==================================================

      const generatedImages =
        [];


      for (
        let index = 0;
        index < variantCount;
        index++
      ) {

        const variantNumber =
          index + 1;


        console.log(
          `Generating variant ${variantNumber}/${variantCount}...`
        );


        // ------------------------------------------------
        // Create variant-specific prompt
        // ------------------------------------------------

        const variantPrompt =
          buildVariantPrompt(
            cleanPrompt,
            variantNumber,
            variantCount
          );


        let imageBase64;


        if (
          hasReferenceImage
        ) {

          // ==============================================
          // EDIT EXISTING CHARACTER / DESIGN
          // ==============================================

          imageBase64 =
            await editExistingCharacter(
              env,
              variantPrompt,
              quality,
              referenceImageUrl.trim(),
              brandLogoUrl
            );

        } else {

          // ==============================================
          // CREATE NEW CHARACTER / DESIGN
          // ==============================================

          imageBase64 =
            await generateNewCharacter(
              env,
              variantPrompt,
              quality,
              brandLogoUrl
            );

        }


        // ==================================================
        // VALIDATE IMAGE
        // ==================================================

        if (
          !imageBase64
        ) {

          throw new Error(
            `OpenAI did not return image data for variant ${variantNumber}`
          );

        }


        // ==================================================
        // DECODE BASE64
        // ==================================================

        const imageBytes =
          base64ToUint8Array(
            imageBase64
          );


        // ==================================================
        // GENERATE UNIQUE IMAGE ID
        // ==================================================

        const imageId =
          crypto.randomUUID();


        // ==================================================
        // R2 OBJECT KEY
        // ==================================================

        const objectKey =
          `generated/${imageId}.webp`;


        // ==================================================
        // SAVE IMAGE TO R2
        // ==================================================

        await env.IMAGE_BUCKET.put(

          objectKey,

          imageBytes,

          {

            httpMetadata: {

              contentType:
                "image/webp",

              cacheControl:
                "public, max-age=31536000",

            },

            customMetadata: {

              model:
                OPENAI_MODEL,

              quality:
                quality,

              type:
                hasReferenceImage
                  ? "character_edit"
                  : "character_generation",

              variant_index:
                String(
                  variantNumber
                ),

              variant_count:
                String(
                  variantCount
                ),

            },

          }

        );


        // ==================================================
        // BUILD PUBLIC URL
        // ==================================================

        const imageUrl =
          buildImageUrl(
            env.IMAGE_BASE_URL,
            objectKey
          );


        // ==================================================
        // ADD TO RESULT
        // ==================================================

        generatedImages.push({

          image_id:
            imageId,

          image_url:
            imageUrl,

          image_format:
            "webp",

          variant_index:
            variantNumber,

        });


        console.log(
          `Variant ${variantNumber}/${variantCount} generated successfully`
        );

      }


      // ==================================================
      // VALIDATE ALL VARIANTS
      // ==================================================

      if (
        generatedImages.length !==
        variantCount
      ) {

        throw new Error(
          "Not all requested image variants were generated"
        );

      }


      // ==================================================
      // USAGE ACCOUNTING
      //
      // Successful-generation counters are updated by Flutter
      // after this response is received. The Worker deliberately
      // does not write Firebase usage in client-side quota mode.
      // ==================================================

      // ==================================================
      // GENERATE SOCIAL POST CONTENT
      //
      // IMPORTANT:
      // Generate content only once for the complete set.
      // ==================================================

      let postContent =
        null;


      // Client-side plan mode is intentionally preserved. The Worker
      // does not validate subscription state or quota in this build.
      // It is only used for the existing response/watermark contract.
      const requestPlan =
        String(
          request.headers.get("X-Hypezy-Plan") ||
          request.headers.get("X-BrandCraft-Plan") ||
          request.headers.get("X-Veyora-Plan") ||
          "free"
        ).trim().toLowerCase();

      const responsePlan =
        requestPlan === "premium" ||
        requestPlan === "pro"
          ? "premium"
          : "free";

      const responseWatermarkRequired =
        responsePlan !== "premium";


      if (
        generatePostContent
      ) {

        try {

          postContent =
            await generatePostContentCopy(
              env,
              {
                postType,
                prompt:
                  cleanPrompt,
              }
            );

        } catch (
          contentError
        ) {

          console.error(
            "Post content generation failed:",
            contentError
          );

        }

      }


      // ==================================================
      // SUCCESS RESPONSE
      // ==================================================

      return jsonResponse(

        {

          success:
            true,

          quality:
            quality,

          // ---------------------------------------------
          // New variant response
          // ---------------------------------------------

          variant_count:
            variantCount,

          images:
            generatedImages,

          // ---------------------------------------------
          // Backward compatibility
          //
          // Existing Android/Flutter code that expects
          // image_url/image_id will still work.
          // ---------------------------------------------

          image_url:
            generatedImages[0]?.image_url ||
            null,

          image_id:
            generatedImages[0]?.image_id ||
            null,

          image_format:
            "webp",

          // ---------------------------------------------
          // Other response data
          // ---------------------------------------------

          post_content:
            postContent,

          generation_type:
            hasReferenceImage
              ? "edit"
              : "generation",

          watermark_required:
            responseWatermarkRequired,

          plan:
            responsePlan,

          usage:
            null,

        },

        200,

        corsHeaders

      );


    } catch (
      error
    ) {

      // ==================================================
      // ERROR
      // ==================================================

      console.error(
        "Worker Error:",
        error
      );


      return jsonResponse(

        {

          success:
            false,

          message:
            "Internal server error",

          error:
            error?.message ||
            "Unknown error",

        },

        500,

        corsHeaders

      );

    }

  },

};


// ==================================================
// CONTENT MODERATION
// ==================================================

async function moderateGenerationRequest(
  env,
  prompt,
  referenceImageUrl = null
) {

  const input = [
    {
      type: "text",
      text: prompt,
    },
  ];

  if (referenceImageUrl) {

    input.push({
      type: "image_url",
      image_url: {
        url: referenceImageUrl,
      },
    });
  }

  const response =
    await fetch(
      "https://api.openai.com/v1/moderations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.GPT_API}`,
        },
        body: JSON.stringify({
          model: MODERATION_MODEL,
          input,
        }),
      }
    );

  if (!response.ok) {

    console.error(
      "Moderation API Error:",
      await response.text()
    );

    // Fail closed: generation must not continue when safety
    // verification is unavailable.
    throw new Error(
      "Content safety verification failed"
    );
  }

  const data =
    await response.json();

  const result =
    data?.results?.[0];

  if (!result) {
    throw new Error(
      "Content safety verification returned no result"
    );
  }

  const categories =
    result?.categories || {};

  const blockedCategory =
    categories.sexual === true ||
    categories["sexual/minors"] === true ||
    categories.harassment === true ||
    categories["harassment/threatening"] === true ||
    categories.hate === true ||
    categories["hate/threatening"] === true ||
    categories.illicit === true ||
    categories["illicit/violent"] === true ||
    categories["self-harm"] === true ||
    categories["self-harm/intent"] === true ||
    categories["self-harm/instructions"] === true ||
    categories.violence === true ||
    categories["violence/graphic"] === true;

  return {
    allowed:
      result.flagged !== true &&
      !blockedCategory,
    flagged:
      result.flagged === true,
    categories,
  };
}


// ==================================================
// REFERENCE URL VALIDATION
// ==================================================

function isAllowedReferenceUrl(
  env,
  imageUrl
) {

  try {

    const allowedBase =
      new URL(env.IMAGE_BASE_URL);

    const candidate =
      new URL(imageUrl);

    return (
      candidate.origin ===
      allowedBase.origin
    );

  } catch {
    return false;
  }
}


// ==================================================
// BUILD VARIANT PROMPT
// ==================================================

function buildVariantPrompt(
  originalPrompt,
  variantNumber,
  totalVariants
) {

  if (
    totalVariants <= 1
  ) {

    return `
${originalPrompt}

GENERAL-AUDIENCE SAFETY REQUIREMENT:
Keep the result suitable for a general-audience entertainment app. Do not introduce nudity, sexually explicit or sexualized content, sexual content involving minors or young-looking characters, graphic gore, hateful or abusive imagery, self-harm promotion, or illegal/exploitative content. Keep clothing and poses non-explicit and age-appropriate.
`.trim();

  }


  const variationInstructions = [

    `
Create the requested design as Variant 1.

Keep the main subject, business message, brand identity,
visual concept, and overall intent exactly aligned with the
original request.

Use a strong, balanced primary composition suitable for
a professional social media or marketing design.
`,

    `
Create the requested design as Variant 2.

Keep the same main subject, business message, brand identity,
visual concept, and overall intent as the original request.

Create a noticeably different composition from other variants.
Experiment with the subject positioning, visual hierarchy,
camera angle or layout while keeping the core concept unchanged.
`,

    `
Create the requested design as Variant 3.

Keep the same main subject, business message, brand identity,
visual concept, and overall intent as the original request.

Use a distinct visual composition. Change the framing,
background treatment, arrangement of elements, or perspective
while maintaining consistency with the original concept.
`,

    `
Create the requested design as Variant 4.

Keep the same main subject, business message, brand identity,
visual concept, and overall intent as the original request.

Create another clearly different professional composition.
Explore a different framing, visual hierarchy, perspective,
or background arrangement without changing the core idea.
`,

  ];


  const instruction =
    variationInstructions[
      Math.min(
        variantNumber - 1,
        variationInstructions.length - 1
      )
    ];


  return `
${originalPrompt}

GENERAL-AUDIENCE SAFETY REQUIREMENT:
Keep the result suitable for a general-audience entertainment app. Do not introduce nudity, sexually explicit or sexualized content, sexual content involving minors or young-looking characters, graphic gore, hateful or abusive imagery, self-harm promotion, or illegal/exploitative content. Keep clothing and poses non-explicit and age-appropriate.

IMPORTANT VARIANT INSTRUCTION:

${instruction}

Do not create a completely different concept.
The result must remain faithful to the original generation request.

This is variant ${variantNumber} of ${totalVariants}.
`.trim();

}


// ==================================================
// GENERATE SOCIAL POST CONTENT
// ==================================================

async function generatePostContentCopy(
  env,
  {
    postType,
    prompt
  }
) {

  const response =
    await fetch(
      "https://api.openai.com/v1/responses",
      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${env.GPT_API}`,

        },

        body:
          JSON.stringify({

            model:
              env.POST_CONTENT_MODEL ||
              POST_CONTENT_MODEL,

            input: [

              {

                role:
                  "system",

                content: [

                  {

                    type:
                      "input_text",

                    text:
                      `You are the social media copywriter for Veyora AI.
Write ready-to-publish social media post content that matches the generated visual.

The post type is: ${postType}.

Rules:
- Write natural, engaging copy appropriate for a business social post.
- Match the intent of the post type exactly.
- Do not describe the image mechanically.
- Do not invent specific prices, dates, claims, addresses, offers, or facts that are not present in the user request.
- Include a concise call to action when appropriate.
- Finish with 6-12 relevant hashtags.
- Return only the post content, including the hashtags.`,

                  },

                ],

              },

              {

                role:
                  "user",

                content: [

                  {

                    type:
                      "input_text",

                    text:
                      `Create the post content for this ${postType}.

Original generation brief:
${prompt}`,

                  },

                ],

              },

            ],

            store:
              false,

          }),

      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      parseOpenAIError(
        await response.text(),
        response.status
      )
    );

  }


  const data =
    await response.json();


  const text =
    extractResponsesOutputText(
      data
    );


  if (
    !text
  ) {

    throw new Error(
      "OpenAI did not return post content"
    );

  }


  return text;

}


// ==================================================
// CREATE NEW CHARACTER / DESIGN
// ==================================================

async function generateNewCharacter(
  env,
  prompt,
  quality,
  brandLogoUrl = null
) {

  console.log(
    "Creating new character/design..."
  );


  // ==================================================
  // BRAND LOGO
  // ==================================================

  if (
    brandLogoUrl
  ) {

    const logoFile =
      await fetchImageAsFile(
        brandLogoUrl,
        "brand-logo.webp"
      );


    if (
      !logoFile
    ) {

      throw new Error(
        "Unable to load the saved brand logo."
      );

    }


    return await editWithInputImages(
      env,
      prompt,
      quality,
      [
        logoFile
      ]
    );

  }


  // ==================================================
  // OPENAI REQUEST
  // ==================================================

  const response =
    await fetch(

      "https://api.openai.com/v1/images/generations",

      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${env.GPT_API}`,

        },

        body:
          JSON.stringify({

            model:
              OPENAI_MODEL,

            prompt:
              prompt,

            quality:
              quality,

            size:
              IMAGE_SIZE,

            output_format:
              IMAGE_OUTPUT_FORMAT,

            output_compression:
              IMAGE_OUTPUT_COMPRESSION,

            background:
              "opaque",

          }),

      }

    );


  // ==================================================
  // HANDLE OPENAI ERROR
  // ==================================================

  if (
    !response.ok
  ) {

    const errorText =
      await response.text();


    console.error(
      "OpenAI Generation Error:",
      errorText
    );


    throw new Error(
      parseOpenAIError(
        errorText,
        response.status
      )
    );

  }


  // ==================================================
  // PARSE RESPONSE
  // ==================================================

  const data =
    await response.json();


  const imageBase64 =
    data
      ?.data
      ?.[0]
      ?.b64_json;


  if (
    !imageBase64
  ) {

    console.error(
      "OpenAI Generation Response:",
      data
    );


    throw new Error(
      "OpenAI did not return image data"
    );

  }


  return imageBase64;

}


// ==================================================
// REFERENCE EDIT PROMPT
// ==================================================

function buildReferenceEditPrompt(
  userPrompt
) {

  const instruction =
    String(userPrompt || "").trim() ||
    "Create a polished variation based on the provided reference image while preserving the main subject, identity, composition, and important visual characteristics.";

  return [
    "Edit the provided reference image to create the requested final image.",
    "Use the provided image as the visual reference/source and actually modify or recreate the image according to the instructions below.",
    "Preserve important subject identity and key visual characteristics from the reference unless the instructions explicitly request a change.",
    "Do not merely describe the reference image; produce the edited final image.",
    "User's creative instructions:",
    instruction,
  ].join("\n\n");

}


// ==================================================
// EDIT WITH INPUT IMAGES
// ==================================================

async function editWithInputImages(
  env,
  prompt,
  quality,
  files
) {

  const formData =
    new FormData();


  formData.append(
    "model",
    OPENAI_MODEL
  );


  formData.append(
    "prompt",
    buildReferenceEditPrompt(prompt)
  );


  for (
    const file of files
  ) {

    formData.append(
      "image",
      file
    );

  }


  formData.append(
    "quality",
    quality
  );


  formData.append(
    "size",
    IMAGE_SIZE
  );


  formData.append(
    "output_format",
    IMAGE_OUTPUT_FORMAT
  );


  formData.append(
    "output_compression",
    String(
      IMAGE_OUTPUT_COMPRESSION
    )
  );


  formData.append(
    "background",
    "opaque"
  );


  const response =
    await fetch(

      "https://api.openai.com/v1/images/edits",

      {

        method:
          "POST",

        headers: {

          "Authorization":
            `Bearer ${env.GPT_API}`,

        },

        body:
          formData,

      }

    );


  if (
    !response.ok
  ) {

    throw new Error(
      parseOpenAIError(
        await response.text(),
        response.status
      )
    );

  }


  const data =
    await response.json();


  const imageBase64 =
    data
      ?.data
      ?.[0]
      ?.b64_json;


  if (
    !imageBase64
  ) {

    throw new Error(
      "OpenAI did not return image data"
    );

  }


  return imageBase64;

}


// ==================================================
// FETCH IMAGE AS FILE
// ==================================================

async function fetchImageAsFile(
  url,
  filename
) {

  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    return null;

  }


  const bytes =
    await response.arrayBuffer();


  if (
    !bytes.byteLength
  ) {

    return null;

  }


  return new File(

    [
      bytes
    ],

    filename,

    {

      type:
        response.headers.get(
          "content-type"
        ) ||
        "image/webp",

    }

  );

}


// ==================================================
// EDIT EXISTING CHARACTER / DESIGN
// ==================================================

async function editExistingCharacter(
  env,
  prompt,
  quality,
  referenceImageUrl,
  brandLogoUrl = null
) {

  console.log(
    "Editing existing character/design..."
  );


  console.log(
    "Reference image:",
    referenceImageUrl
  );


  // ==================================================
  // DOWNLOAD REFERENCE IMAGE
  // ==================================================

  const referenceResponse =
    await fetch(
      referenceImageUrl
    );


  if (
    !referenceResponse.ok
  ) {

    throw new Error(

      `Unable to download reference image. ` +
      `Server returned ${referenceResponse.status}`

    );

  }


  // ==================================================
  // READ IMAGE BYTES
  // ==================================================

  const referenceBytes =
    await referenceResponse.arrayBuffer();


  if (
    referenceBytes.byteLength ===
    0
  ) {

    throw new Error(
      "Reference image is empty"
    );

  }


  // ==================================================
  // CONTENT TYPE
  // ==================================================

  let contentType =
    referenceResponse.headers.get(
      "content-type"
    );


  if (
    !contentType
  ) {

    contentType =
      "image/webp";

  }


  // ==================================================
  // EXTENSION
  // ==================================================

  const extension =
    getImageExtension(
      contentType
    );


  // ==================================================
  // CREATE REFERENCE FILE
  // ==================================================

  const referenceFile =
    new File(

      [
        referenceBytes
      ],

      `reference.${extension}`,

      {

        type:
          contentType,

      }

    );


  // ==================================================
  // FORM DATA
  // ==================================================

  const formData =
    new FormData();


  // ==================================================
  // MODEL
  // ==================================================

  formData.append(
    "model",
    OPENAI_MODEL
  );


  // ==================================================
  // PROMPT
  // ==================================================

  formData.append(
    "prompt",
    buildReferenceEditPrompt(prompt)
  );


  // ==================================================
  // REFERENCE IMAGE
  // ==================================================

  formData.append(
    "image",
    referenceFile
  );


  // ==================================================
  // BRAND LOGO
  // ==================================================

  if (
    brandLogoUrl
  ) {

    const logoFile =
      await fetchImageAsFile(
        brandLogoUrl,
        "brand-logo.webp"
      );


    if (
      logoFile
    ) {

      formData.append(
        "image",
        logoFile
      );

    }

  }


  // ==================================================
  // QUALITY
  // ==================================================

  formData.append(
    "quality",
    quality
  );


  // ==================================================
  // SIZE
  // ==================================================

  formData.append(
    "size",
    IMAGE_SIZE
  );


  // ==================================================
  // OUTPUT FORMAT
  // ==================================================

  formData.append(
    "output_format",
    IMAGE_OUTPUT_FORMAT
  );


  // ==================================================
  // COMPRESSION
  // ==================================================

  formData.append(
    "output_compression",
    String(
      IMAGE_OUTPUT_COMPRESSION
    )
  );


  // ==================================================
  // BACKGROUND
  // ==================================================

  formData.append(
    "background",
    "opaque"
  );


  // ==================================================
  // OPENAI EDIT REQUEST
  // ==================================================

  const response =
    await fetch(

      "https://api.openai.com/v1/images/edits",

      {

        method:
          "POST",

        headers: {

          "Authorization":
            `Bearer ${env.GPT_API}`,

        },

        body:
          formData,

      }

    );


  // ==================================================
  // HANDLE OPENAI ERROR
  // ==================================================

  if (
    !response.ok
  ) {

    const errorText =
      await response.text();


    console.error(
      "OpenAI Edit Error:",
      errorText
    );


    throw new Error(
      parseOpenAIError(
        errorText,
        response.status
      )
    );

  }


  // ==================================================
  // PARSE RESPONSE
  // ==================================================

  const data =
    await response.json();


  const imageBase64 =
    data
      ?.data
      ?.[0]
      ?.b64_json;


  if (
    !imageBase64
  ) {

    console.error(
      "OpenAI Edit Response:",
      data
    );


    throw new Error(
      "OpenAI did not return edited image data"
    );

  }


  return imageBase64;

}


// ==================================================
// FIREBASE CONTROL / QUOTA
//
// Intentionally not used in this Worker build. Quota validation
// and usage accounting are handled by Flutter/Firebase.
// ==================================================

// ==================================================
// BASE64 → UINT8ARRAY
// ==================================================

function base64ToUint8Array(
  base64
) {

  const binaryString =
    atob(
      base64
    );


  const bytes =
    new Uint8Array(
      binaryString.length
    );


  for (
    let i = 0;
    i <
    binaryString.length;
    i++
  ) {

    bytes[i] =
      binaryString.charCodeAt(
        i
      );

  }


  return bytes;

}


// ==================================================
// UINT8ARRAY → BASE64
// ==================================================

function uint8ArrayToBase64(
  bytes
) {

  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {

    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        Math.min(i + chunkSize, bytes.length)
      )
    );
  }

  return btoa(binary);
}


// ==================================================
// IMAGE EXTENSION
// ==================================================

function getImageExtension(
  contentType
) {

  const type =
    contentType
      .toLowerCase();


  if (
    type.includes(
      "png"
    )
  ) {

    return "png";

  }


  if (
    type.includes(
      "jpeg"
    ) ||
    type.includes(
      "jpg"
    )
  ) {

    return "jpg";

  }


  if (
    type.includes(
      "webp"
    )
  ) {

    return "webp";

  }


  return "webp";

}


// ==================================================
// UPLOAD BRAND LOGO
// ==================================================

async function uploadBrandLogo(
  request,
  env,
  corsHeaders
) {

  const userId =
    sanitizeControlKey(
      request.headers.get(
        "X-Veyora-User-Id"
      ) ||
      ""
    );


  if (
    !userId
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "User ID is required",

      },

      401,

      corsHeaders

    );

  }


  if (
    !env.IMAGE_BUCKET
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "R2 IMAGE_BUCKET binding is not configured",

      },

      500,

      corsHeaders

    );

  }


  const formData =
    await request.formData();


  const image =
    formData.get(
      "image"
    );


  if (
    !image ||
    typeof image ===
      "string"
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Image file is required",

      },

      400,

      corsHeaders

    );

  }


  const allowedTypes = [

    "image/jpeg",

    "image/jpg",

    "image/png",

    "image/webp",

  ];


  if (
    !allowedTypes.includes(
      image.type
    )
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Invalid image format. Allowed: JPG, PNG, WEBP",

      },

      400,

      corsHeaders

    );

  }


  if (
    image.size >
    10 *
      1024 *
      1024
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Image size must be less than 10 MB",

      },

      400,

      corsHeaders

    );

  }


  const key =
    `brand-logos/${userId}/logo.webp`;


  await env.IMAGE_BUCKET.put(

    key,

    await image.arrayBuffer(),

    {

      httpMetadata: {

        contentType:
          image.type,

        cacheControl:
          "public, max-age=31536000",

      },

      customMetadata: {

        type:
          "brand_logo",

        user_id:
          userId,

      },

    }

  );


  const logoUrl =
    `${new URL(
      request.url
    ).origin}/brand-logo?key=${encodeURIComponent(
      key
    )}`;


  return jsonResponse(

    {

      success:
        true,

      logo_r2_key:
        key,

      logo_url:
        logoUrl,

    },

    200,

    corsHeaders

  );

}


// ==================================================
// DELETE BRAND LOGO
// ==================================================

async function deleteBrandLogo(
  request,
  env,
  corsHeaders
) {

  const userId =
    sanitizeControlKey(
      request.headers.get(
        "X-Veyora-User-Id"
      ) ||
      ""
    );


  if (
    !userId
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "User ID is required",

      },

      401,

      corsHeaders

    );

  }


  const body =
    await request
      .json()
      .catch(
        () => ({})
      );


  const key =
    body?.logo_r2_key
      ?.toString() ||
    `brand-logos/${userId}/logo.webp`;


  if (
    !key.startsWith(
      `brand-logos/${userId}/`
    )
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Invalid logo key",

      },

      403,

      corsHeaders

    );

  }


  await env.IMAGE_BUCKET.delete(
    key
  );


  return jsonResponse(

    {
      success:
        true,

    },

    200,

    corsHeaders

  );

}


// ==================================================
// SERVE BRAND LOGO
// ==================================================

async function serveBrandLogo(
  request,
  env,
  corsHeaders
) {

  const url =
    new URL(
      request.url
    );


  const key =
    url.searchParams.get(
      "key"
    ) ||
    "";


  if (
    !key.startsWith(
      "brand-logos/"
    )
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Invalid logo key",

      },

      400,

      corsHeaders

    );

  }


  const object =
    await env.IMAGE_BUCKET.get(
      key
    );


  if (
    !object
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Logo not found",

      },

      404,

      corsHeaders

    );

  }


  const headers =
    new Headers(
      corsHeaders
    );


  object.writeHttpMetadata(
    headers
  );


  headers.set(
    "Cache-Control",
    "public, max-age=31536000"
  );


  return new Response(

    object.body,

    {

      status:
        200,

      headers,

    }

  );

}


// ==================================================
// BUILD IMAGE URL
// ==================================================

function buildImageUrl(
  baseUrl,
  objectKey
) {

  return (

    baseUrl.replace(
      /\/$/,
      ""
    ) +

    "/" +

    objectKey

  );

}


// ==================================================
// OPENAI ERROR PARSER
// ==================================================

function parseOpenAIError(
  errorText,
  status
) {

  try {

    const errorJson =
      JSON.parse(
        errorText
      );


    const message =
      errorJson
        ?.error
        ?.message;


    if (
      message
    ) {

      return message;

    }

  } catch (
    ignored
  ) {

    // Ignore JSON parsing error

  }


  return (
    `OpenAI request failed (${status})`
  );

}


// ==================================================
// JSON RESPONSE
// ==================================================

function jsonResponse(
  data,
  status,
  corsHeaders
) {

  return new Response(

    JSON.stringify(
      data
    ),

    {

      status:
        status,

      headers: {

        "Content-Type":
          "application/json",

        ...corsHeaders,

      },

    }

  );

}


// ==================================================
// POPULAR IDEAS GENERATOR
// ==================================================

async function generatePopularIdeas(
  request,
  env,
  corsHeaders
) {

  if (
    request.method !==
    "POST"
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Only POST requests are allowed",

      },

      405,

      corsHeaders

    );

  }


  const body =
    await request
      .json()
      .catch(
        () => ({})
      );


  // ==================================================
  // INPUT
  // ==================================================

  const locale =
    String(
      body?.locale ||
      "en"
    ).trim();


  const language =
    String(
      body?.language ||
      "en"
    ).trim();


  const country =
    String(
      body?.country ||
      ""
    ).trim();


  const region =
    String(
      body?.region ||
      ""
    ).trim();


  const city =
    String(
      body?.city ||
      ""
    ).trim();


  const timezone =
    String(
      body?.timezone ||
      "UTC"
    ).trim();


  const localDate =
    String(
      body?.local_date ||
      ""
    ).trim();


  const businessType =
    String(
      body?.business_type ||
      ""
    ).trim();


  // ==================================================
  // COUNT
  // ==================================================

  let count =
    Number.parseInt(
      body?.count,
      10
    );


  if (
    !Number.isFinite(
      count
    )
  ) {

    count =
      6;

  }


  count =
    Math.max(
      1,
      Math.min(
        8,
        count
      )
    );


  // ==================================================
  // SYSTEM PROMPT
  // ==================================================

  const systemPrompt = `
You are Veyora AI's Popular Ideas generator.

Generate practical content ideas for businesses that can be
turned into social posts, wishes, promotions, or business designs.

Rules:
- Consider the provided location, language, date and business type.
- Prefer relevant seasonal, cultural and business opportunities.
- Do not invent specific event dates.
- Do not assume a country when it is not provided.
- Mix wishes, social content, promotions and business ideas.
- Avoid political persuasion, unsafe content, hateful content,
  and sensitive targeting.
- Keep all text concise and useful.
- Write all user-facing text in the requested language.

category must be exactly:
Wish, Social, Promotion, Business.

The description must be a short design brief.
The suggested_message must be short editable marketing copy.
The visual_direction must be a short visual design direction.
`;


  // ==================================================
  // USER PROMPT
  // ==================================================

  const userPrompt = `
Generate exactly ${count} distinct Popular Ideas.

Location:
${city || "unknown"}, ${region || "unknown"}, ${country || "unknown"}

Language: ${language}
Locale: ${locale}
Timezone: ${timezone}
Date: ${localDate || "unknown"}
Business type: ${businessType || "general business"}

Make every idea practical for creating a marketing
or social design today.
`;


  // ==================================================
  // OPENAI REQUEST
  // ==================================================

  const response =
    await fetch(

      "https://api.openai.com/v1/responses",

      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${env.GPT_API}`,

        },

        body:
          JSON.stringify({

            model:
              env.IDEAS_MODEL ||
              "gpt-4o-mini",

            input: [

              {

                role:
                  "system",

                content: [

                  {

                    type:
                      "input_text",

                    text:
                      systemPrompt,

                  },

                ],

              },

              {

                role:
                  "user",

                content: [

                  {

                    type:
                      "input_text",

                    text:
                      userPrompt,

                  },

                ],

              },

            ],

            temperature:
              0.1,

            text: {

              format: {

                type:
                  "json_schema",

                name:
                  "popular_ideas",

                strict:
                  true,

                schema: {

                  type:
                    "object",

                  additionalProperties:
                    false,

                  properties: {

                    ideas: {

                      type:
                        "array",

                      minItems:
                        count,

                      maxItems:
                        count,

                      items: {

                        type:
                          "object",

                        additionalProperties:
                          false,

                        properties: {

                          id: {
                            type:
                              "string",
                          },

                          emoji: {
                            type:
                              "string",
                          },

                          title: {
                            type:
                              "string",
                          },

                          subtitle: {
                            type:
                              "string",
                          },

                          category: {

                            type:
                              "string",

                            enum: [

                              "Wish",

                              "Social",

                              "Promotion",

                              "Business",

                            ],

                          },

                          type: {
                            type:
                              "string",
                          },

                          date: {
                            type:
                              "string",
                          },

                          description: {
                            type:
                              "string",
                          },

                          suggested_message: {
                            type:
                              "string",
                          },

                          visual_direction: {
                            type:
                              "string",
                          },

                          expires_at: {
                            type:
                              "string",
                          },

                          priority: {

                            type:
                              "integer",

                            minimum:
                              1,

                            maximum:
                              100,

                          },

                        },

                        required: [

                          "id",

                          "emoji",

                          "title",

                          "subtitle",

                          "category",

                          "type",

                          "date",

                          "description",

                          "suggested_message",

                          "visual_direction",

                          "expires_at",

                          "priority",

                        ],

                      },

                    },

                  },

                  required: [

                    "ideas"

                  ],

                },

              },

            },

            store:
              false,

          }),
        }
      );



  // ==================================================
  // ERROR
  // ==================================================

  if (
    !response.ok
  ) {

    const errorText =
      await response.text();


    console.error(
      "OpenAI Popular Ideas Error:",
      errorText
    );


    throw new Error(
      parseOpenAIError(
        errorText,
        response.status
      )
    );

  }


  // ==================================================
  // RESPONSE
  // ==================================================

  const data =
    await response.json();


  const outputText =
    extractResponsesOutputText(
      data
    );


  if (
    !outputText
  ) {

    console.error(
      "OpenAI Popular Ideas Response:",
      data
    );


    throw new Error(
      "OpenAI did not return ideas data"
    );

  }


  // ==================================================
  // PARSE JSON
  // ==================================================

  let parsed;


  try {

    parsed =
      JSON.parse(
        outputText
      );

  } catch (
    error
  ) {

    console.error(
      "Ideas JSON Parse Error:",
      outputText
    );


    throw new Error(
      "OpenAI returned invalid ideas JSON"
    );

  }


  // ==================================================
  // NORMALIZE
  // ==================================================

  const ideas =
    Array.isArray(
      parsed?.ideas
    )

      ? parsed.ideas
          .slice(
            0,
            count
          )
          .map(
            (
              idea,
              index
            ) => ({

              id:
                String(
                  idea?.id ||
                  crypto.randomUUID()
                ),

              emoji:
                String(
                  idea?.emoji ||
                  "✨"
                ),

              title:
                String(
                  idea?.title ||
                  "Create something new"
                ),

              subtitle:
                String(
                  idea?.subtitle ||
                  "A fresh idea for your audience"
                ),

              category:
                normalizeIdeaCategory(
                  idea?.category
                ),

              type:
                String(
                  idea?.type ||
                  "general"
                ),

              date:
                String(
                  idea?.date ||
                  ""
                ),

              description:
                String(
                  idea?.description ||
                  "Create a polished design relevant to your audience."
                ),

              suggested_message:
                String(
                  idea?.suggested_message ||
                  ""
                ),

              visual_direction:
                String(
                  idea?.visual_direction ||
                  "Clean, modern branded design."
                ),

              expires_at:
                String(
                  idea?.expires_at ||
                  ""
                ),

              priority:
                Number.isFinite(
                  Number(
                    idea?.priority
                  )
                )

                  ? Number(
                      idea.priority
                    )

                  : 100 -
                    index,

            })
          )

      : [];


  // ==================================================
  // FINAL RESPONSE
  // ==================================================

  return jsonResponse(

    {

      success:
        true,

      generated_at:
        new Date().toISOString(),

      location: {

        locale,

        language,

        country,

        region,

        city,

        timezone,

        local_date:
          localDate,

        business_type:
          businessType,

      },

      ideas,

    },

    200,

    corsHeaders

  );

}


// ==================================================
// EXTRACT OPENAI RESPONSE
// ==================================================

function extractResponsesOutputText(
  data
) {

  if (
    typeof data?.output_text ===
      "string" &&
    data.output_text.trim()
  ) {

    return data.output_text.trim();

  }


  const output =
    Array.isArray(
      data?.output
    )
      ? data.output
      : [];


  for (
    const item of output
  ) {

    const content =
      Array.isArray(
        item?.content
      )
        ? item.content
        : [];


    for (
      const part of content
    ) {

      if (
        typeof part?.text ===
          "string" &&
        part.text.trim()
      ) {

        return part.text.trim();

      }

    }

  }


  return "";

}


// ==================================================
// NORMALIZE CATEGORY
// ==================================================

function normalizeIdeaCategory(
  category
) {

  const value =
    String(
      category ||
      "Social"
    )
      .trim()
      .toLowerCase();


  if (
    value === "wish" ||
    value === "wishes"
  ) {

    return "Wish";

  }


  if (
    value === "promotion" ||
    value === "promotions"
  ) {

    return "Promotion";

  }


  if (
    value === "business"
  ) {

    return "Business";

  }


  return "Social";

}


// ==================================================
// POPULAR IDEAS GENERATOR - GEMINI
// ==================================================

async function generatePopularIdeasGemini(
  request,
  env,
  corsHeaders
) {

  if (
    request.method !==
    "POST"
  ) {

    return jsonResponse(

      {
        success:
          false,

        message:
          "Only POST requests are allowed",

      },

      405,

      corsHeaders

    );

  }


  const body =
    await request
      .json()
      .catch(
        () => ({})
      );


  const locale =
    String(
      body?.locale ||
      "en"
    ).trim();


  const language =
    String(
      body?.language ||
      "en"
    ).trim();


  const country =
    String(
      body?.country ||
      ""
    ).trim();


  const region =
    String(
      body?.region ||
      ""
    ).trim();


  const city =
    String(
      body?.city ||
      ""
    ).trim();


  const timezone =
    String(
      body?.timezone ||
      "UTC"
    ).trim();


  const timezoneOffset =
    Number.isFinite(
      Number(
        body?.timezone_offset_minutes
      )
    )

      ? Number(
          body.timezone_offset_minutes
        )

      : 0;


  const localDate =
    String(
      body?.local_date ||
      ""
    ).trim();


  const localTime =
    String(
      body?.local_time ||
      ""
    ).trim();


  const businessType =
    String(
      body?.business_type ||
      ""
    ).trim();


  let count =
    Number.parseInt(
      body?.count,
      10
    );


  if (
    !Number.isFinite(
      count
    )
  ) {

    count =
      8;

  }


  count =
    Math.max(
      1,
      Math.min(
        12,
        count
      )
    );


  const systemPrompt = `
You are the Popular Ideas planner for Veyora AI, a global AI marketing and design app.

Your job is to create timely, useful content ideas that a business can turn into:
- Social media posts
- Promotional designs
- Wishes
- Business announcements
- Seasonal content
- Local event content

IMPORTANT RULES:

1. Create exactly the requested number of ideas.
2. Consider the supplied country, region, city, language, locale, timezone, date, time, and business type.
3. Do not assume the user is in India or the United States unless the location says so.
4. Prefer opportunities relevant to the next 30 days.
5. Include evergreen or seasonal business-content ideas when appropriate.
6. Mix event/festival ideas with local, seasonal, promotional, and useful business-content ideas.
7. Never invent a holiday, festival, event, date, or cultural occasion.
8. Do not create political persuasion, unsafe activities, hateful content, or sensitive targeting.
9. All user-facing text must be written in the requested language.
10. category MUST be exactly one of:
   - Wish
   - Social
   - Promotion
   - Business
11. description must be a ready-to-use design brief for Veyora AI's Create screen.
12. suggested_message must be concise, editable copy suitable for the design.
13. visual_direction must describe the visual composition and style for image generation.
14. date and expires_at can be empty strings when there is no reliable date.
15. priority must be an integer from 1 to 100.
16. Every idea must be distinct and useful.
17. Do not return markdown.
18. Return only valid JSON matching the requested schema.
`;


  const userPrompt = `
Generate exactly ${count} Popular Ideas.

Location and context:

- locale: ${locale}
- language: ${language}
- country: ${country || "unknown"}
- region: ${region || "unknown"}
- city: ${city || "unknown"}
- timezone: ${timezone}
- timezone offset minutes: ${timezoneOffset}
- local date: ${localDate || "unknown"}
- local time: ${localTime || "unknown"}
- business type: ${businessType || "general business"}

Make the ideas genuinely useful for someone creating marketing or design content around the current date and location.

Return exactly ${count} distinct ideas.
`;


  const model =
    env.IDEAS_MODEL ||
    "gemini-3.6-flash";


  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(
      env.G_TOKEN
    )}`;


  const response =
    await fetch(

      geminiUrl,

      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

        },

        body:
          JSON.stringify({

            systemInstruction: {

              parts: [

                {

                  text:
                    systemPrompt,

                },

              ],

            },

            contents: [

              {

                role:
                  "user",

                parts: [

                  {

                    text:
                      userPrompt,

                  },

                ],

              },

            ],

            generationConfig: {

              temperature:
                0.4,

              responseMimeType:
                "application/json",

              responseSchema: {

                type:
                  "OBJECT",

                properties: {

                  ideas: {

                    type:
                      "ARRAY",

                    minItems:
                      count,

                    maxItems:
                      count,

                    items: {

                      type:
                        "OBJECT",

                      properties: {

                        id: {
                          type:
                            "STRING",
                        },

                        emoji: {
                          type:
                            "STRING",
                        },

                        title: {
                          type:
                            "STRING",
                        },

                        subtitle: {
                          type:
                            "STRING",
                        },

                        category: {

                          type:
                            "STRING",

                          enum: [

                            "Wish",

                            "Social",

                            "Promotion",

                            "Business",

                          ],

                        },

                        type: {
                          type:
                            "STRING",
                        },

                        date: {
                          type:
                            "STRING",
                        },

                        description: {
                          type:
                            "STRING",
                        },

                        suggested_message: {
                          type:
                            "STRING",
                        },

                        visual_direction: {
                          type:
                            "STRING",
                        },

                        expires_at: {
                          type:
                            "STRING",
                        },

                        priority: {

                          type:
                            "INTEGER",

                          minimum:
                            1,

                          maximum:
                            100,

                        },

                      },

                      required: [

                        "id",

                        "emoji",

                        "title",

                        "subtitle",

                        "category",

                        "type",

                        "date",

                        "description",

                        "suggested_message",

                        "visual_direction",

                        "expires_at",

                        "priority",

                      ],

                    },

                  },

                },

                required: [
                  "ideas"
                ],

              },

            },

          }),

      }
    );


  if (
    !response.ok
  ) {

    const errorText =
      await response.text();


    console.error(
      "Gemini Ideas Error:",
      errorText
    );


    throw new Error(
      parseGeminiError(
        errorText,
        response.status
      )
    );

  }


  const data =
    await response.json();


  const outputText =
    data
      ?.candidates
      ?.[0]
      ?.content
      ?.parts
      ?.[0]
      ?.text ||
    "";


  if (
    !outputText
  ) {

    console.error(
      "Gemini Ideas Response:",
      data
    );


    throw new Error(
      "Gemini did not return ideas data"
    );

  }


  let parsed;


  try {

    parsed =
      JSON.parse(
        outputText
      );

  } catch (
    error
  ) {

    console.error(
      "Ideas JSON Parse Error:",
      outputText
    );


    throw new Error(
      "Gemini returned invalid ideas JSON"
    );

  }


  const ideas =
    Array.isArray(
      parsed?.ideas
    )

      ? parsed.ideas
          .slice(
            0,
            count
          )
          .map(
            (
              idea,
              index
            ) => ({

              id:
                String(
                  idea?.id ||
                  crypto.randomUUID()
                ),

              emoji:
                String(
                  idea?.emoji ||
                  "✨"
                ),

              title:
                String(
                  idea?.title ||
                  "Create something new"
                ),

              subtitle:
                String(
                  idea?.subtitle ||
                  "A fresh idea for your audience"
                ),

              category:
                normalizeIdeaCategory(
                  idea?.category
                ),

              type:
                String(
                  idea?.type ||
                  "general"
                ),

              date:
                String(
                  idea?.date ||
                  ""
                ),

              description:
                String(
                  idea?.description ||
                  "Create a polished social design that is relevant to your audience."
                ),

              suggested_message:
                String(
                  idea?.suggested_message ||
                  ""
                ),

              visual_direction:
                String(
                  idea?.visual_direction ||
                  "Clean, modern branded design."
                ),

              expires_at:
                String(
                  idea?.expires_at ||
                  ""
                ),

              priority:
                Number.isFinite(
                  Number(
                    idea?.priority
                  )
                )

                  ? Number(
                      idea.priority
                    )

                  : 100 -
                    index,

            })
          )

      : [];


  return jsonResponse(

    {

      success:
        true,

      generated_at:
        new Date().toISOString(),

      location: {

        locale,

        language,

        country,

        region,

        city,

        timezone,

        timezone_offset_minutes:
          timezoneOffset,

        local_date:
          localDate,

        local_time:
          localTime,

        business_type:
          businessType,

      },

      ideas,

    },

    200,

    corsHeaders

  );

}


// ==================================================
// GEMINI ERROR PARSER
// ==================================================

function parseGeminiError(
  errorText,
  status
) {

  try {

    const error =
      JSON.parse(
        errorText
      );


    return (

      error?.error?.message ||

      `Gemini API request failed with status ${status}`

    );

  } catch {

    return `Gemini API request failed with status ${status}`;

  }

}


// ==================================================
// UPLOAD REFERENCE IMAGE
// ==================================================

async function uploadReferenceImage(
  request,
  env,
  corsHeaders
) {

  if (request.method !== "POST") {

    return jsonResponse(
      {
        success: false,
        message: "Only POST requests are allowed",
      },
      405,
      corsHeaders
    );
  }

  if (!env.IMAGE_BUCKET) {

    return jsonResponse(
      {
        success: false,
        message: "R2 IMAGE_BUCKET binding is not configured",
      },
      500,
      corsHeaders
    );
  }

  if (!env.IMAGE_BASE_URL) {

    return jsonResponse(
      {
        success: false,
        message: "IMAGE_BASE_URL is not configured",
      },
      500,
      corsHeaders
    );
  }

  const formData =
    await request.formData();

  const image =
    formData.get("image");

  if (!image || typeof image === "string") {

    return jsonResponse(
      {
        success: false,
        message: "Image file is required",
      },
      400,
      corsHeaders
    );
  }

  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ];

  if (!allowedTypes.includes(image.type)) {

    return jsonResponse(
      {
        success: false,
        message: "Invalid image format. Allowed: JPG, PNG, WEBP",
      },
      400,
      corsHeaders
    );
  }

  if (image.size > MAX_REFERENCE_IMAGE_SIZE) {

    return jsonResponse(
      {
        success: false,
        message: "Image size must be less than 10 MB",
      },
      400,
      corsHeaders
    );
  }

  const imageBytes =
    await image.arrayBuffer();

  const imageBase64 =
    uint8ArrayToBase64(
      new Uint8Array(imageBytes)
    );

  const moderation =
    await moderateGenerationRequest(
      env,
      "Reference image for a general-audience character/design generator.",
      `data:${image.type};base64,${imageBase64}`
    );

  if (!moderation.allowed) {

    return jsonResponse(
      {
        success: false,
        code: "CONTENT_NOT_ALLOWED",
        message: "This image cannot be used as a reference.",
      },
      400,
      corsHeaders
    );
  }

  const extension =
    getImageExtension(image.type);

  const imageId =
    crypto.randomUUID();

  const objectKey =
    `references/${imageId}.${extension}`;

  await env.IMAGE_BUCKET.put(
    objectKey,
    imageBytes,
    {
      httpMetadata: {
        contentType: image.type,
        cacheControl: "public, max-age=86400",
      },
      customMetadata: {
        type: "character_reference",
        moderation: "approved",
        moderation_model: MODERATION_MODEL,
      },
    }
  );

  const imageUrl =
    buildImageUrl(
      env.IMAGE_BASE_URL,
      objectKey
    );

  return jsonResponse(
    {
      success: true,
      image_url: imageUrl,
      image_id: imageId,
    },
    200,
    corsHeaders
  );
}

