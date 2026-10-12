import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { h, ref } from 'vue'
import BaseSelect from '../src/renderer/src/components/ui/BaseSelect.vue'

const meta = {
  title: 'Components/BaseSelect',
  component: BaseSelect,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The renderer select: a combobox trigger with a listbox teleported to `<body>` and positioned against the trigger. Arrow keys skip disabled options; Enter picks, and Escape or a click outside closes without a change.'
      }
    }
  },
  args: {
    modelValue: 'stable',
    ariaLabel: 'Release channel',
    options: [
      { value: 'stable', label: 'Stable', description: 'Tested releases' },
      { value: 'nightly', label: 'Nightly', description: 'Built from the latest commit' },
      { value: 'legacy', label: 'Legacy', description: 'No longer offered', disabled: true },
      { value: 'custom', label: 'Custom' }
    ],
    'onUpdate:modelValue': fn()
  },
  render: (args) => ({
    setup() {
      // A v-model host, as in the app; the args spy still records each update.
      const value = ref(args.modelValue)
      return () =>
        h('div', { style: { width: '240px' } }, [
          h(BaseSelect, {
            ...args,
            modelValue: value.value,
            'onUpdate:modelValue': (next: string) => {
              value.value = next
              args['onUpdate:modelValue']?.(next)
            }
          })
        ])
    }
  })
} satisfies Meta<typeof BaseSelect>

export default meta
type Story = StoryObj<typeof meta>

const trigger = (canvasElement: HTMLElement): HTMLElement =>
  within(canvasElement).getByRole('combobox', { name: 'Release channel' })

const closed = (): Promise<void> =>
  waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

export const KeyboardSelection: Story = {
  play: async ({ args, canvasElement }) => {
    const button = trigger(canvasElement)
    await expect(button).toHaveTextContent('Stable')

    await userEvent.click(button)
    const listbox = await screen.findByRole('listbox', { name: 'Release channel' })
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(canvasElement).not.toContainElement(listbox)
    await waitFor(() => expect(listbox).toHaveFocus())
    await waitFor(() => {
      const from = button.getBoundingClientRect()
      const to = listbox.getBoundingClientRect()
      expect(to.top).toBeGreaterThanOrEqual(from.bottom)
      expect(to.left).toBeCloseTo(from.left, 0)
      expect(to.width).toBeCloseTo(from.width, 0)
    })

    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await expect(within(listbox).getByRole('option', { name: /^Custom/ })).toHaveAttribute(
      'data-active'
    )
    await userEvent.keyboard('{Enter}')

    await closed()
    await expect(args['onUpdate:modelValue']).toHaveBeenCalledTimes(1)
    await expect(args['onUpdate:modelValue']).toHaveBeenCalledWith('custom')
    await expect(button).toHaveTextContent('Custom')
    await waitFor(() => expect(button).toHaveFocus())
  }
}

export const DismissWithoutChange: Story = {
  play: async ({ args, canvasElement }) => {
    const button = trigger(canvasElement)

    button.focus()
    await userEvent.keyboard('{ArrowDown}')
    const opened = await screen.findByRole('listbox', { name: 'Release channel' })
    await waitFor(() => expect(opened).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}{Escape}')
    await closed()
    await waitFor(() => expect(button).toHaveFocus())

    await userEvent.click(button)
    const listbox = await screen.findByRole('listbox', { name: 'Release channel' })
    await userEvent.click(within(listbox).getByRole('option', { name: /^Legacy/ }))
    await expect(listbox).toBeInTheDocument()

    await userEvent.click(document.body)
    await closed()
    await expect(button).toHaveTextContent('Stable')
    await expect(args['onUpdate:modelValue']).not.toHaveBeenCalled()
  }
}
