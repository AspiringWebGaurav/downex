; ==============================================================================
; Downex — NSIS Installer & Uninstaller Customization Hooks
; Developer: Gaurav Patil (https://gauravpatil.site)
; App: https://downex.apps.gauravpatil.site
; Clean process shutdown using trusted $SYSDIR pathing (zero AV heuristic flags)
; ==============================================================================

; 1. Require user to check "I accept the terms in the license agreement" before proceeding
!ifndef MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX
!endif
!ifndef MUI_LICENSEPAGE_CHECKBOX_TEXT
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "I accept the terms of the Use && Acceptance Agreement"
!endif

; 2. Pre-install hook: Politely terminate running Downex instances
!macro NSIS_HOOK_PREINSTALL
  ; Silent forced kill fallback to guarantee zero locks or zombie processes
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Downex.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM DownexService.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex_service.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM DownexRecovery.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex_recovery.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM updater.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex_bridge.exe /T'
  Sleep 400

  ; Purge legacy install folder if empty or abandoned
  RMDir /r "$LOCALAPPDATA\Programs\Downex Download Manager"

  ; Clean lingering update artifacts and stale versions on fresh install
  Delete "$LOCALAPPDATA\com.downex.manager\installed_version.json"
  Delete "$LOCALAPPDATA\Downex\installed_version.json"
  Delete "$LOCALAPPDATA\com.downex.manager\update_restart.flag"
  Delete "$LOCALAPPDATA\com.downex.manager\executed_tasks.json"
  Delete "$LOCALAPPDATA\Temp\com.downex.manager\*"
  Delete "$INSTDIR\updater\sync_state.dat"
!macroend

; 3. Pre-uninstall hook: Terminate running Downex before uninstallation
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Downex.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM DownexService.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex_service.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM DownexRecovery.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex_recovery.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM updater.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex_bridge.exe /T'
  Sleep 400
!macroend

; 4. Post-install hook: Clean superseded staging remnants without overriding user checkbox choices
!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\*.old"
  Delete "$INSTDIR\*.staged"
  Delete "$INSTDIR\*.new"
  Delete "$INSTDIR\*.bad"
!macroend

; 5. Post-uninstall hook: Clean shortcuts, firewall rules, and refresh taskbar tray respecting UpdateMode & UninstOptionState
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Remove Desktop and Start Menu Shortcuts
    Delete "$DESKTOP\Downex.lnk"
    Delete "$DESKTOP\downex.lnk"
    Delete "$SMPROGRAMS\Downex.lnk"
    Delete "$SMPROGRAMS\Downex Download Manager.lnk"
    RMDir /r "$SMPROGRAMS\Downex"
    RMDir /r "$SMPROGRAMS\Downex Download Manager"
    RMDir /r "$LOCALAPPDATA\Programs\Downex Download Manager"
    RMDir /r "$INSTDIR\updater"
    RMDir /r "$INSTDIR\engine"
    RMDir /r "$INSTDIR\security"
    RMDir /r "$INSTDIR\core"
    RMDir /r "$INSTDIR\license"
    RMDir /r "$INSTDIR\research_and_study"
    Delete "$LOCALAPPDATA\com.downex.manager\update_restart.flag"

    ${If} $UninstOptionState = 3
      RMDir /r "$LOCALAPPDATA\Temp\com.downex.manager"
      RMDir /r "$TEMP\com.downex.manager"

      ; Clean Downex custom registry trees & protocol handlers
      DeleteRegKey HKCU "Software\Downex"
      DeleteRegKey HKLM "Software\Downex"
      DeleteRegKey HKCU "Software\Classes\downex"
      DeleteRegKey HKLM "Software\Classes\downex"

      ; Delete Windows Firewall inbound rules
      nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${PRODUCTNAME}"'
      nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Downex Download Manager"'
    ${EndIf}
  ${EndIf}

  ; Refresh Windows Explorer notification area so zero ghost tray icons linger
  FindWindow $0 "Shell_TrayWnd" ""
  ${If} $0 != 0
    FindWindow $1 "TrayNotifyWnd" "" $0
    ${If} $1 != 0
      FindWindow $2 "SysPager" "" $1
      ${If} $2 != 0
        FindWindow $3 "ToolbarWindow32" "" $2
      ${Else}
        FindWindow $3 "ToolbarWindow32" "" $1
      ${EndIf}
      ${If} $3 != 0
        System::Call "user32::RedrawWindow(p r3, p 0, p 0, i 0x0185)"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  FindWindow $0 "NotifyIconOverflowWindow" ""
  ${If} $0 != 0
    FindWindow $1 "ToolbarWindow32" "" $0
    ${If} $1 != 0
      System::Call "user32::RedrawWindow(p r1, p 0, p 0, i 0x0185)"
    ${EndIf}
  ${EndIf}
!macroend
