import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useModal } from '../src/renderer/src/composables/useModal'
import InstallWizardPreview from './InstallWizardPreview.vue'
import { createDesktopApi, type InstallScenario } from './desktopApi'

const meta = {
  title: 'Screens/Create a New Instance',
  component: InstallWizardPreview,
  tags: ['autodocs'],
  parameters: {
    desktopScenario: 'publicBuilds' satisfies InstallScenario,
    docs: {
      description: {
        component:
          'Explore the actual Desktop setup screen without launching Electron, signing in, or downloading ComfyUI. Public Builds are the standard ComfyUI environments. Managed Builds are setups published to a platform workspace. Sample Windows/NVIDIA responses stand in for the preload API; they do not test real hardware compatibility. File, browser and install actions are simulated.'
      }
    }
  },
  beforeEach({ parameters }) {
    const previousApi = window.api
    window.api = createDesktopApi(parameters.desktopScenario)
    useModal().dismiss()
    return () => {
      useModal().dismiss()
      window.api = previousApi
    }
  }
} satisfies Meta<typeof InstallWizardPreview>

export default meta
type Story = StoryObj<typeof meta>

// The real takeover and its alerts teleport outside canvasElement.
function screenFor(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

export const PublicBuilds: Story = {
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Create a New Instance' })).toBeVisible()
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    await expect(screen.getByRole('radio', { name: 'Public Builds' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  }
}

export const ManagedBuilds: Story = {
  parameters: { desktopScenario: 'managedBuilds' satisfies InstallScenario },
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement)
    await waitFor(() =>
      expect(screen.getByTestId('workspace-build-field')).toHaveTextContent('Studio Image Build')
    )
    await expect(screen.getByRole('radio', { name: 'Managed Builds' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(screen.queryByText('Build for another platform')).not.toBeInTheDocument()
  }
}

export const SignInToManagedBuilds: Story = {
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    await userEvent.click(await screen.findByRole('radio', { name: 'Managed Builds' }))
    await waitFor(() =>
      expect(screen.getByTestId('workspace-build-field')).toHaveTextContent('Studio Image Build')
    )
    await expect(window.api.comfybuilder.signIn).toHaveBeenCalledOnce()
  }
}

export const NoCompatibleBuilds: Story = {
  parameters: { desktopScenario: 'noCompatibleBuilds' satisfies InstallScenario },
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement)
    // The real screen defaults to Public Builds when the workspace has no
    // compatible release. Select Managed Builds to inspect its empty state.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    await userEvent.click(screen.getByRole('radio', { name: 'Managed Builds' }))
    await waitFor(() =>
      expect(screen.getByText('No compatible Builds are available to install.')).toBeVisible()
    )
    await expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  }
}

export const BuildLoadError: Story = {
  parameters: { desktopScenario: 'buildLoadError' satisfies InstallScenario },
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: "Couldn't load builds. Retry" })).toBeVisible()
    )
  }
}

export const InstallError: Story = {
  parameters: { desktopScenario: 'installError' satisfies InstallScenario },
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement)
    const install = await screen.findByRole('button', { name: 'Continue' })
    await waitFor(() => expect(install).toBeEnabled())
    await userEvent.click(install)
    await waitFor(() =>
      expect(screen.getByText('This build is not compatible with this machine.')).toBeVisible()
    )
  }
}

export const LowDiskSpace: Story = {
  parameters: { desktopScenario: 'lowDiskSpace' satisfies InstallScenario },
  play: async ({ canvasElement }) => {
    const screen = screenFor(canvasElement)
    const next = await screen.findByRole('button', { name: 'Continue' })
    await waitFor(() => expect(next).toBeEnabled())
    await userEvent.click(next)
    await userEvent.click(await screen.findByRole('radio', { name: /Starter Image Workflow/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Install' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
  }
}
