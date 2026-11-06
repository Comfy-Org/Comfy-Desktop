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
