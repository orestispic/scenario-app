; Icône et association propres aux projets .scenario.
; SHCTX vise automatiquement HKCU ou HKLM selon le type d'installation choisi.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\.scenario" "" "ScenarioApp.Project"
  WriteRegStr SHCTX "Software\Classes\ScenarioApp.Project" "" "Projet Scénario"
  WriteRegStr SHCTX "Software\Classes\ScenarioApp.Project\DefaultIcon" "" "$INSTDIR\resources\scenario-file-icon.ico"
  WriteRegStr SHCTX "Software\Classes\ScenarioApp.Project\shell\open\command" "" '"$INSTDIR\scenario-app.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ReadRegStr $0 SHCTX "Software\Classes\.scenario" ""
  StrCmp $0 "ScenarioApp.Project" 0 +2
  DeleteRegKey SHCTX "Software\Classes\.scenario"
  DeleteRegKey SHCTX "Software\Classes\ScenarioApp.Project"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
