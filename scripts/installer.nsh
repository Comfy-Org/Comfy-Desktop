!include 'MUI2.nsh'
!include 'FileFunc.nsh'
!include 'LogicLib.nsh'
!include 'WordFunc.nsh'

!include "${BUILD_RESOURCES_DIR}\vc_redist_version.nsh"
!include 'x64.nsh'

!ifdef APP_ARM64
  !ifndef VC_REDIST_ARM64_VERSION
    !error "vc_redist.arm64.exe is missing from ${BUILD_RESOURCES_DIR}: scripts/afterPack.mjs did not run for the arm64 target"
  !endif
!endif
!ifdef APP_64
  !ifndef VC_REDIST_X64_VERSION
    !error "vc_redist.x64.exe is missing from ${BUILD_RESOURCES_DIR}: scripts/afterPack.mjs did not run for the x64 target"
  !endif
!endif

!ifndef allowToChangeInstallationDirectory
  !define allowToChangeInstallationDirectory
!endif

!ifdef BUILD_UNINSTALLER
  Var comfyRemoveInstances
  Var comfyRemoveModels
  Var comfyRemoveInputOutput
  Var comfyFullUninstall
!endif

!macro customHeader
  !pragma warning disable 6030
  LangString perUserInstallExists 1033 "$(^Name) is already installed for your account.$\r$\n"
  LangString perUserInstall 1033 "$(^Name) is installed for your account.$\r$\n"
  LangString perMachineInstallExists 1033 "$(^Name) is already installed for all users.$\r$\n"
  LangString perMachineInstall 1033 "$(^Name) is installed for all users.$\r$\n"
  LangString reinstallUpgrade 1033 "Setup will update your existing installation."
  !pragma warning enable 6030

  ShowInstDetails show

  Section "-VcRedistPreInstall"
    ${IfNot} ${isUpdated}
      !insertmacro installVcRedist
    ${EndIf}
  SectionEnd
!macroend

!macro customInstallMode
  ${GetParameters} $R0

  ClearErrors
  ${GetOptions} $R0 "/ALLUSERS" $R1
  ${IfNot} ${Errors}
    StrCpy $isForceMachineInstall 1
  ${Else}
    ClearErrors
    ${GetOptions} $R0 "/CURRENTUSER" $R1
    ${IfNot} ${Errors}
      StrCpy $isForceCurrentInstall 1
    ${Else}
      ${If} ${isUpdated}
        ${If} $installMode == "all"
          StrCpy $isForceMachineInstall 1
        ${Else}
          StrCpy $isForceCurrentInstall 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro installVcRedist
  Push $1
  Push $2
  Push $R6
  Push $R7
  Push $R8
  Push $R9

  SetDetailsPrint both

  StrCpy $R6 ""
  !ifdef APP_ARM64
    ${If} ${IsNativeARM64}
      StrCpy $R6 "ARM64"
      StrCpy $R7 "${VC_REDIST_ARM64_VERSION}"
      StrCpy $R9 "vc_redist.arm64.exe"
    ${EndIf}
  !endif
  !ifdef APP_64
    ${If} $R6 == ""
      StrCpy $R6 "X64"
      StrCpy $R7 "${VC_REDIST_X64_VERSION}"
      StrCpy $R9 "vc_redist.x64.exe"
    ${EndIf}
  !endif

  ${If} $R6 == ""
    DetailPrint "Step 1 of 3: Microsoft Visual C++ Redistributable"
    DetailPrint "  No redistributable is bundled for this machine's architecture — skipping."
  ${Else}

  StrCpy $1 ""
  ClearErrors
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\$R6" "Version"
  ${If} ${Errors}
    StrCpy $1 ""
  ${EndIf}

  ${If} $1 != ""
    StrCpy $2 $1 1
    ${If} $2 == "v"
      StrCpy $1 $1 "" 1
    ${EndIf}
  ${EndIf}

  ${If} $1 == ""
    StrCpy $2 2
  ${Else}
    ${VersionCompare} "$1" "$R7" $2
  ${EndIf}

  DetailPrint "Step 1 of 3: Microsoft Visual C++ Redistributable ($R6)"
  DetailPrint "  Detected installed version: $1"
  DetailPrint "  Bundled version: $R7"

  ${If} $2 == 2
    DetailPrint "  Installing Microsoft Visual C++ Redistributable (this may take several minutes)..."

    !ifdef APP_ARM64
      ${If} $R6 == "ARM64"
        File /oname=$PLUGINSDIR\vc_redist.arm64.exe "${BUILD_RESOURCES_DIR}\vc_redist.arm64.exe"
      ${EndIf}
    !endif
    !ifdef APP_64
      ${If} $R6 == "X64"
        File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
      ${EndIf}
    !endif
    vcRedistAttempt:
    BringToFront
    ClearErrors
    ExecShellWait "runas" "$PLUGINSDIR\$R9" "/install /quiet /norestart"
    StrCpy $R8 "ok"
    ${If} ${Errors}
      StrCpy $R8 "ERR"
    ${EndIf}
    BringToFront

    ${If} $R8 == "ERR"
      DetailPrint "Microsoft Visual C++ Redistributable was not installed (permission prompt declined)."
      BringToFront
      MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "Comfy Desktop needs the Microsoft Visual C++ Redistributable. Installing it requires Windows permission, and that prompt was declined.$\n$\nRetry — show the permission prompt again (recommended)$\nIgnore — install ComfyUI anyway (it may not start until the Redistributable is installed)$\nAbort — stop and exit Setup" /SD IDABORT IDRETRY vcRedistAttempt IDIGNORE vcRedistIgnore
      SetErrorLevel 2
      Quit
    ${EndIf}

    DetailPrint "  Microsoft Visual C++ Redistributable installed."
    Goto vcRedistDone
    vcRedistIgnore:
    DetailPrint "  Continuing without the Microsoft Visual C++ Redistributable — ComfyUI may not start until it is installed."
    vcRedistDone:
  ${Else}
    DetailPrint "  Already up to date — skipping install."
  ${EndIf}

  ${EndIf}

  DetailPrint ""
  DetailPrint "Step 2 of 3: Comfy Desktop application files"
  DetailPrint "  Extracting to $INSTDIR (this may take a minute)..."

  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $2
  Pop $1
!macroend

!macro persistWebsiteAnonymousIdFromInstallerName
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5

  ${If} $installMode != "all"
  SetShellVarContext current
  StrCpy $R2 "$APPDATA\Comfy Desktop"
  Delete "$R2\pending-website-anonymous-id.txt"

  ${GetFileName} "$EXEPATH" $R0
  StrLen $R5 "$R0"
  StrCpy $R4 ""

  ${If} $R5 >= 62
    StrCpy $R1 "$R0" 26
    ${If} $R1 S== "Comfy-Desktop-Setup-phid1_"
      StrCpy $R4 "$R0" 36 26
    ${EndIf}
  ${EndIf}

  StrLen $R3 "$R4"
  ${If} $R3 == 36
    CreateDirectory "$R2"
    ClearErrors
    FileOpen $R3 "$R2\pending-website-anonymous-id.txt" w
    ${IfNot} ${Errors}
      FileWrite $R3 "$R4$\r$\n"
      FileClose $R3
      DetailPrint "  Website attribution identity stored."
    ${Else}
      DetailPrint "  Website attribution identity could not be stored."
    ${EndIf}
  ${EndIf}
  ${EndIf}

  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customInstall
  SetDetailsPrint both
  !insertmacro persistWebsiteAnonymousIdFromInstallerName
  DetailPrint "  Application files installed to: $INSTDIR"
  DetailPrint "  Registered with Add or Remove Programs"
  DetailPrint "  Start Menu shortcut created"
  DetailPrint "  Uninstaller written: ${UNINSTALL_FILENAME}"
  DetailPrint ""
  DetailPrint "Step 3 of 3: Finishing up"
  DetailPrint "  Cleaning up temporary files..."
  DetailPrint "  Comfy Desktop is ready to launch."
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  Function CreateUserDesktopShortcut
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x1002, i 0, i 0, i 0)'
  FunctionEnd

  Var ComfyDesktopShortcutCheckbox
  Var ComfyDesktopShortcutState

  Function FinishPageShowDesktopShortcutCheckbox
    ${NSD_CreateCheckbox} 120u 110u 195u 10u "Add a desktop shortcut"
    Pop $ComfyDesktopShortcutCheckbox
    ${NSD_SetState} $ComfyDesktopShortcutCheckbox ${BST_CHECKED}
  FunctionEnd

  Function FinishPageLeaveDesktopShortcut
    ${NSD_GetState} $ComfyDesktopShortcutCheckbox $ComfyDesktopShortcutState
    ${If} $ComfyDesktopShortcutState == ${BST_CHECKED}
      Call CreateUserDesktopShortcut
    ${EndIf}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishPageShowDesktopShortcutCheckbox
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE FinishPageLeaveDesktopShortcut

  !define MUI_PAGE_CUSTOMFUNCTION_PRE FinishPagePreCheck
  !insertmacro MUI_PAGE_FINISH

  Function FinishPagePreCheck
    ${if} ${isUpdated}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      Abort
    ${endif}
  FunctionEnd
!macroend

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME

  Var comfyRemoveDialog
  Var comfyRemoveInstancesCheckbox
  Var comfyRemoveModelsCheckbox
  Var comfyRemoveInputOutputCheckbox

  Function un.ComfyRemovalChoicesPage
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} ${Silent}
      Abort
    ${EndIf}
    ${If} $installMode == "all"
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "Choose what to remove" "Comfy Desktop's logs, caches and temporary files are always removed."

    nsDialogs::Create 1018
    Pop $comfyRemoveDialog
    ${If} $comfyRemoveDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0u 100% 12u "Delete all ComfyUI instances"
    Pop $comfyRemoveInstancesCheckbox
    ${If} $comfyRemoveInstances == ${BST_CHECKED}
      ${NSD_Check} $comfyRemoveInstancesCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 12u 13u 92% 24u "Removes every ComfyUI install Comfy Desktop created and everything in it, including an install's own input and output if it does not use the shared ones."
    Pop $0

    ${NSD_CreateCheckbox} 0 41u 100% 12u "Delete all model files"
    Pop $comfyRemoveModelsCheckbox
    ${If} $comfyRemoveModels == ${BST_CHECKED}
      ${NSD_Check} $comfyRemoveModelsCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 12u 54u 92% 16u "Removes the shared models folder Comfy Desktop downloads into. Model folders you added yourself are kept."
    Pop $0

    ${NSD_CreateCheckbox} 0 74u 100% 12u "Delete all input and output files"
    Pop $comfyRemoveInputOutputCheckbox
    ${If} $comfyRemoveInputOutput == ${BST_CHECKED}
      ${NSD_Check} $comfyRemoveInputOutputCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 12u 87u 92% 16u "Removes the shared input and output folders and the files in them. Folders you picked yourself are kept."
    Pop $0

    ${NSD_CreateLabel} 0 110u 100% 16u "Leave a box unchecked to keep that data. Installing Comfy Desktop again will find it."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function un.ComfyRemovalChoicesPageLeave
    ${NSD_GetState} $comfyRemoveInstancesCheckbox $comfyRemoveInstances
    ${NSD_GetState} $comfyRemoveModelsCheckbox $comfyRemoveModels
    ${NSD_GetState} $comfyRemoveInputOutputCheckbox $comfyRemoveInputOutput
  FunctionEnd

  UninstPage custom un.ComfyRemovalChoicesPage un.ComfyRemovalChoicesPageLeave
!macroend

!macro runComfyUninstallCleanup
  Push $0
  Push $1

  StrCpy $1 ""
  ${If} $comfyRemoveInstances == ${BST_CHECKED}
    StrCpy $1 "$1 --delete-instances"
  ${EndIf}
  ${If} $comfyRemoveModels == ${BST_CHECKED}
    StrCpy $1 "$1 --delete-models"
  ${EndIf}
  ${If} $comfyRemoveInputOutput == ${BST_CHECKED}
    StrCpy $1 "$1 --delete-input-output"
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    DetailPrint "Removing Comfy Desktop data..."
    nsExec::Exec /TIMEOUT=1800000 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup$1'
    Pop $0
    DetailPrint "  Data cleanup finished: $0"
    ${If} $0 != "0"
      DetailPrint "  Some data was kept. See $TEMP\comfy-desktop-uninstall-cleanup.log"
    ${EndIf}
  ${EndIf}

  Pop $1
  Pop $0
!macroend

!macro customRemoveFiles
  StrCpy $comfyFullUninstall "1"
  ${If} ${isUpdated}
    StrCpy $comfyFullUninstall "0"
  ${EndIf}
  Push $R1
  Push $R2
  ${GetParameters} $R1
  ClearErrors
  ${GetOptions} $R1 "/KEEP_APP_DATA" $R2
  ${IfNot} ${Errors}
    StrCpy $comfyFullUninstall "0"
  ${EndIf}
  ClearErrors
  Pop $R2
  Pop $R1

  ${If} $comfyFullUninstall == "1"
  ${AndIf} $installMode != "all"
    !insertmacro runComfyUninstallCleanup
  ${EndIf}

  ${If} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${If} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      Push ""
      Call un.restoreFiles
      Pop $R0

      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${EndIf}
  ${EndIf}

  SetOutPath $TEMP
  RMDir /r $INSTDIR

  ${If} $comfyFullUninstall == "1"
    RMDir /REBOOTOK $INSTDIR
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
  ${EndIf}
!macroend
