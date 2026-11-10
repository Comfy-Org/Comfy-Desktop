import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const outPath = path.join(projectRoot, 'sandbox-test.wsb')

const wsb = `<Configuration>
    <VGpu>Disable</VGpu>
    <Networking>Default</Networking>
    <MappedFolders>
        <MappedFolder>
            <HostFolder>${distDir}</HostFolder>
            <SandboxFolder>C:\\installers</SandboxFolder>
            <ReadOnly>true</ReadOnly>
        </MappedFolder>
    </MappedFolders>
    <LogonCommand>
        <Command>powershell.exe -ExecutionPolicy Bypass -NoExit -Command "Copy-Item C:\\installers\\*.exe $env:USERPROFILE\\Desktop\\ -Force; Set-Location $env:USERPROFILE\\Desktop; Write-Host '=== Comfy Desktop installer sandbox ===' -ForegroundColor Cyan; Write-Host 'Installer copied to Desktop:' -ForegroundColor Green; Get-ChildItem *.exe | Format-Table Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,1)}}; Write-Host ''; Write-Host 'Fresh install (assisted wizard with directory picker):' -ForegroundColor Yellow; Write-Host '  .\\&lt;installer&gt;.exe' -ForegroundColor White; Write-Host ''; Write-Host 'Silent update simulation (no UI expected):' -ForegroundColor Yellow; Write-Host '  Start-Process .\\&lt;installer&gt;.exe -ArgumentList ''/S'' -Wait' -ForegroundColor White; Write-Host ''"</Command>
    </LogonCommand>
</Configuration>
`

fs.writeFileSync(outPath, wsb, 'utf8')
console.log(`Wrote ${outPath}`)
console.log(`  HostFolder: ${distDir}`)
if (!fs.existsSync(distDir)) {
  console.warn(`  WARNING: ${distDir} does not exist yet — run 'pnpm run build:win' first.`)
}
