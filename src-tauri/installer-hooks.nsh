; Icône et association propres aux projets .scenario.
; SHCTX vise automatiquement HKCU ou HKLM selon le type d'installation choisi.

Var SenarioAssociationAtUninstall

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\.scenario" "" "ScenarioApp.Project"
  WriteRegStr SHCTX "Software\Classes\ScenarioApp.Project" "" "Projet Scénario"
  WriteRegStr SHCTX "Software\Classes\ScenarioApp.Project\DefaultIcon" "" '"$INSTDIR\scenario-file-icon.ico",0'
  WriteRegStr SHCTX "Software\Classes\ScenarioApp.Project\shell\open\command" "" '"$INSTDIR\scenario-app.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri's generated APP_UNASSOCIATE restores its installation-time backup
  ; unconditionally. Preserve a newer association selected by another app.
  ReadRegStr $SenarioAssociationAtUninstall SHCTX "Software\Classes\.scenario" ""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCmp $SenarioAssociationAtUninstall "ScenarioApp.Project" +2
  WriteRegStr SHCTX "Software\Classes\.scenario" "" "$SenarioAssociationAtUninstall"
  ReadRegStr $0 SHCTX "Software\Classes\.scenario" ""
  StrCmp $0 "ScenarioApp.Project" 0 +2
  DeleteRegValue SHCTX "Software\Classes\.scenario" ""
  ; Keep another installation's association and unrelated OpenWith values.
  ReadRegStr $0 SHCTX "Software\Classes\ScenarioApp.Project\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\scenario-app.exe" "%1"' 0 +2
  DeleteRegKey SHCTX "Software\Classes\ScenarioApp.Project"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
