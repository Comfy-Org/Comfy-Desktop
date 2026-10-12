import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, screen, userEvent, waitFor } from 'storybook/test'
import { defineComponent, h, onUnmounted } from 'vue'
import { useModal } from '../src/renderer/src/composables/useModal'
import InstallWizardPreview from './InstallWizardPreview.vue'
import { createDesktopApi, retiredDesktopApi, type InstallScenario } from './desktopApi'

const meta = {
  title: 'Screens/Create a New Instance',
  component: InstallWizardPreview,
  tags: ['autodocs'],
  parameters: {
    desktopScenario: 'publicBuilds' satisfies InstallScenario,
    // Each mount creates fresh spies; the default restore would clear their calls on rerender.
    test: { restoreMocks: false },
    docs: {
      description: {
        component:
          'Explore the actual Desktop setup screen without launching Electron, signing in, or downloading ComfyUI. Public Builds are the standard ComfyUI environments. Managed Builds are setups published to a platform workspace. Sample Windows/NVIDIA responses stand in for the preload API; they do not test real hardware compatibility. File, browser and install actions are simulated.'
      }
    }
  },
  decorators: [
    // Scoped to the Vue mount: toolbar and args rerenders re-run beforeEach without remounting.
    (story, { parameters }) => {
      const Story = story()
      return defineComponent({
        setup() {
          window.api = createDesktopApi(parameters.desktopScenario)
          useModal().dismiss()
          onUnmounted(() => {
            useModal().dismiss()
            window.api = retiredDesktopApi
          })
          return () => h(Story)
        }
      })
    }
  ]
} satisfies Meta<typeof InstallWizardPreview>

export default meta
type Story = StoryObj<typeof meta>

// The real takeover and its alerts teleport outside canvasElement, so plays query `screen`.

export const PublicBuilds: Story = {
  play: async () => {
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
  play: async () => {
    await waitFor(() =>
      expect(screen.getByTestId('workspace-build-field')).toHaveTextContent('Studio Image Build')
    )
    await expect(screen.getByRole('radio', { name: 'Managed Builds' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(screen.queryByText('Build for another platform')).not.toBeInTheDocument()
    await expect(screen.getByText('Windows - NVIDIA (CUDA 13.0)')).toBeInTheDocument()
  }
}

export const ManagedInstallRequested: Story = {
  parameters: { desktopScenario: 'managedBuilds' satisfies InstallScenario },
  play: async () => {
    await waitFor(() =>
      expect(screen.getByTestId('workspace-build-field')).toHaveTextContent('Studio Image Build')
    )
    const install = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(install).toBeEnabled())
    await userEvent.click(install)
    await expect(
      await screen.findByText(/Simulated installation requested for preview-install/)
    ).toBeVisible()
    await expect(window.api.comfybuilder.installBuild).toHaveBeenCalledOnce()
  }
}

export const SignInToManagedBuilds: Story = {
  play: async () => {
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
  play: async () => {
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
  play: async () => {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: "Couldn't load builds. Retry" })).toBeVisible()
    )
  }
}

export const InstallError: Story = {
  parameters: { desktopScenario: 'installError' satisfies InstallScenario },
  play: async () => {
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
  play: async () => {
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
