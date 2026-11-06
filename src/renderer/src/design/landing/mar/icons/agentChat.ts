import { defineComponent, h } from 'vue'

/**
 * The Agent entry in Mar's proposal: a chat bubble with a small sparkle on
 * its top-right corner, half in and half out. The bubble's outline breaks
 * around the sparkle (a 1.5px knockout) so the two never touch. Production
 * has no agent icon, so it is drawn in lucide's system (24 grid, stroke 2,
 * round caps and joins): lucide's message-square, a step smaller.
 */
const BUBBLE =
  'M19 18a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 22.286V8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z'
const SPARKLE = 'M18.5 1q.7 3.8 4.5 4.5q-3.8.7-4.5 4.5q-.7-3.8-4.5-4.5q3.8-.7 4.5-4.5z'
// Stroke 2 plus 1.5 of gap on each side.
const KNOCKOUT = 5

let uid = 0

export const AgentChat = defineComponent({
  name: 'AgentChat',
  props: {
    size: { type: [Number, String], default: 24 },
    strokeWidth: { type: [Number, String], default: 2 }
  },
  setup(props) {
    const mask = `mar-agent-chat-${++uid}`
    return () =>
      h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: props.size,
          height: props.size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': props.strokeWidth,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true'
        },
        [
          h('mask', { id: mask, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 24, height: 24 }, [
            h('rect', { width: 24, height: 24, fill: 'white', stroke: 'none' }),
            h('path', { d: SPARKLE, fill: 'black', stroke: 'black', 'stroke-width': KNOCKOUT })
          ]),
          h('path', { d: BUBBLE, mask: `url(#${mask})` }),
          h('path', { d: SPARKLE })
        ]
      )
  }
})
