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

; 2. Pre-install hook: Politely signal and terminate running Downex instances
!macro NSIS_HOOK_PREINSTALL
  ; Politely close running Downex window if open
  FindWindow $0 "Downex_WINDOW_CLASS" ""
  ${If} $0 != 0
    SendMessage $0 ${WM_CLOSE} 0 0
    Sleep 300
  ${EndIf}

  ; Silent forced kill fallback to guarantee zero locks or zombie processes
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Downex.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex.exe /T'
  Sleep 400
!macroend

; 3. Pre-uninstall hook: Terminate running Downex before uninstallation
!macro NSIS_HOOK_PREUNINSTALL
  FindWindow $0 "Downex_WINDOW_CLASS" ""
  ${If} $0 != 0
    SendMessage $0 ${WM_CLOSE} 0 0
    Sleep 300
  ${EndIf}

  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Downex.exe /T'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM downex.exe /T'
  Sleep 400
!macroend

; 4. Post-install hook: Shortcuts and Firewall Rule
!macro NSIS_HOOK_POSTINSTALL
  ; Create Desktop Shortcut for current/all users
  CreateShortcut "$DESKTOP\Downex.lnk" "$INSTDIR\Downex.exe" "" "$INSTDIR\Downex.exe" 0 "" "" "Downex Download Manager"

  ; Add Windows Firewall inbound exception for Downex binary
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Downex Download Manager" dir=in action=allow program="$INSTDIR\Downex.exe" enable=yes profile=any'

  Delete "$INSTDIR\*.old"
  Delete "$INSTDIR\*.staged"
!macroend

; 5. Post-uninstall hook: Clean shortcuts, remove firewall rule, and refresh taskbar tray
!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove Desktop and Start Menu Shortcuts
  Delete "$DESKTOP\Downex.lnk"
  Delete "$DESKTOP\downex.lnk"
  Delete "$SMPROGRAMS\Downex.lnk"
  Delete "$SMPROGRAMS\Downex Download Manager.lnk"
  RMDir /r "$SMPROGRAMS\Downex"
  RMDir /r "$SMPROGRAMS\Downex Download Manager"

  ; Delete Windows Firewall inbound rule
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Downex Download Manager"'

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
