import { defineComponent, h } from 'vue'

/**
 * ComfyUI's own icons (ComfyUI_frontend packages/design-system/src/icons,
 * used there as `icon-[comfy--name]`), for the concepts where production
 * draws its own instead of a lucide one. The prototype has no iconify, so
 * they are inline SVGs with lucide's props (size, stroke-width ignored: the
 * originals carry their own 1.3 stroke on a 16 grid).
 */
function comfyIcon(name: string, viewBox: string, body: string) {
  return defineComponent({
    name,
    props: {
      size: { type: [Number, String], default: 24 },
      strokeWidth: { type: [Number, String], default: undefined }
    },
    setup(props) {
      return () =>
        h('svg', {
          xmlns: 'http://www.w3.org/2000/svg',
          width: props.size,
          height: props.size,
          viewBox,
          fill: 'none',
          'aria-hidden': 'true',
          innerHTML: body
        })
    }
  })
}

const S = 'stroke="currentColor" stroke-linecap="round" stroke-width="1.3"'

/** comfy--workflow: the Workflows tab, workflow chips and nodes. */
export const ComfyWorkflow = comfyIcon(
  'ComfyWorkflow',
  '0 0 16 16',
  `<path ${S} d="M9.18613 3.09999H6.81377M9.18613 12.9H7.55288c-3.08678 0-5.35171-2.99581-4.60305-6.08843l.3054-1.26158M14.7486 2.1721l-.5931 2.45c-.132.54533-.6065.92789-1.1508.92789h-2.2993c-.77173 0-1.33797-.74895-1.1508-1.5221l.5931-2.45c.132-.54533.6065-.9279 1.1508-.9279h2.2993c.7717 0 1.3379.74896 1.1508 1.52211Zm-8.3033 0-.59309 2.45c-.13201.54533-.60646.92789-1.15076.92789H2.4021c-.7717 0-1.33793-.74895-1.15077-1.5221l.59309-2.45c.13201-.54533.60647-.9279 1.15077-.9279h2.29935c.77169 0 1.33792.74896 1.15076 1.52211Zm8.3033 9.8-.5931 2.45c-.132.5453-.6065.9279-1.1508.9279h-2.2993c-.77173 0-1.33797-.749-1.1508-1.5221l.5931-2.45c.132-.5453.6065-.9279 1.1508-.9279h2.2993c.7717 0 1.3379.7489 1.1508 1.5221Z"/>`
)

/** comfy--template: the Templates button. */
export const ComfyTemplate = comfyIcon(
  'ComfyTemplate',
  '0 0 16 16',
  `<path ${S} d="m14.6685 5.7416.6425-2.57c.2028-.811-.4106-1.5967-1.2466-1.5967H2.5782a1.285 1.285 0 0 0-1.2467.9733l-.6425 2.57c-.2027.8111.4107 1.5968 1.2467 1.5968h11.4861a1.285 1.285 0 0 0 1.2467-.9734Zm0 7.7102.6425-2.5701c.2028-.811-.4106-1.5967-1.2466-1.5967h-5.061a1.285 1.285 0 0 0-1.2467.9734l-.6425 2.5701c-.2028.811.4106 1.5966 1.2466 1.5966h5.061a1.285 1.285 0 0 0 1.2467-.9733Zm-10.2802 0 .6425-2.5701c.2027-.811-.4107-1.5967-1.2467-1.5967H2.5782a1.285 1.285 0 0 0-1.2467.9734L.689 12.8285c-.2027.811.4107 1.5966 1.2467 1.5966h1.206a1.285 1.285 0 0 0 1.2466-.9733Z"/>`
)

/** comfy--image-ai-edit: the Assets tab (generated media). */
export const ComfyAssets = comfyIcon(
  'ComfyAssets',
  '0 0 16 16',
  `<path d="M14 9.99996L11.9427 7.94263C11.6926 7.69267 11.3536 7.55225 11 7.55225C10.6464 7.55225 10.3074 7.69267 10.0573 7.94263L9 9M8 14H12.6667C13.403 14 14 13.403 14 12.6667V3.33333C14 2.59695 13.403 2 12.6667 2H3.33333C2.59695 2 2 2.59695 2 3.33333V8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.51377 12.671L4.77612 14.3921C4.67222 14.6346 4.32853 14.6346 4.22463 14.3921L3.48699 12.671C3.45664 12.6002 3.40022 12.5437 3.32942 12.5134L1.60825 11.7757C1.36581 11.6718 1.36581 11.3282 1.60825 11.2243L3.32942 10.4866C3.40022 10.4563 3.45664 10.3998 3.48699 10.329L4.22463 8.60787C4.32853 8.36544 4.67222 8.36544 4.77612 8.60787L5.51377 10.329C5.54411 10.3998 5.60053 10.4563 5.67134 10.4866L7.39251 11.2243C7.63494 11.3282 7.63494 11.6718 7.39251 11.7757L5.67134 12.5134C5.60053 12.5437 5.54411 12.6002 5.51377 12.671Z" ${S}/><path d="M5 5H5.0001" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
)

/** comfy--ai-model: the Model library tab. */
export const ComfyModel = comfyIcon(
  'ComfyModel',
  '0 0 16 16',
  `<path ${S} d="m4.998 13.909.557-2.225a1.112 1.112 0 0 0-1.08-1.382H2.32c-.51 0-.955.347-1.079.842L.684 13.37a1.112 1.112 0 0 0 1.079 1.382h2.156c.51 0 .956-.347 1.08-.842ZM6.11 7.234l.557-2.224a1.112 1.112 0 0 0-1.08-1.383H3.433c-.51 0-.956.348-1.08.843l-.556 2.225a1.112 1.112 0 0 0 1.08 1.382h2.156c.51 0 .955-.347 1.079-.843ZM11.673 13.909l.556-2.225a1.112 1.112 0 0 0-1.08-1.382H8.994c-.51 0-.955.347-1.079.842l-.556 2.225a1.112 1.112 0 0 0 1.08 1.382h2.156c.51 0 .955-.347 1.079-.842ZM13.141 5.816l-.784 1.83a.334.334 0 0 1-.614 0l-.785-1.83a.333.333 0 0 0-.175-.176l-1.831-.784a.334.334 0 0 1 0-.614l1.831-.785a.333.333 0 0 0 .175-.175l.785-1.831a.334.334 0 0 1 .614 0l.784 1.831a.334.334 0 0 0 .176.175l1.83.785c.27.116.27.498 0 .614l-1.83.784a.334.334 0 0 0-.176.176Z"/>`
)

const ASTROID =
  'M12.983 21.186a1 1 0 0 1-1.966 0a10 10 0 0 0-8.203-8.203a1 1 0 0 1 0-1.966a10 10 0 0 0 8.203-8.203a1 1 0 0 1 1.966 0a10 10 0 0 0 8.203 8.203a1 1 0 0 1 0 1.966a10 10 0 0 0-8.203 8.203Z'

/** lucide--astroid (newer than the lucide-vue-next here): the Agent entry. */
export const Astroid = comfyIcon(
  'Astroid',
  '0 0 24 24',
  `<path d="${ASTROID}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
)

/** comfy--node: the Node library tab. */
export const ComfyNode = comfyIcon(
  'ComfyNode',
  '0 0 16 16',
  `<path ${S} d="m11.2667 10.45-.0842.3156c-.143.5363-.6286.9094-1.18362.9094H4.6945c-.80486 0-1.39102-.7629-1.18364-1.5406l1.30667-4.90002c.143-.53625.62865-.90937 1.18364-.90937h5.46393c.7243 0 1.2518.68663 1.0652 1.38652l-.0301.11275M15.35 8.00001h-4.9m-6.73748 0H.65002"/>`
)
