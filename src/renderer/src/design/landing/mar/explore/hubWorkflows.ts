import type { Template } from '../../mock'

/**
 * The Hub's workflows, as Explore › Workflows lists them. Real entries from
 * comfy.org's workflow catalog (Comfy-Org/workflow_templates,
 * templates/index.json, fetched 2026-11-11): names, descriptions, models,
 * use count, date and download size as published. The most used of each
 * catalog group, plus the ones the prototype's mock data points at.
 *
 * Derived for the prototype: `useCase` (the catalog's groups, split where a
 * group mixes two jobs: Image into generation and editing, the Tools groups
 * into Upscale and editing), `family` (the model family, for Filter),
 * `runs` (partner APIs only on Cloud) and `vramGb` (estimated from the
 * download). Thumbnails are the catalog's, bundled small in ./hub so the
 * published preview shows them (it blocks remote images).
 */
export type HubUseCase =
  | 'Image generation'
  | 'Image editing'
  | 'Video generation'
  | 'Video editing'
  | 'Upscale'
  | 'Audio'
  | '3D'
  | 'Product & ads'
  | 'Characters & fashion'
  | 'Brand & design'

export interface HubWorkflow {
  id: string
  title: string
  description: string
  useCase: HubUseCase
  family: string
  media: 'image' | 'video' | 'audio' | '3d'
  /** Partner APIs run only on Comfy Cloud; open models anywhere. */
  runs: 'local' | 'cloud' | 'both'
  usage: number
  date: string
  /** What a local build downloads, in GB (0: nothing, or Cloud only). */
  sizeGb: number
  vramGb?: number
  tutorial?: string
}

/** The catalog's order of use cases, for Filter. */
export const HUB_USE_CASES: HubUseCase[] = [
  'Image generation',
  'Image editing',
  'Video generation',
  'Video editing',
  'Upscale',
  '3D',
  'Audio',
  'Product & ads',
  'Characters & fashion',
  'Brand & design'
]

export const HUB_WORKFLOWS: HubWorkflow[] = [
  {
    id: 'image_qwen_image_2_1_image_edit',
    title: 'Qwen Image 2.1: Image Edit',
    description:
      'Edit images with Qwen-Image-2.1 by feeding two reference images through a single checkpoint that handles both generation and editing, then comparing the result against the original. Ideal for character-consistent edits, product cutout compositing with real transparency, and style-transfer passes at native 2K.',
    useCase: 'Image editing',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 15644,
    date: '2026-09-20',
    sizeGb: 26.7,
    vramGb: 24
  },
  {
    id: 'image_z_image_turbo',
    title: 'Z-Image-Turbo: Text to Image',
    description:
      'An Efficient Image Generation Foundation Model with Single-Stream Diffusion Transformer, supports English & Chinese.',
    useCase: 'Image generation',
    family: 'Z-Image',
    media: 'image',
    runs: 'both',
    usage: 14320,
    date: '2025-11-27',
    sizeGb: 20.8,
    vramGb: 12,
    tutorial: 'https://docs.comfy.org/tutorials/image/z-image/z-image-turbo'
  },
  {
    id: 'image_krea2_turbo_t2i',
    title: 'Krea-2: Text to Image',
    description:
      'Generate images from text prompts using Krea 2, a foundation model built for aesthetic quality and creative control. It focuses on rendering expressive and artistic styles. Ideal for concept art exploration, visual brainstorming, and creating stylized imagery for design projects.',
    useCase: 'Image generation',
    family: 'Krea',
    media: 'image',
    runs: 'both',
    usage: 8658,
    date: '2026-06-24',
    sizeGb: 19.1,
    vramGb: 16
  },
  {
    id: 'image_moss_image_t2i',
    title: 'MOSS-Image: Text to Image',
    description:
      'Generate an image from a text prompt with MOSS-Image, an open-weights model that reads a full scene caption and returns one finished image. A prompt upsampler expands a short request into that caption first, so a one-line description is enough. Ideal for editorial photography, product shots, and concept art.',
    useCase: 'Image generation',
    family: 'MOSS-Image',
    media: 'image',
    runs: 'both',
    usage: 5499,
    date: '2026-10-17',
    sizeGb: 22.2,
    vramGb: 16
  },
  {
    id: 'api_nano_banana_2_1_t2i',
    title: 'Nano Banana 2.1: Text to Image',
    description:
      "Generate images from text prompts using Nano Banana 2.1, Google's fast Gemini-based image model, delivering one finished image with no input files required. Ideal for brand marketing posters, e-commerce product visuals, and IP character series.",
    useCase: 'Image generation',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 5341,
    date: '2026-10-06',
    sizeGb: 0
  },
  {
    id: 'image_qwen_image_edit_2509',
    title: 'Qwen Image Edit 2509',
    description:
      'Advanced image editing with multi-image support, improved consistency, and ControlNet integration.',
    useCase: 'Image editing',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 3477,
    date: '2025-09-25',
    sizeGb: 31.8,
    vramGb: 24,
    tutorial: 'https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit'
  },
  {
    id: 'api_bytedance_seedream_5_0_pro_image_edit',
    title: 'Seedream 5.0 Pro: Image Edit',
    description:
      'Edit images with precision using Seedream 5.0 Pro, targeting specific regions while preserving lighting, depth, and texture. The workflow takes 1 input image and produces 1 output image. Ideal for product photography edits, portrait consistency adjustments, and creating structured layouts with multilingual text.',
    useCase: 'Image editing',
    family: 'Seedream',
    media: 'image',
    runs: 'cloud',
    usage: 3455,
    date: '2026-07-08',
    sizeGb: 0
  },
  {
    id: 'api_bytedance_seedream_5_0_pro_t2i',
    title: 'Seedream 5.0 Pro: Text to Image',
    description:
      'Generate images from text prompts using Seedream 5.0 Pro, producing one high-quality output. Ideal for creative concept art, marketing visual mockups, and rapid ideation for design projects.',
    useCase: 'Image generation',
    family: 'Seedream',
    media: 'image',
    runs: 'cloud',
    usage: 3233,
    date: '2026-07-08',
    sizeGb: 0
  },
  {
    id: 'image_qwen_image_2_1_turbo_image_edit',
    title: 'Qwen Image 2.1 Turbo: Image edit',
    description:
      'Edit images with Qwen-Image-2.1 by feeding two reference images through a single checkpoint that handles both generation and editing, then comparing the result against the original. Ideal for character-consistent edits, product cutout compositing with real transparency, and style-transfer passes at native 2K',
    useCase: 'Image editing',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 3147,
    date: '2026-10-13',
    sizeGb: 41.0,
    vramGb: 32
  },
  {
    id: 'api_nano_banana_pro',
    title: 'Nano Banana Pro',
    description:
      'Nano-banana Pro (Gemini 3.0 Pro Image) - Studio-quality 4K image generation and editing with enhanced text rendering and character consistency.',
    useCase: 'Image editing',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 2909,
    date: '2025-11-21',
    sizeGb: 0
  },
  {
    id: 'image_qwen_image_2_1_t2i',
    title: 'Qwen Image 2.1: Text to Image',
    description:
      'Generate images from text prompts with Qwen Image 2.1, the latest open-weight Qwen-Image model, producing a single 1024×1024 image over 25 sampling steps. Generation and instruction-based editing share one model with native 2K output, professional typography, and alpha-channel support. Ideal for poster and layout design, transparent asset creation, and rapid concept visualization.',
    useCase: 'Image generation',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 2579,
    date: '2026-09-20',
    sizeGb: 26.7,
    vramGb: 24
  },
  {
    id: 'image_p_h3_image_edit',
    title: 'P-H3-Image: Image Edit',
    description:
      "Pruna AI's few-step image model built on MiniMax-H3: edit the source image with a short instruction, up to 9 reference images, 8-step sampling.",
    useCase: 'Image editing',
    family: 'MiniMax',
    media: 'image',
    runs: 'both',
    usage: 2458,
    date: '2026-11-03',
    sizeGb: 40.4,
    vramGb: 32
  },
  {
    id: 'api_openai_gpt_image_25_sunburst_image_edit',
    title: 'GPT Image 2.5 Sunburst: Image Edit',
    description:
      'High-fidelity image editing template. Preserve original character pose, scene, lighting and composition. Only modify partial elements such as outfit, hairstyle, facial features or camera angle. Great for sequential frame generation with strong subject consistency.',
    useCase: 'Image editing',
    family: 'GPT Image',
    media: 'image',
    runs: 'cloud',
    usage: 2357,
    date: '2026-09-09',
    sizeGb: 0
  },
  {
    id: 'image_moss_image_edit',
    title: 'MOSS-Image: Image Edit LoRA',
    description:
      'Edit a photo with a short instruction using MOSS-Image and its edit LoRA: the instruction and the source image are encoded together, so the sampler redraws the same frame and only the described change is applied. Colour, material, outfit and background swaps keep the face, hair, pose and framing intact, and a Compare Images node shows the source next to the result.',
    useCase: 'Image editing',
    family: 'MOSS-Image',
    media: 'image',
    runs: 'both',
    usage: 2283,
    date: '2026-10-26',
    sizeGb: 13.3,
    vramGb: 8
  },
  {
    id: 'api_grok_image_edit',
    title: 'Grok: Image Edit',
    description:
      'Upload an image to edit with the Grok model. Generate a modified version with expressive, cinematic visuals',
    useCase: 'Image editing',
    family: 'Grok',
    media: 'image',
    runs: 'cloud',
    usage: 2234,
    date: '2026-01-28',
    sizeGb: 0
  },
  {
    id: 'api_nano_banana_2_1_image_edit',
    title: 'Nano Banana 2.1: Image Edit',
    description:
      'Edit images with natural language and mask-based local edits powered by Nano Banana 2.1, taking one input image and returning one edited result alongside a side-by-side comparison view. Ideal for brand marketing posters, e-commerce product shots, and multi-round retouching where subjects and text must stay consistent.',
    useCase: 'Image editing',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 2170,
    date: '2026-10-06',
    sizeGb: 0
  },
  {
    id: 'api_google_nano_banana2_image_edit',
    title: 'Nano Banana 2: Image Edit',
    description:
      'Upload an image and a text prompt to edit it. Generate a new image that modifies the original based on your instructions, maintaining subject consistency and high visual fidelity.',
    useCase: 'Image editing',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 2168,
    date: '2026-02-26',
    sizeGb: 0
  },
  {
    id: 'image_flux2',
    title: 'FLUX.2 Dev',
    description:
      'Generate photorealistic images with multi-reference consistency and professional text rendering.',
    useCase: 'Image editing',
    family: 'FLUX',
    media: 'image',
    runs: 'local',
    usage: 723,
    date: '2025-11-26',
    sizeGb: 74.1,
    vramGb: 24,
    tutorial: 'https://docs.comfy.org/tutorials/flux/flux-2-dev'
  },
  {
    id: 'image_qwen_image_edit_2511',
    title: 'Qwen Image Edit 2511 - Material Replacement',
    description:
      'Replace materials in objects (e.g., furniture) by combining reference images with Qwen-Image-Edit-2511.',
    useCase: 'Image editing',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 385,
    date: '2025-12-23',
    sizeGb: 51.3,
    vramGb: 24,
    tutorial: 'https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511'
  },
  {
    id: 'utility_seedvr2_image_upscale',
    title: 'Image Upscale: SeedVR2',
    description:
      'Upload an image to upscale it with SeedVR2 and generate a high-definition output.',
    useCase: 'Upscale',
    family: 'SeedVR2',
    media: 'image',
    runs: 'local',
    usage: 847,
    date: '2026-02-06',
    sizeGb: 17.7,
    vramGb: 16,
    tutorial: 'https://docs.comfy.org/tutorials/utility/image-upscale'
  },
  {
    id: 'template_qwen_multiangle.app',
    title: 'Generate Multiple Angles with 3D Camera Node',
    description:
      'Generate camera angle variations of your input with an easy to use 3D camera angle node.',
    useCase: 'Image editing',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 816,
    date: '2026-10-13',
    sizeGb: 31.2,
    vramGb: 24
  },
  {
    id: 'utility_seedvr2_7b_int8_upscale_image',
    title: 'Image Upscale: SeedVR2 7B Int8',
    description:
      'Upscale images using SeedVR2 7B Int8, a one-step diffusion model that enhances resolution through adversarial training and adaptive window attention. Input 1 image and receive 1 upscaled output with improved detail and clarity. Ideal for restoring low-resolution photos, preparing assets for print, or sharpening lightly degraded digital images.',
    useCase: 'Upscale',
    family: 'SeedVR2',
    media: 'image',
    runs: 'both',
    usage: 668,
    date: '2026-07-13',
    sizeGb: 8.8,
    vramGb: 8
  },
  {
    id: 'utility_z_image_turbo_2k_upscaler.app',
    title: 'Image Upscale: Z-Image-Turbo 2K',
    description: 'Upload an image to upscale it to 2K resolution using the Z-Image-Turbo model.',
    useCase: 'Upscale',
    family: 'Z-Image',
    media: 'image',
    runs: 'both',
    usage: 303,
    date: '2026-02-19',
    sizeGb: 20.7,
    vramGb: 16,
    tutorial: 'https://docs.comfy.org/tutorials/utility/image-upscale'
  },
  {
    id: 'api_magnific_image_upscale_creative',
    title: 'Image Upscale: Magnific Creative',
    description:
      'Upload an image and set the magnification level. Generate an upscaled version of your image with support for up to 16x enlargement.',
    useCase: 'Upscale',
    family: 'Magnific',
    media: 'image',
    runs: 'cloud',
    usage: 253,
    date: '2026-02-13',
    sizeGb: 0
  },
  {
    id: 'image_qwen_image_2_1_background_removal',
    title: 'Remove Background: Qwen Image 2.1',
    description:
      'Remove image backgrounds with Qwen Image 2.1, which natively supports 2K output and RGBA transparency for direct transparent results. It takes 1 input image and returns 1 background-free image plus a comparison view showing the before and after. Ideal for e-commerce product photos, profile pictures, and marketing graphics needing clean cutouts.',
    useCase: 'Image editing',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 252,
    date: '2026-09-20',
    sizeGb: 21.4,
    vramGb: 16
  },
  {
    id: 'templates_hellorob_facegen_skindetail_upscale',
    title: 'Skin Enhancer + Upscaler',
    description:
      'One click workflow to generate a character portrait, refine/add skin details, and upscale to 4k. All done in less than 60 seconds.',
    useCase: 'Upscale',
    family: 'Z-Image',
    media: 'image',
    runs: 'both',
    usage: 248,
    date: '2026-03-09',
    sizeGb: 27.8,
    vramGb: 24
  },
  {
    id: 'api_clarity_ai_crystal_upscale',
    title: 'Clarity AI: Crystal Upscaler',
    description:
      'Upscale and enhance images with the precision-focused Crystal model, preserving real detail while adding resolution. Takes one image in and returns one upscaled image plus a side-by-side comparison view. Ideal for portraits, product shots, and print-ready enlargements where faithful detail matters.',
    useCase: 'Upscale',
    family: 'Clarity AI',
    media: 'image',
    runs: 'cloud',
    usage: 226,
    date: '2026-10-07',
    sizeGb: 0
  },
  {
    id: 'video_minimax_h3_i2v',
    title: 'MiniMax H3: Image to Video',
    description:
      'Turn a starting image into a short, high-quality video clip with MiniMax H3, a unified multimodal model that generates visuals and synchronized audio in a single pass. The workflow takes 1 input image and produces 1 video output, with optional text or reference media to steer motion, style, or sound. Ideal for rapid concept visualization, character-driven animation tests, and creating shareable social media clips with built-in sound design.',
    useCase: 'Video generation',
    family: 'MiniMax',
    media: 'video',
    runs: 'both',
    usage: 19568,
    date: '2026-08-02',
    sizeGb: 44.5,
    vramGb: 32
  },
  {
    id: 'video_ltx2_3_i2v',
    title: 'LTX-2.3: Image to Video',
    description:
      'Upload an image to generate a video with improved motion consistency and fine details, including enhanced support for portrait formats and audio quality.',
    useCase: 'Video generation',
    family: 'LTX',
    media: 'video',
    runs: 'both',
    usage: 17826,
    date: '2026-03-05',
    sizeGb: 47.2,
    vramGb: 32
  },
  {
    id: 'video_wan2_2_14B_i2v',
    title: 'Wan 2.2 14B Image to Video',
    description:
      'Transform static images into dynamic videos with precise motion control and style preservation using Wan 2.2.',
    useCase: 'Video generation',
    family: 'Wan',
    media: 'video',
    runs: 'both',
    usage: 8812,
    date: '2025-07-29',
    sizeGb: 38.0,
    vramGb: 48,
    tutorial: 'https://docs.comfy.org/tutorials/video/wan/wan2_2'
  },
  {
    id: 'video_minimax_h3_r2v',
    title: 'MiniMax H3: Reference to Video',
    description:
      'Generate a new video by feeding MiniMax H3 a reference image, up to nine images, three videos, and three audio clips alongside a text prompt, letting the model match character identity, motion, camera, voice, or style from those sources while producing native stereo audio in a single pass. Output is a single MP4 video at up to 2K resolution and 24fps for roughly 15 seconds. Ideal for character-consistent animation, style-transfer video generation, and audio-synced content creation.',
    useCase: 'Video generation',
    family: 'MiniMax',
    media: 'video',
    runs: 'both',
    usage: 6670,
    date: '2026-08-02',
    sizeGb: 44.5,
    vramGb: 32
  },
  {
    id: 'video_ltx2_5_i2v',
    title: 'LTX-2.5: Image to Video',
    description:
      'Generate video from a single image using LTX-2.5, producing a high-fidelity clip with industry-leading pixel quality and native multishot capability that holds character, environment, and lighting across connected scenes. Ideal for cinematic production, VFX shot creation, and content pipelines requiring fast, locally deployable video generation.',
    useCase: 'Video generation',
    family: 'LTX',
    media: 'video',
    runs: 'both',
    usage: 4531,
    date: '2026-08-11',
    sizeGb: 56.9,
    vramGb: 32
  },
  {
    id: 'video_minimax_h3_t2v',
    title: 'MiniMax H3: Text to Video',
    description:
      'Generate video with native stereo audio directly from a text prompt using MiniMax H3, an omni-modal model that synthesizes voice, sound effects, and music in a single pass. Output is up to 2K resolution, 24fps, and roughly 15 seconds long, with no file inputs required, just a prompt to one video output. Ideal for rapid concept visualization, social media content creation, and audio-synced storytelling.',
    useCase: 'Video generation',
    family: 'MiniMax',
    media: 'video',
    runs: 'both',
    usage: 4400,
    date: '2026-08-02',
    sizeGb: 56.9,
    vramGb: 48
  },
  {
    id: 'api_seedance2_5_r2v',
    title: 'Seedance 2.5: Reference to Video',
    description:
      'Generate reference-driven videos with Seedance 2.5 by supplying up to 20 images, 6 video clips, and 6 audio clips to control character consistency, visual style, and motion rhythm in a single 4 to 30 second output with synchronized sound and lip-synced dialogue. Ideal for e-commerce product showcases, brand advertising, and character-driven short series.',
    useCase: 'Video generation',
    family: 'Seedance',
    media: 'video',
    runs: 'cloud',
    usage: 2942,
    date: '2026-08-07',
    sizeGb: 0
  },
  {
    id: 'video_pika_h3_flex_ref2va',
    title: 'Pika H3 Flex: Reference to Video',
    description:
      'Generate a video with synchronized audio from reference images with Pika H3 Flex, keeping the identity, costume and look of the references while the prompt carries the story. Two image inputs are wired as Picture 1 and Picture 2, and the Pika adapter runs at strength 1.0 with the lcm sampler and a six-step sigma list on the MiniMax H3 Ref2VA base. Ideal for character-consistent short clips with native sound.',
    useCase: 'Video generation',
    family: 'MiniMax',
    media: 'video',
    runs: 'both',
    usage: 2731,
    date: '2026-10-28',
    sizeGb: 44.5,
    vramGb: 32,
    tutorial: 'https://docs.comfy.org/tutorials/video/pika/pika-h3-flex'
  },
  {
    id: 'video_fastvideo_fasth3_i2v',
    title: 'FastVideo FastH3: Image to Video',
    description:
      'Generate video with synchronized native audio from a single still image using MiniMax H3 and the FastH3 8-step checkpoint. One image produces one video output with matching voice, sound effects, and music in a single pass. Ideal for animating portraits, bringing product shots to life, and quick social media clips.',
    useCase: 'Video generation',
    family: 'MiniMax',
    media: 'video',
    runs: 'both',
    usage: 1862,
    date: '2026-09-15',
    sizeGb: 45.1,
    vramGb: 32
  },
  {
    id: 'video_fasth3_ominiref_r2v',
    title: 'FastH3 OmniRef: Reference to Video',
    description:
      'Generate synchronized video with matching audio from a text prompt plus a reference image using the FastH3 OmniRef eight-step distilled model, which renders both streams in just eight sampling steps. Takes 1 input image and produces 1 video output. Ideal for animating reference characters, creating talking avatars, and rapid social media video prototyping.',
    useCase: 'Video generation',
    family: 'MiniMax',
    media: 'video',
    runs: 'both',
    usage: 1688,
    date: '2026-10-20',
    sizeGb: 42.9,
    vramGb: 32
  },
  {
    id: 'video_wan_animate2',
    title: 'Wan Animate 2: Motion Transfer',
    description:
      "Animate a still character using a driving video with Wan Animate 2, transferring motion directly from video frames without any pose extraction or skeleton preprocessing. The output preserves the reference character's identity while generating a fresh background and camera movement from your text prompt. Ideal for motion transfer, action mimicry, and character animation replacement projects.",
    useCase: 'Video generation',
    family: 'Wan',
    media: 'video',
    runs: 'both',
    usage: 1621,
    date: '2026-08-07',
    sizeGb: 25.7,
    vramGb: 16
  },
  {
    id: 'api_seedance2_5_i2v_1080p',
    title: 'Seedance2.5 1080P: Image to Video',
    description:
      'Generate cinematic 1080P video clips from a single image using Seedance 2.5, animating the still into a moving scene with synchronized sound, music, and dialogue for clips up to 30 seconds across any aspect ratio. Ideal for breathing life into product shots, extending concept art into motion, and creating engaging social media content from photographs.',
    useCase: 'Video generation',
    family: 'Seedance',
    media: 'video',
    runs: 'cloud',
    usage: 1596,
    date: '2026-08-17',
    sizeGb: 0
  },
  {
    id: 'video_ltx2_5_t2v',
    title: 'LTX-2.5: Text to Video',
    description:
      'Generate cinematic video from a text prompt using LTX-2.5, a production-ready diffusion model that outputs a single video file with optional spatial upscaling for enhanced resolution. Ideal for film previsualization, commercial storyboards, and high-volume content creation pipelines.',
    useCase: 'Video generation',
    family: 'LTX',
    media: 'video',
    runs: 'both',
    usage: 1288,
    date: '2026-08-11',
    sizeGb: 53.2,
    vramGb: 32
  },
  {
    id: 'video_ltx2_3_ia2v',
    title: 'LTX-2.3: Image Audio to Video',
    description:
      'Upload an image and an audio file to generate a high-quality video with synchronized lip movements using LTX-2.3.',
    useCase: 'Video generation',
    family: 'LTX',
    media: 'video',
    runs: 'both',
    usage: 1229,
    date: '2026-03-09',
    sizeGb: 42.9,
    vramGb: 32
  },
  {
    id: 'video_pika_h3_flex_t2v',
    title: 'Pika H3 Flex: Text to Video',
    description:
      "Generate a video with synchronized audio from a text prompt with Pika H3 Flex, a Pika post-trained adapter for MiniMax H3 that lands a finished 1344x768, 124-frame clip in six sampling steps. The adapter runs at strength 1.0 on the int8 MiniMax H3 base with the lcm sampler and Pika's own six-value sigma list, so a full render takes about a minute instead of a 20-step run. Ideal for fast prompt exploration and concept iteration on H3, with no image input to prepare.",
    useCase: 'Video generation',
    family: 'MiniMax',
    media: 'video',
    runs: 'both',
    usage: 1214,
    date: '2026-10-28',
    sizeGb: 44.5,
    vramGb: 32,
    tutorial: 'https://docs.comfy.org/tutorials/video/pika/pika-h3-flex'
  },
  {
    id: 'video_ltx2_5_flf2v',
    title: 'LTX-2.5: FLF2V',
    description:
      'Generate a video from first and last frame reference images using LTX-2.5, blending both frames into a single animated sequence. Ideal for creating transition shots, morphing between two subjects or scenes, and building multi-shot narratives from still references.',
    useCase: 'Video generation',
    family: 'LTX',
    media: 'video',
    runs: 'both',
    usage: 957,
    date: '2026-08-11',
    sizeGb: 56.9,
    vramGb: 48
  },
  {
    id: 'utility_nvidia_rtx_video_enhance',
    title: 'RTX Video Enhance: HDR',
    description:
      "Upload a video and chain Nvidia's three RTX video nodes in one pass: super resolution upscale, frame generation and SDR-to-HDR conversion, running locally on your Nvidia RTX GPU. Built for VFX artists and professional video creators.",
    useCase: 'Upscale',
    family: 'NVIDIA RTX',
    media: 'video',
    runs: 'both',
    usage: 721,
    date: '2026-10-13',
    sizeGb: 0.0
  },
  {
    id: 'utility_seedvr2_3b_int8_upscale_video',
    title: 'Video Upscale: SeedVR2 3B Int8',
    description:
      'Upscale and restore video footage using SeedVR2 3B Int8, a one-step diffusion model that enhances resolution while maintaining temporal consistency across frames. This workflow takes one degraded video as input and outputs a single high-resolution, restored video. Ideal for restoring old or degraded footage, upscaling low-resolution videos, and enhancing archival media.',
    useCase: 'Upscale',
    family: 'SeedVR2',
    media: 'video',
    runs: 'both',
    usage: 598,
    date: '2026-07-14',
    sizeGb: 4.0,
    vramGb: 8
  },
  {
    id: 'utility_seedvr2_video_upscale',
    title: 'Video Upscale: SeedVR2',
    description:
      'Upload a video to upscale and enhance its resolution using the SeedVR2 model for high-definition output.',
    useCase: 'Upscale',
    family: 'SeedVR2',
    media: 'video',
    runs: 'both',
    usage: 287,
    date: '2026-02-06',
    sizeGb: 0.0,
    tutorial: 'https://docs.comfy.org/tutorials/utility/video-upscale'
  },
  {
    id: 'utility_depth_anything3_video_depth_estimation',
    title: 'Depth Map: Depth Anything 3',
    description:
      'Upload 1 image to generate a depth map for video depth estimation. Output a single depth-processed image ready for use in downstream workflows. Ideal for video generation tasks requiring depth control, 3D scene preprocessing, and animation depth mapping.',
    useCase: 'Video editing',
    family: 'Depth Anything',
    media: 'video',
    runs: 'both',
    usage: 218,
    date: '2026-06-12',
    sizeGb: 1.3,
    vramGb: 8
  },
  {
    id: 'utility_video_upscale',
    title: 'Video Upscale: Wan 2.2 Creative',
    description: 'Upload a video and upscale it to a higher resolution with Wan 2.2',
    useCase: 'Upscale',
    family: 'Wan',
    media: 'video',
    runs: 'both',
    usage: 216,
    date: '2026-01-22',
    sizeGb: 42.9,
    vramGb: 32,
    tutorial: 'https://docs.comfy.org/tutorials/utility/video-upscale'
  },
  {
    id: 'api_topaz_starlight_precise25',
    title: 'Video Upscale: Topaz Starlight Precise 2.5',
    description:
      'Upload a video to enhance its resolution using the Topaz Starlight Precise 2.5 model. This workflow produces sharper 4K output with reduced artifacts compared to previous versions.',
    useCase: 'Upscale',
    family: 'Topaz',
    media: 'video',
    runs: 'cloud',
    usage: 210,
    date: '2026-03-26',
    sizeGb: 0
  },
  {
    id: 'api_minimax_h3_max_recast',
    title: 'Cast Swap: MiniMax H3 Max',
    description:
      'Swap the people in a finished clip with MiniMax H3 Max Recast: connect up to four reference photos and the model rewrites the cast while keeping the motion, the framing, the cuts and the original audio. Clips run 5 to 30 seconds with no shot longer than 15 seconds, at 480P to 1080P, with an option for more natural skin and blending. Ideal for recasting a shot without a reshoot, localising a presenter, or testing a look with a different face.',
    useCase: 'Video editing',
    family: 'MiniMax',
    media: 'video',
    runs: 'cloud',
    usage: 175,
    date: '2026-11-03',
    sizeGb: 0
  },
  {
    id: 'utility_void_video_inpainting',
    title: 'Video Inpainting: VOID',
    description:
      'Upload a video and mask the object you want to remove. Generate a clean video with the object and its physical interactions deleted.',
    useCase: 'Video editing',
    family: 'VOID',
    media: 'video',
    runs: 'both',
    usage: 150,
    date: '2026-05-14',
    sizeGb: 34.3,
    vramGb: 24,
    tutorial: 'https://docs.comfy.org/tutorials/utility/void-video-inpainting'
  },
  {
    id: 'api_elevenlabs_v4_text_to_speech',
    title: 'Eleven v4: Text to Speech',
    description:
      'Generate expressive speech from text with Eleven v4, the quality-focused ElevenLabs model. Direct the performance with audio tags such as [whispers] or [excited] written into the script, or upload a voice sample to clone a voice and narrate the script in it. One audio file is output. Ideal for audiobooks, narration, and character voiceovers.',
    useCase: 'Audio',
    family: 'ElevenLabs',
    media: 'audio',
    runs: 'cloud',
    usage: 589,
    date: '2026-10-02',
    sizeGb: 0
  },
  {
    id: 'audio_minimax_music_3',
    title: 'MiniMax Music 3: Text to Music',
    description:
      'Create full-length songs from text prompts with MiniMax Music 3, generating complete 5-minute tracks with stable structure and high-fidelity audio. Input a structured caption describing lyrics, style, mood, and arrangement, and receive a finished song as output. Ideal for music producers prototyping demos, and content creators needing original background tracks.',
    useCase: 'Audio',
    family: 'MiniMax',
    media: 'audio',
    runs: 'both',
    usage: 388,
    date: '2026-08-13',
    sizeGb: 15.4,
    vramGb: 12
  },
  {
    id: 'api_fishaudio_voice_clone_tts',
    title: 'Fish Audio: Voice Clone to Speech',
    description:
      'Clone any voice from a short recording, then use it to speak any script with Fish Audio. Record 2-3 clips of 15-20 seconds, connect them to the Instant Voice Clone node, and the cloned voice feeds straight into text to speech with no training wait. Add emotion tags to control how your cloned voice delivers each line. Great for personalized narration, character voices, and content in your own voice.',
    useCase: 'Audio',
    family: 'Fish Audio',
    media: 'audio',
    runs: 'cloud',
    usage: 296,
    date: '2026-08-31',
    sizeGb: 0
  },
  {
    id: 'api_mirelo_video_to_sfx',
    title: 'Mirelo SFX 2.0: Video to SFX',
    description:
      'Add picture-locked sound effects to a clip with Mirelo sfx-2.0: the model watches the video and times Foley to on-screen action, keeps speech by default, and saves the SFX track, the speech track and the video carrying the new mix.',
    useCase: 'Audio',
    family: 'Mirelo',
    media: 'audio',
    runs: 'cloud',
    usage: 169,
    date: '2026-10-22',
    sizeGb: 0
  },
  {
    id: 'audio_ace_step1_5_xl_turbo',
    title: 'ACE-Step 1.5XL Turbo: Text to Music',
    description:
      'Generate high-quality music from text prompts using the distilled 4B ACE-Step model. Produces commercial-ready audio in just 8 inference steps without CFG.',
    useCase: 'Audio',
    family: 'ACE-Step',
    media: 'audio',
    runs: 'both',
    usage: 147,
    date: '2026-04-10',
    sizeGb: 19.9,
    vramGb: 12
  },
  {
    id: 'api_fishaudio_drama3_directed',
    title: 'Fish Audio Drama 3: Directed Performance',
    description:
      'Direct a single Fish Audio Drama 3 performance from the text: shift the delivery mid-line with [plain-language directions] and wrap words with <whisper>...</whisper> tags.',
    useCase: 'Audio',
    family: 'Fish Audio',
    media: 'audio',
    runs: 'cloud',
    usage: 142,
    date: '2026-10-13',
    sizeGb: 0
  },
  {
    id: 'api_elevenlabs_text_to_sound_effects',
    title: 'ElevenLabs: Text to Sound Effects',
    description: 'Input a text prompt to generate custom sound effects and ambient audio.',
    useCase: 'Audio',
    family: 'ElevenLabs',
    media: 'audio',
    runs: 'cloud',
    usage: 111,
    date: '2026-02-21',
    sizeGb: 0
  },
  {
    id: 'api_mirelo_text_to_sfx',
    title: 'Mirelo SFX 2.0: Text to SFX',
    description:
      'Generate sound effects from a text prompt with Mirelo sfx-2.0: name the sound, its material, space and intensity in one line and get a 48 kHz mono audio file, up to 10 minutes.',
    useCase: 'Audio',
    family: 'Mirelo',
    media: 'audio',
    runs: 'cloud',
    usage: 109,
    date: '2026-10-22',
    sizeGb: 0
  },
  {
    id: '3d_pixal3d_trellis2_image_to_model',
    title: 'Pixal3D & TRELLIS.2: Image to Model',
    description:
      'Upload a single image. Generate a high-fidelity 3D model with PBR textures using either Pixal3D or TRELLIS.2, toggled by a single switch. Both pipelines share the same DINOv3 encoder and shape/texture VAEs; Pixal3D adds MoGe camera estimation for pixel-aligned geometry. Includes background removal and a complete mesh post-processing pipeline: remesh, decimate, UV unwrap, and texture baking.',
    useCase: '3D',
    family: 'Pixal3D',
    media: '3d',
    runs: 'both',
    usage: 811,
    date: '2026-08-25',
    sizeGb: 15.4,
    vramGb: 24
  },
  {
    id: '3d_pixal3d_multi_views',
    title: 'Pixal3D: Multi Views to 3D',
    description:
      'Upload your own separate view images, or use one mixed multi-view turnaround sheet. The workflow prepares front, back, left and right views, then reconstructs a textured 3D model with Pixal3D Multi-View.',
    useCase: '3D',
    family: 'Pixal3D',
    media: '3d',
    runs: 'both',
    usage: 245,
    date: '2026-09-09',
    sizeGb: 9.3,
    vramGb: 8
  },
  {
    id: '3d_triposplat_image_to_gaussian_splat',
    title: 'TripoSplat: Image to Gaussian Splat',
    description:
      'Upload a single 2D image. Generate a high-quality 3D Gaussian splat representation with controllable density and budget for rendering.',
    useCase: '3D',
    family: 'Tripo',
    media: '3d',
    runs: 'both',
    usage: 183,
    date: '2026-06-02',
    sizeGb: 4.0,
    vramGb: 8
  },
  {
    id: '3d_hunyuan3d-v2.1',
    title: 'HY 3D 2.1: Single View to Model',
    description:
      'Reconstruct a 3D model from a single photo using Hunyuan3D 2.1, converting one input image into a raw white-mesh geometry without textures or materials. Ideal for rapid 3D concepting, blockout prototyping, and asset preparation before texturing or retopology.',
    useCase: '3D',
    family: 'Hunyuan3D',
    media: '3d',
    runs: 'both',
    usage: 172,
    date: '2025-03-01',
    sizeGb: 4.9,
    vramGb: 8
  },
  {
    id: 'utility_sam3d_body',
    title: 'SAM 3D Body: 3D Human Mesh Extraction From Video',
    description:
      'Extract a full-body 3D human mesh from a single video frame using SAM 3D Body, guided by a text prompt to refine pose and shape estimation. The workflow loads one video and one text prompt, then outputs a reconstructed video showing the recovered human rig. Ideal for motion capture prototyping, biomechanics analysis, and character animation previsualization.',
    useCase: '3D',
    family: 'SAM',
    media: '3d',
    runs: 'both',
    usage: 162,
    date: '2026-08-25',
    sizeGb: 5.5,
    vramGb: 8
  },
  {
    id: '3d_idol_image_to_gaussian_splat',
    title: 'Idol: Image to Gaussian Splat',
    description:
      "Turn a single image into a 3D Gaussian splat with Idol, Comfy-Org's fine-tune of TripoSplat: BiRefNet removes the backdrop, DINOv3 and the Flux2 VAE encode the view, and one pass decodes a 262k-point splat. Exports a .spz splat, an orbit preview and an experimental .glb mesh. Best on stylized characters and props.",
    useCase: '3D',
    family: 'Tripo',
    media: '3d',
    runs: 'both',
    usage: 160,
    date: '2026-11-03',
    sizeGb: 3.8,
    vramGb: 8
  },
  {
    id: 'api_tripo_p2_multiview_to_model',
    title: 'Tripo P2: Multiview to Model',
    description:
      'Generate production-ready 3D models from up to four reference views using Tripo P2.0 Preview, which reconstructs geometry with native quad topology and triangle meshes up to 50,000 faces. Ideal for game characters and props ready for rigging, hard-surface mechanical assets, and high-volume real-time pipelines.',
    useCase: '3D',
    family: 'Tripo',
    media: '3d',
    runs: 'cloud',
    usage: 141,
    date: '2026-09-18',
    sizeGb: 0
  },
  {
    id: 'api_tripo_p2_image_to_model',
    title: 'Tripo P2: Image to Model',
    description:
      'Generate a production-ready 3D model from a single reference image using Tripo P2.0 Preview, which builds native quad topology with clean edge flow suited for rigging and animation. It takes 1 input image, with optional multi-view references for better side and back accuracy. Ideal for game characters and props, hard-surface mechanical assets, and high-volume real-time pipelines.',
    useCase: '3D',
    family: 'Tripo',
    media: '3d',
    runs: 'cloud',
    usage: 129,
    date: '2026-09-16',
    sizeGb: 0
  },
  {
    id: 'templates-9grid_social_media-v2.0',
    title: '3x3 Grid For Product Ads',
    description:
      'Upload your product and enter a brief prompt for each grid position in a 3x3 grid. Generates 9 distinct images. Select the images you like and upscale to 4k using your product as reference.',
    useCase: 'Product & ads',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 69,
    date: '2025-12-06',
    sizeGb: 0
  },
  {
    id: 'templates_rob_kling3_0_multishot_llm_product',
    title: 'Kling 3.0: 1 Click Multishot',
    description:
      'Upload a start frame and references of your product. Select total duration and number of shots and automatically generate prompts for each shot.',
    useCase: 'Product & ads',
    family: 'Kling',
    media: 'video',
    runs: 'cloud',
    usage: 38,
    date: '2026-03-18',
    sizeGb: 0
  },
  {
    id: 'templates-assemble_dieline',
    title: 'Generate Brand Packaging from Dieline',
    description: 'Upload a dieline of your product and assemble into a 3D package.',
    useCase: 'Product & ads',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 38,
    date: '2025-12-15',
    sizeGb: 0
  },
  {
    id: 'templates-car_product',
    title: '1 Image to Car Product Shots',
    description:
      'Upload a photo of your vehicle and generate a studio quality video of the vehicle from multiple angles.',
    useCase: 'Product & ads',
    family: 'Kling',
    media: 'video',
    runs: 'cloud',
    usage: 35,
    date: '2025-12-18',
    sizeGb: 0
  },
  {
    id: 'templates-subject_product_swap.app',
    title: 'Swap Product in Character’s Hand, UGC Style',
    description:
      'Upload a photo of a character holding a product and your brands product. Generate an image with the products swapped.',
    useCase: 'Product & ads',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 28,
    date: '2025-12-18',
    sizeGb: 0
  },
  {
    id: 'template_image_speech_to_video',
    title: 'Generate UGC Video With Voice Clone',
    description:
      'Upload an image to generate AI prompts and synthesize speech. Create a final video with accurate lip sync using ElevenLabs and LTX Video.',
    useCase: 'Product & ads',
    family: 'ElevenLabs',
    media: 'video',
    runs: 'cloud',
    usage: 27,
    date: '2026-04-06',
    sizeGb: 0
  },
  {
    id: 'template_product_placement',
    title: 'Product Placement',
    description:
      'Swap products into a reference scene while preserving composition and lighting. Generates a final product image and an automatic video prompt for creating polished product videos.',
    useCase: 'Product & ads',
    family: 'Nano Banana',
    media: 'video',
    runs: 'cloud',
    usage: 11,
    date: '2026-03-30',
    sizeGb: 0
  },
  {
    id: 'templates-wan2_1_infinitetalk_music',
    title: 'Audio-Driven Character Lip Sync Video',
    description:
      "Upload a character image and an audio file. Generate a lip-sync video where the character's mouth movements match the provided audio track.",
    useCase: 'Characters & fashion',
    family: 'Wan',
    media: 'video',
    runs: 'both',
    usage: 397,
    date: '2026-02-19',
    sizeGb: 10.7,
    vramGb: 8
  },
  {
    id: 'template_purz_wan22_animate_auto_character_replace',
    title: 'Wan2.2 Animate: Automatic Character Replacement',
    description:
      'Upload a video and a character image. Automatically replace the character in the video using the Wan2.2 Animate model.',
    useCase: 'Characters & fashion',
    family: 'Wan',
    media: 'video',
    runs: 'both',
    usage: 342,
    date: '2026-03-08',
    sizeGb: 28.8,
    vramGb: 24
  },
  {
    id: 'templates-1_click_multiple_character_angles-v1.0',
    title: '1 Click Multiple Character Angles',
    description:
      'Upload an image of your character and get multiple views of that image from different angles',
    useCase: 'Characters & fashion',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 216,
    date: '2025-12-08',
    sizeGb: 31.2,
    vramGb: 24
  },
  {
    id: 'templates-character_sheet',
    title: '360 Full-body Turnaround',
    description:
      'Upload your character and generate 360 turnaround views for full body and close ups.',
    useCase: 'Characters & fashion',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 108,
    date: '2026-01-13',
    sizeGb: 0
  },
  {
    id: 'template_ltx2_3_ic_lora_ingredients',
    title: 'LTX-2.3 IC-LoRA: Reference Sheet Control',
    description:
      'Generate short video clips that stay visually consistent with a reference sheet inventorying characters, props, and locations. Input a composite reference image and a split prompt describing the action, outputting a single video clip. Ideal for character-driven animation, consistent prop visualization, and location-specific scene generation.',
    useCase: 'Characters & fashion',
    family: 'LTX',
    media: 'video',
    runs: 'both',
    usage: 107,
    date: '2026-07-13',
    sizeGb: 39.6,
    vramGb: 24
  },
  {
    id: 'templates-multiple_consistent_shots-nb_pro',
    title: 'Single Image to Multiple Consistent Shots',
    description:
      'Upload an input image and automatically generate X prompts for camera angle and shot type.',
    useCase: 'Characters & fashion',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 53,
    date: '2026-01-26',
    sizeGb: 0
  },
  {
    id: 'templates-1_click_multiple_scene_angles-v1.0',
    title: '1 click Multiple Scene Angles',
    description:
      'Upload an image of your scene and generate multiple views of your input scene with 1 click.',
    useCase: 'Characters & fashion',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 53,
    date: '2025-12-08',
    sizeGb: 31.2,
    vramGb: 24
  },
  {
    id: 'templates-fashion_shoot_vton',
    title: 'Character + Clothing (OOTD) Flat Lay to Studio Photoshoot',
    description:
      'Upload an image of your character and a flatlay image of your clothing items. Generate 4 fashion editorial photographs of your character in the outfit. Select which image to upscale and add back details.',
    useCase: 'Characters & fashion',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 49,
    date: '2025-12-15',
    sizeGb: 0
  },
  {
    id: 'templates_text_prompt_to_360hdr.app',
    title: 'Equirectangular HDR Skybox Generator',
    description:
      'Prompt an environment and generate a equirectangular hdr image to use as skybox or lookdev in game development.',
    useCase: 'Brand & design',
    family: 'Qwen Image',
    media: 'image',
    runs: 'both',
    usage: 37,
    date: '2026-03-06',
    sizeGb: 31.8,
    vramGb: 24
  },
  {
    id: 'templates_graphic_design_recomposer',
    title: 'Graphic Design Recomposer',
    description:
      'Upload a graphic design and select your desired aspect ratio. Generates and recomposes the graphic to fit the new aspect ratio.',
    useCase: 'Brand & design',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 28,
    date: '2026-03-30',
    sizeGb: 0
  },
  {
    id: 'templates-3x3_grid_brand_icons',
    title: '3x3 Brand Icon Assets Grid',
    description:
      'Upload a reference image of an icon, enter your brand information in the prompt and generate 9 unique on brand stylized icon assets.',
    useCase: 'Brand & design',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 16,
    date: '2026-01-13',
    sizeGb: 0
  },
  {
    id: 'templates-3D_logo_texture_animation',
    title: 'Dynamic 3D Logo Animations',
    description:
      'Upload a vector image of your logo, and prompt your desired texture. Generate a textured 3D first and last frame with automated prompting for the final animation.',
    useCase: 'Brand & design',
    family: 'Seedream',
    media: 'video',
    runs: 'cloud',
    usage: 15,
    date: '2025-12-15',
    sizeGb: 0
  },
  {
    id: 'template_purz_nb2_single_image_sprite_sheet',
    title: 'Single Image to Animated Sprite Sheet',
    description:
      'Upload a single image to generate an animated sequence. The workflow creates a sprite sheet with multiple frames for use in games or animations.',
    useCase: 'Brand & design',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 15,
    date: '2026-03-08',
    sizeGb: 0
  },
  {
    id: 'templates-poster_to_2x2_mockups-v2.0',
    title: 'Poster Scene Mockups',
    description:
      'Upload a poster/ad design and with a short input about your brand, generate 4 mockups in multiple scenes.',
    useCase: 'Brand & design',
    family: 'Nano Banana',
    media: 'image',
    runs: 'cloud',
    usage: 14,
    date: '2025-12-06',
    sizeGb: 0
  }
]

const byId = new Map(HUB_WORKFLOWS.map((w) => [w.id, w]))
export const hubById = (id: string): HubWorkflow | undefined => byId.get(id)

const files = import.meta.glob<string>('./hub/*.webp', { eager: true, import: 'default' })
const THUMBS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url])
)
/** The bundled thumbnail, if this file has it (the mock's twelve keep theirs). */
export const hubThumb = (id: string): string | undefined => THUMBS[id]

/** The card's one line: what it does, from the description's first
 *  sentence, without the "using Model X" tail the name already says. */
export function hubLine(w: HubWorkflow): string {
  const first = (w.description.split(/(?<!\be\.g|\bi\.e)(?<=\.) /)[0] ?? '').replace(/\.$/, '')
  const cuts = [' using ', ' with ', ' by ', ' through ', ' powered ', ' via ']
    .map((c) => first.indexOf(c, 18))
    .filter((i) => i > 0 && !/\b(and|or|a|an|the)$/.test(first.slice(0, i)))
  return cuts.length ? first.slice(0, Math.min(...cuts)) : first
}

/** A Hub workflow as the modal's Template. */
export const hubTemplate = (w: HubWorkflow): Template => ({
  id: w.id,
  title: w.title,
  kind: 'graph',
  category: w.media,
  runs: w.runs,
  vram: w.vramGb ? `${w.vramGb} GB` : undefined
})
