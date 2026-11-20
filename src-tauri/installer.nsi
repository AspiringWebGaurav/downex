Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  SetCompressor /SOLID "{{compression}}"
!endif

{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"

; Installer & Uninstaller Icons (Must be set BEFORE MUI2.nsh and before any Page command)
!if "${INSTALLERICON}" != ""
  Icon "${INSTALLERICON}"
  !define MUI_ICON "${INSTALLERICON}"
!endif

!if "${UNINSTALLERICON}" != ""
  UninstallIcon "${UNINSTALLERICON}"
  !define MUI_UNICON "${UNINSTALLERICON}"
!else if "${INSTALLERICON}" != ""
  UninstallIcon "${INSTALLERICON}"
  !define MUI_UNICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Enable header images for installer and uninstaller pages when either image is configured.
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
!else if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!endif

; Uninstaller header image
!if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${UNINSTALLERHEADERIMAGE}"
!else if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${HEADERIMAGE}"
!endif

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "Win\RestartManager.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "https://downex.apps.gauravpatil.site"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName
Var CheckboxAutoStart
Var CheckboxAutoStartState
Var CheckboxDesktop
Var CheckboxDesktopState
Var CheckboxFirewall
Var CheckboxFirewallState
Var CheckboxGoldenBase
Var CheckboxGoldenBaseState

Var UninstOptionState
Var UninstOptionRadio1
Var UninstOptionRadio2
Var UninstOptionRadio3

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "CompanyName" "Gaurav Patil"
VIAddVersionKey "FileDescription" "Downex — Modern High-Performance Download Manager"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "OriginalFilename" "downexsetup.exe"
VIAddVersionKey "Comments" "High-performance software by Gaurav Patil. Visit https://downex.apps.gauravpatil.site and https://gauravpatil.site"

# additional plugins
!addplugindir "${ADDITIONALPLUGINSPATH}"

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; ==============================================================================
; Downex High-Performance 2-Screen Installer Flow (Blending CP & Send2Me)
; Screen 1: Full-Height Scrollable Agreement + Explicit Acceptance Checkbox
; Screen 2: System Integration & Options with Back Navigation
; ==============================================================================

Var ReinstallPageCheck
Page custom PageReinstall PageLeaveReinstall

; Screen 1: Full-height Scrollable License & Agreement Page with Checkbox (CP Style)
!ifndef MUI_PAGE_HEADER_TEXT
!define MUI_PAGE_HEADER_TEXT "${PRODUCTNAME} Setup"
!endif
!ifndef MUI_PAGE_HEADER_SUBTEXT
!define MUI_PAGE_HEADER_SUBTEXT "End User Acceptance Agreement"
!endif
!ifndef MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX
!endif
!ifndef MUI_LICENSEPAGE_CHECKBOX_TEXT
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "I accept the terms of the Use && Acceptance Agreement"
!endif
!insertmacro MUI_PAGE_LICENSE "${LICENSE}"

; Screen 2: System Integration & Permissions Setup Page (Downex Unique Options)
Page custom PageOptions PageLeaveOptions

; Screen 3: Instant Installation Progress
!insertmacro MUI_PAGE_INSTFILES

; Custom System Options Page Implementation
Function PageOptions
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    Return
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "System Preferences" "Choose startup options, shortcuts, and network integration for Downex"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "Select your installation preferences for Downex:"
  Pop $0

  ; Group Box for Options
  ${NSD_CreateGroupBox} 0 14u 100% 72u "Preferences and Network Integration"
  Pop $0

  ; Checkbox 1: Startup Auto-launch
  ${NSD_CreateCheckbox} 12u 26u 95% 12u "Start Downex automatically when Windows starts (Recommended)"
  Pop $CheckboxAutoStart
  ${If} $CheckboxAutoStartState == 1
    SendMessage $CheckboxAutoStart ${BM_SETCHECK} ${BST_CHECKED} 0
  ${Else}
    SendMessage $CheckboxAutoStart ${BM_SETCHECK} ${BST_UNCHECKED} 0
  ${EndIf}

  ; Checkbox 2: Desktop Shortcut
  ${NSD_CreateCheckbox} 12u 39u 95% 12u "Create a Desktop shortcut"
  Pop $CheckboxDesktop
  ${If} $CheckboxDesktopState == 1
    SendMessage $CheckboxDesktop ${BM_SETCHECK} ${BST_CHECKED} 0
  ${Else}
    SendMessage $CheckboxDesktop ${BM_SETCHECK} ${BST_UNCHECKED} 0
  ${EndIf}

  ; Checkbox 3: Windows Firewall Rule
  ${NSD_CreateCheckbox} 12u 52u 95% 12u "Add Windows Firewall exception for downloads (Recommended)"
  Pop $CheckboxFirewall
  ${If} $CheckboxFirewallState == 1
    SendMessage $CheckboxFirewall ${BM_SETCHECK} ${BST_CHECKED} 0
  ${Else}
    SendMessage $CheckboxFirewall ${BM_SETCHECK} ${BST_UNCHECKED} 0
  ${EndIf}

  ; Checkbox 4: Automatic Recovery Backup
  ${NSD_CreateCheckbox} 12u 65u 95% 12u "Create backup snapshot to safely restore Downex (Recommended)"
  Pop $CheckboxGoldenBase
  ${If} $CheckboxGoldenBaseState == 1
    SendMessage $CheckboxGoldenBase ${BM_SETCHECK} ${BST_CHECKED} 0
  ${Else}
    SendMessage $CheckboxGoldenBase ${BM_SETCHECK} ${BST_UNCHECKED} 0
  ${EndIf}

  ; Destination Path Group
  ${NSD_CreateGroupBox} 0 90u 100% 44u "Installation Details"
  Pop $0

  ${NSD_CreateLabel} 12u 102u 90% 10u "Install location: $INSTDIR"
  Pop $0

  ${NSD_CreateLabel} 12u 115u 90% 10u "Install for: Current user (No Administrator rights required)"
  Pop $0

  ; Customize Buttons: Change 'Next' button text to 'Install'
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Install"

  ; Ensure 'Back' button is visible so user can go back to Agreement screen
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 1
  EnableWindow $0 1

  nsDialogs::Show
FunctionEnd

Function PageLeaveOptions
  ${NSD_GetState} $CheckboxAutoStart $CheckboxAutoStartState
  ${NSD_GetState} $CheckboxDesktop $CheckboxDesktopState
  ${NSD_GetState} $CheckboxFirewall $CheckboxFirewallState
  ${NSD_GetState} $CheckboxGoldenBase $CheckboxGoldenBaseState
FunctionEnd

; ==============================================================================
; Downex Uninstaller Flow (Blending Send2Me Clean Custom Options + CP AutoClose)
; Screen 1: Send2Me-style Custom Removal Options Page
; Screen 2: Instant Uninstallation Progress + Auto Close & Web Launch
; ==============================================================================

UninstPage custom un.DownexRemovalPage un.DownexRemovalPageLeave
!insertmacro MUI_UNPAGE_INSTFILES

Function un.DownexRemovalPage
  StrCpy $UninstOptionState 1

  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

  !insertmacro MUI_HEADER_TEXT "Uninstall Downex" "Choose how to handle your downloaded files, queue database, and settings."

  ${NSD_CreateLabel} 0 0 100% 20u "Please select an uninstallation option for Downex Download Manager:"
  Pop $0

  ${NSD_CreateRadioButton} 10u 26u 90% 26u "Option 1: Keep Downloaded Files & History (Recommended)$\r$\nRemoves the app, but keeps your saved downloads and task queue database intact."
  Pop $UninstOptionRadio1
  ${NSD_Check} $UninstOptionRadio1

  ${NSD_CreateRadioButton} 10u 56u 90% 26u "Option 2: Delete App & Settings$\r$\nRemoves the app and clears local settings and cache (%LOCALAPPDATA%\Downex)."
  Pop $UninstOptionRadio2

  ${NSD_CreateRadioButton} 10u 86u 90% 26u "Option 3: Complete Clean Wipe (Irreversible)$\r$\nRemoves all binaries, queue database, settings, firewall rules, and registry entries."
  Pop $UninstOptionRadio3

  ; Customize button text to "Uninstall"
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Uninstall"

  nsDialogs::Show
FunctionEnd

Function un.DownexRemovalPageLeave
  ${NSD_GetState} $UninstOptionRadio1 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstOptionState 1
  ${EndIf}
  ${NSD_GetState} $UninstOptionRadio2 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstOptionState 2
  ${EndIf}
  ${NSD_GetState} $UninstOptionRadio3 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstOptionState 3
    MessageBox MB_ICONEXCLAMATION|MB_YESNO|MB_DEFBUTTON2 \
      "WARNING: Irreversible Action!$\r$\n$\r$\nComplete Clean Wipe will permanently remove:$\r$\n* Downex download manager binaries$\r$\n* Local queue database and metadata$\r$\n* Network and speed limit configurations$\r$\n* Windows Firewall rules and registry keys$\r$\n$\r$\nAre you sure you want to proceed?" \
      IDYES wipe_confirmed
    StrCpy $UninstOptionState 1
    ${NSD_Check} $UninstOptionRadio1
    ${NSD_Uncheck} $UninstOptionRadio3
    Abort
    wipe_confirmed:
  ${EndIf}
FunctionEnd

; Reinstall helper functions
Function FindWixInstall
  StrCpy $R6 ""
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
  wix_loop_done:
FunctionEnd

Function PageReinstall
  Call FindWixInstall
  ${If} $R6 != ""
    StrCpy $WixMode 1
    Goto compare_version
  ${EndIf}

  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0

  StrCpy $R5 "$(chooseHowToInstall)"
  ${IfThen} $R5 == "" ${|} StrCpy $R5 "$(choowHowToInstall)" ${|}

  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$R5"
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$R5"
  ${Else}
    Abort
  ${EndIf}

  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    nsDialogs::Create 1018
    Pop $R4
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

    ${NSD_CreateLabel} 0 0 100% 24u $R1
    Pop $R1

    ${NSD_CreateRadioButton} 10u 30u 90% 30u $R2
    Pop $ReinstallPageCheck
    ${NSD_Check} $ReinstallPageCheck

    ${NSD_CreateRadioButton} 10u 60u 90% 50u $R3
    Pop $R2
    nsDialogs::Show
  ${EndIf}
FunctionEnd

Function PageLeaveReinstall
  ${If} $PassiveMode = 0
    ${NSD_GetState} $ReinstallPageCheck $R1
  ${Else}
    StrCpy $R1 0
  ${EndIf}

  ${If} $WixMode = 1
    Goto reinst_uninstall
  ${EndIf}

  ${If} $UpdateMode = 1
    Goto reinst_done
  ${EndIf}

  ${If} $R0 = 0
    ${If} $R1 = 1
      Goto reinst_done
    ${Else}
      Goto reinst_uninstall
    ${EndIf}
  ${ElseIf} $R0 = 1
    ${If} $R1 = 1
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done
    ${EndIf}
  ${ElseIf} $R0 = -1
    !if "${ALLOWDOWNGRADES}" == "true"
      ${If} $R1 = 1
        Goto reinst_uninstall
      ${Else}
        Goto reinst_done
      ${EndIf}
    !else
      ${If} $R1 = 1
        Goto reinst_uninstall
      ${Else}
        Abort
      ${EndIf}
    !endif
  ${EndIf}

  reinst_uninstall:
    ${If} $WixMode = 1
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ClearErrors
      ExecWait '$R1 /P _?=$INSTDIR' $0
    ${EndIf}

    ${If} ${Errors}
    ${OrIf} $0 != 0
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${Else}
      ${If} $WixMode = 0
        Delete "$R1"
        RMDir "$INSTDIR"
      ${EndIf}
    ${EndIf}

  reinst_done:
FunctionEnd

{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
LangString choowHowToInstall 0 ""
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Function .onInit
  StrCpy $CheckboxAutoStartState 1
  StrCpy $CheckboxDesktopState 1
  StrCpy $CheckboxFirewallState 1
  StrCpy $CheckboxGoldenBaseState 1

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif

  !insertmacro SetContext

  ; Proactively sweep any broken or orphaned legacy uninstall keys from previous product names or interrupted installs
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"

  ; If an existing Downex uninstall entry points to a missing uninstaller, purge the orphaned registry key
  ReadRegStr $0 HKCU "${UNINSTKEY}" "UninstallString"
  ${If} $0 != ""
    ReadRegStr $1 HKCU "${UNINSTKEY}" "InstallLocation"
    ${If} $1 != ""
      ${IfNot} ${FileExists} "$1\uninstall.exe"
        DeleteRegKey HKCU "${UNINSTKEY}"
      ${EndIf}
    ${Else}
      ${IfNot} ${FileExists} "$LOCALAPPDATA\Programs\${PRODUCTNAME}\uninstall.exe"
        DeleteRegKey HKCU "${UNINSTKEY}"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${If} $UpdateMode = 1
    ${If} ${FileExists} "$INSTDIR"
      Goto instdir_done
    ${EndIf}
  ${EndIf}

  ReadRegStr $0 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $0 != ""
    StrCpy $INSTDIR $0
    Goto instdir_done
  ${EndIf}

  !if "${INSTALLMODE}" == "perMachine"
    ${If} "${ARCH}" == "x64"
      StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
    ${Else}
      StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
    ${EndIf}
  !else if "${INSTALLMODE}" == "currentUser"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCTNAME}"
  !endif

  instdir_done:
FunctionEnd

Section -CheckWebview
  !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
    !define INSTALLWEBVIEW2
  !else if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
    !define INSTALLWEBVIEW2
  !else if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
    !define INSTALLWEBVIEW2
  !endif

  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    DetailPrint "$(webview2NotInstalled)"
    !ifdef INSTALLWEBVIEW2
      ${If} $PassiveMode = 1
        Goto install_webview2
      ${EndIf}
      Goto install_webview2

      install_webview2:
        DetailPrint "$(installingWebview2)"
        !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
          Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
          DetailPrint "$(downloadingWebview2)"
          NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
          Pop $0
          ${If} $0 != "success"
            DetailPrint "$(downloadFailed): $0"
            Abort "$(webview2InstallError)"
          ${EndIf}
          ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" ${WEBVIEW2INSTALLERARGS}' $0
          Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        !endif
        ${If} $0 == 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          Abort "$(webview2InstallError)"
        ${EndIf}
      webview2_done:
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  File "${MAINBINARYSRCPATH}"

  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0" "Open with ${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    {{/each}}
  {{/each}}

  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  ; Purge any duplicate obsolete uninstall registry keys from previous builds
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  RMDir /r "$LOCALAPPDATA\Programs\Downex Download Manager"

  !if "${INSTALLMODE}" == "both"
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; Create Start Menu Shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0 "" "" "${PRODUCTNAME}"
  !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"

  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  ; Windows Startup Registry (HKCU Run)
  ${If} $CheckboxAutoStartState = 1
  ${OrIf} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --autostart'
  ${EndIf}

  ; Desktop Shortcut
  ${If} $CheckboxDesktopState = 1
  ${OrIf} $PassiveMode = 1
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  ; Windows Firewall Inbound Rule
  ${If} $CheckboxFirewallState = 1
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${PRODUCTNAME}" dir=in action=allow program="$INSTDIR\${MAINBINARYNAME}.exe" enable=yes profile=any'
  ${EndIf}

  ; Golden Base Recovery Snapshot
  ${If} $CheckboxGoldenBaseState = 1
    CreateDirectory "$LOCALAPPDATA\Downex\base"
    CopyFiles /SILENT "$INSTDIR\${MAINBINARYNAME}.exe" "$LOCALAPPDATA\Downex\base\downex-base.exe"
    FileOpen $9 "$LOCALAPPDATA\Downex\base\base_version.txt" w
    FileWrite $9 "${VERSION}"
    FileClose $9
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ; Auto-close installation page on completion
  SetAutoClose true
SectionEnd

Function .onInstSuccess
  ${If} $UpdateMode <> 1
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "--first-install"
  ${EndIf}
FunctionEnd

Function un.CheckRunningProcess
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    Return
  ${EndIf}

  FindWindow $0 "Downex_WINDOW_CLASS" ""
  ${If} $0 != 0
    Goto kill_process
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ClearErrors
    FileOpen $0 "$INSTDIR\${MAINBINARYNAME}.exe" "a"
    ${If} ${Errors}
      Goto kill_process
    ${Else}
      FileClose $0
    ${EndIf}
  ${EndIf}

  Return

  kill_process:
    FindWindow $0 "Downex_WINDOW_CLASS" ""
    ${If} $0 != 0
      SendMessage $0 ${WM_CLOSE} 0 0
      Sleep 400
    ${EndIf}
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Downex.exe /T'
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex.exe /T'
    Sleep 300
    Return
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  ; Proactively sweep any broken or orphaned legacy uninstall keys from previous product names or interrupted installs
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"

  ; If an existing Downex uninstall entry points to a missing uninstaller, purge the orphaned registry key
  ReadRegStr $0 HKCU "${UNINSTKEY}" "UninstallString"
  ${If} $0 != ""
    ReadRegStr $1 HKCU "${UNINSTKEY}" "InstallLocation"
    ${If} $1 != ""
      ${IfNot} ${FileExists} "$1\uninstall.exe"
        DeleteRegKey HKCU "${UNINSTKEY}"
      ${EndIf}
    ${Else}
      ${IfNot} ${FileExists} "$LOCALAPPDATA\Programs\${PRODUCTNAME}\uninstall.exe"
        DeleteRegKey HKCU "${UNINSTKEY}"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  Call un.CheckRunningProcess
FunctionEnd

Section Uninstall
  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}

  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}

  RMDir /REBOOTOK "$INSTDIR"

  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
    RMDir "$SMPROGRAMS\${PRODUCTNAME}"
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; Unconditionally delete uninstallation keys across HKCU, HKLM, and WOW6432Node
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKLM "${UNINSTKEY}"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Downex Download Manager"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.downex.manager"
  RMDir /r "$LOCALAPPDATA\Programs\Downex Download Manager"

  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Handle app data cleanup based on Send2Me-style selected removal option
  ${If} $UninstOptionState = 2
    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\Downex"
  ${ElseIf} $UninstOptionState = 3
    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\Downex"
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
    DeleteRegKey HKCU "Software\Downex"
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${PRODUCTNAME}"'
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; Launch uninstallation confirmation page on successful interactive removal
  ${If} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
    ExecShell "open" "https://downex.apps.gauravpatil.site/uninstalled"
  ${EndIf}

  ; Auto-close uninstaller upon completion (frictionless zero-click finish, never stuck on Next/Finish/Close)
  SetAutoClose true
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
