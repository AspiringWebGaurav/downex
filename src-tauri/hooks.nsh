; ==============================================================================
; Downex — NSIS Installer Customization Hooks (IDM Style)
; Matches classic installer flow: License Checkbox, Firewall rule, Desktop Icon,
; and browser takeover completion instructions.
; ==============================================================================

; 1. Require user to check "I accept the terms in the license agreement" before proceeding
!ifndef MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX
!endif

; 2. Custom Completion screen text (Matches Image 4)
!ifndef MUI_FINISHPAGE_TITLE
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!endif
!ifndef MUI_FINISHPAGE_TEXT
!define MUI_FINISHPAGE_TEXT "Downex has been successfully installed.$\r$\n$\r$\nPress the Finish button to exit this installation.$\r$\n$\r$\nIf you want Downex to take over your downloads immediately after the installation, please close all web browsers before proceeding. You may open your browser after starting Downex."
!endif


; 3. Post-install hook: Firewall exception & Desktop icon
!macro NSIS_HOOK_POSTINSTALL
  ; Create Desktop Shortcut for all users / current user
  CreateShortcut "$DESKTOP\Downex.lnk" "$INSTDIR\Downex.exe" "" "$INSTDIR\Downex.exe" 0 "" "" "Downex Download Manager"

  ; Add Windows Firewall inbound exception for Downex binary (Matches Image 5)
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Downex Download Manager" dir=in action=allow program="$INSTDIR\Downex.exe" enable=yes profile=any'

  ; Clean any leftover temp staging files
  Delete "$INSTDIR\*.old"
  Delete "$INSTDIR\*.staged"
!macroend

; 4. Post-uninstall hook: Remove shortcuts and firewall rule
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$DESKTOP\Downex.lnk"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Downex Download Manager"'
!macroend
