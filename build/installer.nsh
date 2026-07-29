; Docket — Windows shell integration.
;
; electron-builder's own `fileAssociations` is not used, because its macro does
; only half the job: it hard-sets HKCU\Software\Classes\.md to point at the app
; (which Windows overrides with UserChoice anyway, so it achieves nothing) and
; never writes OpenWithProgids, which is the key that actually puts an app in
; Explorer's "Open with" list. It also derives the ProgID from the association's
; `name`, so a readable name like "Markdown Document" becomes a ProgID with
; spaces in it.
;
; This does it the way Windows documents:
;
;   Classes\Docket.md                     the ProgID: type name, icon, verb
;   Classes\.md\OpenWithProgids\Docket.md puts Docket in the Open with list
;   Classes\Applications\Docket.exe       friendly name + SupportedTypes
;   Software\Docket\Capabilities          so it appears in Settings > Default apps
;   RegisteredApplications\Docket         points Windows at those capabilities
;
; What it deliberately does NOT do is seize the default handler. Since Windows 8
; the UserChoice key is hash-protected; an installer that writes it is rejected
; and the association gets reset. Choosing a default is the user's call, made
; once in Explorer or in Settings.

!macro registerDocketType EXT PROGID TYPENAME ICONFILE
  ; The ProgID: what Explorer shows and how it opens the file.
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${TYPENAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "FriendlyTypeName" "${TYPENAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\resources\icons\${ICONFILE},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open" "" "Open with Docket"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open" "Icon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" '"$appExe" "%1"'

  ; The line that makes Docket appear under "Open with" without stealing the
  ; default. An empty value is correct here — the key's presence is the signal.
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""

  ; Declared capability, so Settings > Default apps can assign this type.
  WriteRegStr SHELL_CONTEXT "Software\Docket\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"

  ; Feeds the "Open with" list a second way, via the executable itself.
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
!macroend

!macro unregisterDocketType EXT PROGID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}"
!macroend

!macro customInstall
  ; How the app names itself wherever Windows shows a chooser.
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Docket"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$appExe" "%1"'

  !insertmacro registerDocketType "md"       "Docket.md"   "Markdown Document" "file-md.ico"
  !insertmacro registerDocketType "markdown" "Docket.md"   "Markdown Document" "file-md.ico"
  !insertmacro registerDocketType "mdown"    "Docket.md"   "Markdown Document" "file-md.ico"
  !insertmacro registerDocketType "mkd"      "Docket.md"   "Markdown Document" "file-md.ico"
  !insertmacro registerDocketType "docx"     "Docket.docx" "Word Document"     "file-docx.ico"
  !insertmacro registerDocketType "xlsx"     "Docket.xlsx" "Excel Workbook"    "file-xlsx.ico"
  !insertmacro registerDocketType "xlsm"     "Docket.xlsx" "Excel Workbook"    "file-xlsx.ico"
  !insertmacro registerDocketType "pdf"      "Docket.pdf"  "PDF Document"      "file-pdf.ico"

  ; Present Docket to Settings > Default apps as one app owning all of them,
  ; so every format can be assigned in a single place.
  WriteRegStr SHELL_CONTEXT "Software\Docket\Capabilities" "ApplicationName" "Docket"
  WriteRegStr SHELL_CONTEXT "Software\Docket\Capabilities" "ApplicationDescription" "One window for Markdown, Word, Excel and PDF."
  WriteRegStr SHELL_CONTEXT "Software\Docket\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Docket" "Software\Docket\Capabilities"

  ; Tell Explorer to reread associations, or nothing shows until the next logon.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  !insertmacro unregisterDocketType "md"       "Docket.md"
  !insertmacro unregisterDocketType "markdown" "Docket.md"
  !insertmacro unregisterDocketType "mdown"    "Docket.md"
  !insertmacro unregisterDocketType "mkd"      "Docket.md"
  !insertmacro unregisterDocketType "docx"     "Docket.docx"
  !insertmacro unregisterDocketType "xlsx"     "Docket.xlsx"
  !insertmacro unregisterDocketType "xlsm"     "Docket.xlsx"
  !insertmacro unregisterDocketType "pdf"      "Docket.pdf"

  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Docket"
  DeleteRegKey SHELL_CONTEXT "Software\Docket"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
